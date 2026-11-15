/**
 * The real ModelManager for iOS and Android: downloads the model file with expo-file-system 58,
 * checks its size and SHA-256, and keeps track of it in the model_files table.
 *
 * Files, all in <documents>/models/ (the document directory, which the OS never purges; excluded
 * from iCloud and device backups on iOS through the cliffword-native module):
 * - <fileName>: the verified model. filePath points here; it only exists after verification.
 * - <fileName>.part: the download in progress (Android writes into it as bytes arrive; iOS moves
 *   the finished transfer here), verified and then renamed to <fileName>.
 * - <fileName>.download.json: the download record: whether a download was running (so a restart
 *   resumes it) or stopped by cancel(), and DownloadTask.savable() from the last pause.
 *
 * Download (startDownload):
 * - Free space first: the bytes still to fetch plus FREE_SPACE_MARGIN_BYTES (600 MB, as in
 *   docs/OUTLINE.md flow F), measured with the iOS "important usage" capacity when the native
 *   module has it, else Paths.availableDiskSpace. Short: status 'error', 'insufficient-storage',
 *   with `space` for the text.
 * - expo-file-system's DownloadTask, with the iOS background URLSession (the transfer goes on
 *   while the app is suspended; Android ignores the option). Progress comes from its events. The
 *   screen stays awake (expo-keep-awake) while downloading and verifying.
 * - cancel() pauses the task and saves its resume state; the next startDownload() resumes from it.
 *   Android resumes from the partial file's length with a Range request, so it also resumes after
 *   a failure or after the app was killed. iOS keeps its partial data in the system's temp file,
 *   which only resume data from a pause can reach: after a failure or a kill it starts over.
 * - When the app starts and the record says a download was running, it resumes (or restarts).
 * - A server that announces a length other than the descriptor's is stopped early
 *   ('size-mismatch').
 *
 * Verification: size, then SHA-256 (fileHash.ts: native module, File#digest, or JS). A file that
 * fails is deleted and the status says why ('size-mismatch' or 'checksum-mismatch'). A file that
 * passes is renamed into place and recorded as 'ready' in model_files with its size and hash.
 *
 * Startup: a model file whose model_files row is 'ready' with the descriptor's size and hash, and
 * which has not been modified since that row was written (file mtime <= updated_at), is 'ready'
 * without hashing it again. Otherwise it is verified again (status 'verifying' until then).
 *
 * delete() removes the model, the partial download and the record; startDownload() fetches it
 * again.
 */
import { Directory, DownloadTask, type DownloadPauseState, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import CliffwordNative from '../../../modules/cliffword-native';
import type { ModelFile, ModelFileStatus as StoredStatus } from '../../storage/repos/modelFiles';
import { systemClock } from '../clock/systemClock';
import type { Clock } from '../clock/types';
import { Listeners, type Unsubscribe } from '../listeners';
import { DEFAULT_MODEL, FREE_SPACE_MARGIN_BYTES } from './descriptor';
import { createFileHasher, type FileHasher } from './fileHash';
import type {
  DownloadProgress,
  ModelDescriptor,
  ModelFileErrorCode,
  ModelFileState,
  ModelFileStatus,
  ModelManager,
} from './types';

export { FREE_SPACE_MARGIN_BYTES };

const KEEP_AWAKE_TAG = 'cliffword-model-download';

/** How long cancel() waits for the native task to pause before it cancels it. */
const PAUSE_DEADLINE_MS = 5000;

/** Resolves true when `promise` settles in time, false when the deadline passes first. */
function withDeadline(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([promise.then(() => true), deadline]).finally(() => clearTimeout(timer));
}

/** The model_files repository calls the manager uses (src/storage/repos/modelFiles.ts). */
export interface ModelFilesStore {
  get(id: string): Promise<ModelFile | null>;
  upsert(input: { id: string; path: string; status: StoredStatus; bytes?: number; sha256?: string | null; updatedAt?: number }): Promise<unknown>;
}

export interface KeepAwake {
  activate(): Promise<unknown>;
  deactivate(): Promise<unknown>;
}

export interface ExpoModelManagerOptions {
  /** The model_files repository, opened on demand (storage.open() then .modelFiles). */
  modelFiles: () => Promise<ModelFilesStore>;
  platform: 'ios' | 'android';
  descriptor?: ModelDescriptor;
  /** Default createFileHasher() (native module, File#digest, JS). */
  hasher?: FileHasher;
  /** Default expo-keep-awake with the tag 'cliffword-model-download'. */
  keepAwake?: KeepAwake;
  /** Free bytes on the volume, or null when unknown (the check is then skipped). */
  freeBytes?: () => Promise<number | null>;
  /** Keeps a file or folder out of backups. Default: the native module (iOS); a no-op without it. */
  excludeFromBackup?: (uri: string) => Promise<void>;
  /** Times written to model_files. Default systemClock. */
  clock?: Clock;
  /** Default FREE_SPACE_MARGIN_BYTES. */
  marginBytes?: number;
  /** Folder for the model files. Default <documents>/models. */
  directory?: Directory;
  /** Resume a download that was running when the app stopped. Default true. */
  resumeOnStart?: boolean;
}

/** The download record (<fileName>.download.json). */
interface DownloadRecord {
  v: 1;
  url: string;
  sha256: string;
  /** 'running' while a download runs (a restart resumes it); 'stopped' after cancel() or a failure. */
  intent: 'running' | 'stopped';
  /** Bytes received when the record was written. */
  bytesWritten: number;
  /** DownloadTask.savable() from the last pause. */
  pause?: DownloadPauseState;
}

type Signal = { readonly aborted: boolean };

/** A file:// URI as a plain path (what llama.rn and other native code take). */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const path = uri.slice('file://'.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The error code for a failed transfer. */
export function classifyDownloadError(error: unknown): ModelFileErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|no space left|not enough (free )?space|disk (is )?full|out of space|insufficient storage/i.test(message)) {
    return 'insufficient-storage';
  }
  return 'network';
}

async function defaultFreeBytes(platform: 'ios' | 'android'): Promise<number | null> {
  if (platform === 'ios' && CliffwordNative?.availableBytes) {
    try {
      const bytes = await CliffwordNative.availableBytes();
      if (Number.isFinite(bytes) && bytes >= 0) return bytes;
    } catch {
      // Fall back to expo-file-system's figure.
    }
  }
  try {
    const bytes = Paths.availableDiskSpace;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

async function defaultExcludeFromBackup(uri: string): Promise<void> {
  await CliffwordNative?.excludeFromBackup(uri);
}

const defaultKeepAwake: KeepAwake = {
  activate: () => activateKeepAwakeAsync(KEEP_AWAKE_TAG),
  deactivate: () => deactivateKeepAwake(KEEP_AWAKE_TAG),
};

export class ExpoModelManager implements ModelManager {
  readonly descriptor: ModelDescriptor;
  readonly filePath: string;

  private readonly platform: 'ios' | 'android';
  private readonly modelFiles: () => Promise<ModelFilesStore>;
  private readonly hasher: FileHasher;
  private readonly keepAwake: KeepAwake;
  private readonly measureFree: () => Promise<number | null>;
  private readonly excludeFromBackup: (uri: string) => Promise<void>;
  private readonly clock: Clock;
  private readonly marginBytes: number;
  private readonly dir: Directory;
  private readonly listeners = new Listeners<ModelFileState>();

  private state: ModelFileState;
  /** Bumped by every start, cancel and delete; async steps of an older epoch stop. */
  private epoch = 0;
  private running: Promise<ModelFileStatus> | null = null;
  private settle: ((status: ModelFileStatus) => void) | null = null;
  private task: DownloadTask | null = null;
  /** A cancel() still pausing the task; the next start waits for it. */
  private stopping: Promise<void> | null = null;
  /** The epoch delete() moved to. */
  private lastDelete = 0;
  private awake = false;
  private dbQueue: Promise<void> = Promise.resolve();
  private readonly startup: Promise<void>;

  constructor(opts: ExpoModelManagerOptions) {
    this.descriptor = opts.descriptor ?? DEFAULT_MODEL;
    this.platform = opts.platform;
    this.modelFiles = opts.modelFiles;
    this.hasher = opts.hasher ?? createFileHasher();
    this.keepAwake = opts.keepAwake ?? defaultKeepAwake;
    this.measureFree = opts.freeBytes ?? (() => defaultFreeBytes(this.platform));
    this.excludeFromBackup = opts.excludeFromBackup ?? defaultExcludeFromBackup;
    this.clock = opts.clock ?? systemClock;
    this.marginBytes = opts.marginBytes ?? FREE_SPACE_MARGIN_BYTES;
    this.dir = opts.directory ?? new Directory(Paths.document, 'models');
    this.filePath = uriToPath(this.finalFile().uri);
    this.state = this.initialState();
    this.startup = this.recover(opts.resumeOnStart ?? true).catch(() => {});
  }

  // ---- ModelManager ----

  status(): ModelFileStatus {
    return this.state.status;
  }

  progress(): DownloadProgress {
    return this.state.progress;
  }

  snapshot(): ModelFileState {
    return this.state;
  }

  onChange(listener: (state: ModelFileState) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  /** Resolves once the startup check has run (the state then reflects the files on disk). */
  whenStarted(): Promise<void> {
    return this.startup;
  }

  startDownload(): Promise<ModelFileStatus> {
    if (this.state.status === 'ready') return Promise.resolve('ready');
    if (this.running) return this.running;
    const { epoch, done } = this.begin();
    void this.download(epoch).catch((error: unknown) => this.failUnexpected(epoch, error));
    return done;
  }

  async cancel(): Promise<void> {
    if (!this.running) return;
    this.epoch += 1;
    const task = this.task;
    this.task = null;
    const bytes = this.state.progress.bytesWritten;
    this.finish({ status: 'absent', progress: this.progressOf(bytes), error: null });
    const stop = this.pauseAndSave(task, bytes);
    this.stopping = stop;
    await stop;
    if (this.stopping === stop) this.stopping = null;
  }

  async delete(): Promise<void> {
    this.epoch += 1;
    this.lastDelete = this.epoch;
    const task = this.task;
    this.task = null;
    const absent: ModelFileState = { status: 'absent', progress: this.progressOf(0), error: null };
    if (this.running) this.finish(absent);
    else this.update(absent);
    task?.cancel();
    await this.stopping;
    for (const file of [this.finalFile(), this.partFile(), this.recordFile()]) removeQuietly(file);
    this.writeRow('missing', { bytes: 0, sha256: null });
  }

  // ---- startup ----

  /** A first state from the files alone (synchronous), refined by recover(). */
  private initialState(): ModelFileState {
    const final = this.finalFile();
    if (final.exists) {
      return { status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null };
    }
    const part = this.partFile();
    if (part.exists && part.size === this.descriptor.bytes) {
      return { status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null };
    }
    return { status: 'absent', progress: this.progressOf(this.resumeOffset(this.readRecord())), error: null };
  }

  private async recover(resumeOnStart: boolean): Promise<void> {
    const final = this.finalFile();
    if (final.exists) {
      const { epoch, done } = this.begin();
      void done;
      if (final.size !== this.descriptor.bytes) {
        this.reject(epoch, final, 'size-mismatch');
        return;
      }
      const row = await this.modelFiles()
        .then((repo) => repo.get(this.descriptor.id))
        .catch(() => null);
      if (!this.alive(epoch)) return;
      if (this.isRecordedVerified(row, final)) {
        void this.excludeFromBackup(final.uri).catch(() => {});
        this.finish({ status: 'ready', progress: this.progressOf(this.descriptor.bytes), error: null });
        return;
      }
      await this.verify(epoch, final);
      return;
    }

    const part = this.partFile();
    if (part.exists && part.size === this.descriptor.bytes) {
      // The transfer finished but was never verified (the app stopped in between).
      const { epoch } = this.begin();
      await this.verify(epoch, part);
      return;
    }

    const record = this.readRecord();
    if (record && !this.recordMatches(record)) {
      // Left over from another model file.
      removeQuietly(this.recordFile());
      removeQuietly(part);
      this.update({ status: 'absent', progress: this.progressOf(0), error: null });
      return;
    }
    if (resumeOnStart && record?.intent === 'running' && !this.running) {
      void this.startDownload();
    }
  }

  private isRecordedVerified(row: ModelFile | null, final: File): boolean {
    if (!row || row.status !== 'ready') return false;
    if (row.sha256 !== this.descriptor.sha256 || row.bytes !== this.descriptor.bytes) return false;
    const mtime = final.modificationTime;
    return mtime !== null && mtime !== undefined && Math.floor(mtime) <= row.updatedAt;
  }

  // ---- download ----

  private async download(epoch: number): Promise<void> {
    if (this.stopping) await this.stopping;
    if (!this.alive(epoch)) return;

    try {
      this.dir.create({ intermediates: true, idempotent: true });
    } catch {
      // It exists; anything worse shows up when the download writes.
    }
    void this.excludeFromBackup(this.dir.uri).catch(() => {});

    // The model file is there (a cancel() stopped its startup check): check it again.
    const final = this.finalFile();
    if (final.exists) {
      await this.verify(epoch, final);
      return;
    }
    // A finished but unverified transfer: verify it instead of fetching it again.
    const part = this.partFile();
    if (part.exists && part.size === this.descriptor.bytes) {
      await this.verify(epoch, part);
      return;
    }
    if (part.exists && part.size > this.descriptor.bytes) removeQuietly(part);

    const record = this.readRecord();
    let resume = this.resumeState(record && this.recordMatches(record) ? record : null);
    if (!resume) {
      removeQuietly(part);
      removeQuietly(this.recordFile());
    }
    const offset = resume ? this.resumeOffset(record) : 0;

    const free = await this.measureFree().catch(() => null);
    if (!this.alive(epoch)) return;
    const neededBytes = this.descriptor.bytes - offset + this.marginBytes;
    if (free !== null && free < neededBytes) {
      this.writeRow('failed', { bytes: offset });
      this.finish({
        status: 'error',
        progress: this.progressOf(offset),
        error: 'insufficient-storage',
        space: { freeBytes: free, neededBytes },
      });
      return;
    }

    this.writeRecord({ intent: 'running', bytesWritten: offset, pause: resume ?? undefined });
    this.writeRow('downloading', { bytes: offset, sha256: null });
    this.update({ status: 'downloading', progress: this.progressOf(offset), error: null });

    for (;;) {
      const from = resume ? this.resumeOffset(record) : 0;
      let gotBytes = false;
      const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
        if (!this.alive(epoch)) return;
        if (from === 0 && totalBytes > 0 && totalBytes !== this.descriptor.bytes) {
          // The server is sending something else; stop now instead of after 1.1 GB.
          this.abortWrongSize();
          return;
        }
        // iOS may count a resumed transfer from the resume point, with the remaining length as total.
        const relative = from > 0 && totalBytes > 0 && totalBytes < this.descriptor.bytes;
        const written = relative ? from + bytesWritten : bytesWritten;
        if (written > from) gotBytes = true;
        if (written === this.state.progress.bytesWritten && this.state.status === 'downloading') return;
        this.update({ status: 'downloading', progress: this.progressOf(written), error: null });
      };
      const options = { onProgress, sessionType: 'background' as const };

      let result: File | null;
      try {
        if (resume) {
          const task = DownloadTask.fromSavable(resume, options);
          this.task = task;
          result = await task.resumeAsync();
        } else {
          const task = new DownloadTask(this.descriptor.url, this.partFile(), options);
          this.task = task;
          result = await task.downloadAsync();
        }
      } catch (error) {
        if (!this.alive(epoch)) return;
        this.task = null;
        if (resume && !gotBytes && this.shouldRestartAfterFailedResume(error)) {
          // Stale resume data (iOS) or a range the server refuses: start over once.
          resume = null;
          removeQuietly(this.partFile());
          this.writeRecord({ intent: 'running', bytesWritten: 0 });
          this.update({ status: 'downloading', progress: this.progressOf(0), error: null });
          continue;
        }
        this.failDownload(epoch, error);
        return;
      }
      if (!this.alive(epoch)) {
        // Finished as it was stopped. After cancel() the complete part file stays (the next start
        // verifies it); after delete() it goes, unless a newer download already uses the path.
        if (result && this.lastDelete > epoch && !this.running) removeQuietly(this.partFile());
        return;
      }
      this.task = null;
      if (result === null) {
        // Paused from outside cancel() (should not happen): treat as stopped.
        this.finish({ status: 'absent', progress: this.state.progress, error: null });
        return;
      }
      break;
    }

    await this.verify(epoch, this.partFile());
  }

  /** iOS resume data is fragile (the system may purge its temp file); Android only on HTTP 416. */
  private shouldRestartAfterFailedResume(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (this.platform === 'ios') return classifyDownloadError(error) !== 'insufficient-storage';
    return /\b416\b/.test(message);
  }

  private failDownload(epoch: number, error: unknown): void {
    const code = classifyDownloadError(error);
    // Android keeps the partial file and resumes from its length; iOS cannot resume after a failure.
    const kept = this.platform === 'android' ? this.partBytes() : 0;
    if (this.platform === 'android' && kept > 0) {
      this.writeRecord({ intent: 'stopped', bytesWritten: kept });
    } else {
      removeQuietly(this.recordFile());
    }
    this.writeRow('failed', { bytes: kept });
    if (this.alive(epoch)) this.finish({ status: 'error', progress: this.progressOf(kept), error: code });
  }

  /** cancel(): pause the task, keep its resume state and stop the record from auto-resuming. */
  private async pauseAndSave(task: DownloadTask | null, bytes: number): Promise<void> {
    // Stopping a check of a finished file: nothing to save, and the file stays.
    if (!task) return;
    let pause: DownloadPauseState | undefined;
    if (task.state === 'active') {
      try {
        // A pause sent before the native task has started is lost (iOS starts it on the main
        // queue, Android's start() resets the pause flag) and pauseAsync() would then wait for the
        // whole transfer, so it gets a deadline; past it the task is cancelled instead.
        if (await withDeadline(task.pauseAsync(), PAUSE_DEADLINE_MS)) {
          const saved = task.savable();
          if (saved.resumeData) pause = saved;
        } else {
          task.cancel();
        }
      } catch {
        task.cancel();
      }
    }
    const kept = this.platform === 'android' ? this.partBytes() : pause ? bytes : 0;
    if (kept > 0) this.writeRecord({ intent: 'stopped', bytesWritten: kept, pause });
    else removeQuietly(this.recordFile());
    this.writeRow('missing', { bytes: kept });
    if (this.state.status === 'absent' && !this.running && kept !== this.state.progress.bytesWritten) {
      this.update({ status: 'absent', progress: this.progressOf(kept), error: null });
    }
  }

  // ---- verification ----

  /** Checks size and SHA-256 of `file` (the part file, or the model file at startup). */
  private async verify(epoch: number, file: File): Promise<void> {
    if (!this.alive(epoch)) return;
    this.update({ status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null, verifyFraction: 0 });
    this.writeRow('verifying', { bytes: file.size });
    if (file.size !== this.descriptor.bytes) {
      this.reject(epoch, file, 'size-mismatch');
      return;
    }

    let sha256: string;
    let lastFraction = 0;
    const isAlive = () => this.alive(epoch);
    const signal: Signal = {
      get aborted() {
        return !isAlive();
      },
    };
    try {
      const result = await this.hasher.sha256(
        file.uri,
        (bytesRead, totalBytes) => {
          if (!this.alive(epoch) || this.state.status !== 'verifying') return;
          const total = totalBytes > 0 ? totalBytes : this.descriptor.bytes;
          const fraction = Math.max(0, Math.min(1, bytesRead / total));
          if (fraction - lastFraction < 0.01 && fraction < 1) return;
          lastFraction = fraction;
          this.update({ ...this.state, verifyFraction: fraction });
        },
        signal,
      );
      sha256 = result.sha256;
    } catch {
      if (!this.alive(epoch)) return;
      // Could not read it; the file is not proven bad, so it stays and the next start checks again.
      this.writeRow('failed', {});
      this.finish({ status: 'error', progress: this.progressOf(this.descriptor.bytes), error: 'unknown' });
      return;
    }
    if (!this.alive(epoch)) return;
    if (sha256 !== this.descriptor.sha256) {
      this.reject(epoch, file, 'checksum-mismatch');
      return;
    }

    const final = this.finalFile();
    if (file.uri !== final.uri) {
      try {
        removeQuietly(final);
        await file.move(final);
      } catch {
        if (!this.alive(epoch)) return;
        this.writeRow('failed', {});
        this.finish({ status: 'error', progress: this.progressOf(this.descriptor.bytes), error: 'unknown' });
        return;
      }
    }
    removeQuietly(this.recordFile());
    await this.excludeFromBackup(final.uri).catch(() => {});
    if (!this.alive(epoch)) return;
    // Written after the rename and the backup flag, so updated_at >= the file's mtime.
    this.writeRow('ready', { bytes: this.descriptor.bytes, sha256 });
    this.finish({ status: 'ready', progress: this.progressOf(this.descriptor.bytes), error: null });
  }

  /** The server announced another length: stop the transfer, drop what arrived, say why. */
  private abortWrongSize(): void {
    const task = this.task;
    this.epoch += 1; // the download's own continuation stops here
    this.finish({ status: 'error', progress: this.progressOf(0), error: 'size-mismatch' });
    task?.cancel();
    removeQuietly(this.partFile());
    removeQuietly(this.recordFile());
    this.writeRow('failed', { bytes: 0, sha256: null });
  }

  /** A file that failed its check is deleted, and the status says why. */
  private reject(epoch: number, file: File, code: 'size-mismatch' | 'checksum-mismatch'): void {
    removeQuietly(file);
    removeQuietly(this.recordFile());
    this.writeRow('failed', { bytes: 0, sha256: null });
    if (this.alive(epoch)) this.finish({ status: 'error', progress: this.progressOf(0), error: code });
  }

  private failUnexpected(epoch: number, _error: unknown): void {
    if (!this.alive(epoch)) return;
    this.writeRow('failed', {});
    this.finish({ status: 'error', progress: this.state.progress, error: 'unknown' });
  }

  // ---- files ----

  private finalFile(): File {
    return new File(this.dir, this.descriptor.fileName);
  }

  private partFile(): File {
    return new File(this.dir, `${this.descriptor.fileName}.part`);
  }

  private recordFile(): File {
    return new File(this.dir, `${this.descriptor.fileName}.download.json`);
  }

  private partBytes(): number {
    const part = this.partFile();
    return part.exists ? Math.min(part.size, this.descriptor.bytes) : 0;
  }

  private readRecord(): DownloadRecord | null {
    const file = this.recordFile();
    try {
      if (!file.exists) return null;
      const parsed = JSON.parse(file.textSync()) as Partial<DownloadRecord>;
      if (parsed.v !== 1 || typeof parsed.url !== 'string' || typeof parsed.sha256 !== 'string') return null;
      return {
        v: 1,
        url: parsed.url,
        sha256: parsed.sha256,
        intent: parsed.intent === 'running' ? 'running' : 'stopped',
        bytesWritten: typeof parsed.bytesWritten === 'number' ? parsed.bytesWritten : 0,
        pause: parsed.pause && typeof parsed.pause.resumeData === 'string' ? parsed.pause : undefined,
      };
    } catch {
      return null;
    }
  }

  private writeRecord(fields: Pick<DownloadRecord, 'intent' | 'bytesWritten' | 'pause'>): void {
    const record: DownloadRecord = { v: 1, url: this.descriptor.url, sha256: this.descriptor.sha256, ...fields };
    try {
      this.dir.create({ intermediates: true, idempotent: true });
    } catch {
      // Already there.
    }
    try {
      this.recordFile().writeSync(JSON.stringify(record));
    } catch {
      // Without a record the download still works; it just cannot resume after a restart.
    }
  }

  private recordMatches(record: DownloadRecord): boolean {
    return record.url === this.descriptor.url && record.sha256 === this.descriptor.sha256;
  }

  /** Where a resume would start from. */
  private resumeOffset(record: DownloadRecord | null): number {
    if (this.platform === 'android') return this.partBytes();
    return record?.pause ? Math.min(record.bytesWritten, this.descriptor.bytes) : 0;
  }

  /** The pause state to resume from, if any. */
  private resumeState(record: DownloadRecord | null): DownloadPauseState | null {
    const part = this.partFile();
    if (this.platform === 'android') {
      const bytes = this.partBytes();
      if (bytes <= 0 || bytes >= this.descriptor.bytes) return null;
      // expo-file-system's Android resume data is the byte offset; the file length is the truth.
      return { url: this.descriptor.url, fileUri: part.uri, isDirectory: false, resumeData: String(bytes) };
    }
    if (!record?.pause?.resumeData) return null;
    return { ...record.pause, url: this.descriptor.url, fileUri: part.uri, isDirectory: false };
  }

  // ---- state ----

  private begin(): { epoch: number; done: Promise<ModelFileStatus> } {
    this.epoch += 1;
    const done = new Promise<ModelFileStatus>((resolve) => {
      this.settle = resolve;
    });
    this.running = done;
    return { epoch: this.epoch, done };
  }

  private alive(epoch: number): boolean {
    return epoch === this.epoch;
  }

  /** Ends the running operation (if any) in `state` and resolves its promise. */
  private finish(state: ModelFileState): void {
    const settle = this.settle;
    this.running = null;
    this.settle = null;
    this.task = null;
    this.update(state);
    settle?.(state.status);
  }

  private update(state: ModelFileState): void {
    this.state = state;
    this.setAwake(state.status === 'downloading' || state.status === 'verifying');
    this.listeners.emit(state);
  }

  private setAwake(awake: boolean): void {
    if (awake === this.awake) return;
    this.awake = awake;
    const call = awake ? this.keepAwake.activate : this.keepAwake.deactivate;
    try {
      void Promise.resolve(call()).catch(() => {});
    } catch {
      // Keep-awake is a convenience; never let it break the download.
    }
  }

  private progressOf(bytes: number): DownloadProgress {
    const total = this.descriptor.bytes;
    const written = Math.max(0, Math.min(total, bytes));
    return { bytesWritten: written, bytesTotal: total, fraction: total > 0 ? written / total : 0 };
  }

  /** Best-effort, in call order: the table mirrors the state but never blocks it. */
  private writeRow(status: StoredStatus, patch: { bytes?: number; sha256?: string | null }): void {
    const at = this.clock.now();
    const id = this.descriptor.id;
    const path = this.filePath;
    this.dbQueue = this.dbQueue
      .then(async () => {
        const repo = await this.modelFiles();
        const current = await repo.get(id);
        await repo.upsert({
          id,
          path,
          status,
          bytes: patch.bytes ?? current?.bytes ?? 0,
          sha256: patch.sha256 !== undefined ? patch.sha256 : (current?.sha256 ?? null),
          updatedAt: at,
        });
      })
      .catch(() => {});
  }

  /** Resolves when every model_files write queued so far has run (tests). */
  flushStorage(): Promise<void> {
    return this.dbQueue;
  }
}

function removeQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}
