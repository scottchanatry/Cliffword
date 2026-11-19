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
 * - A server that keeps announcing a length other than the descriptor's is stopped early
 *   ('size-mismatch'), but only on clear evidence: the same wrong total on at least
 *   EARLY_ABORT_MIN_EVENTS progress events and EARLY_ABORT_MIN_BYTES received. iOS forwards
 *   NSURLSession's totalBytesExpectedToWrite, which early events of a background, redirected or
 *   HTTP/2 transfer may not have right (or report as -1); anything less than that is left to the
 *   final size check.
 *
 * Verification: size, then SHA-256 (fileHash.ts: native module, File#digest, or JS), of the file
 * the task says it wrote (DownloadTask resolves with it; normally the part file). The size is
 * read from a fresh File; when it is not the expected one (iOS reports an unreadable file as 0)
 * it is read once more after SIZE_RETRY_DELAY_MS before the file counts as bad. A file that fails
 * is deleted and the status says why ('size-mismatch' or 'checksum-mismatch'), with `detail`
 * saying which check fired and what it saw (also logged with console.warn). A file that passes is
 * renamed into place and recorded as 'ready' in model_files with its size and hash.
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
import { toByteCount, toNumber } from './nativeNumber';
import type { ModelFile, ModelFileStatus as StoredStatus } from '../../storage/repos/modelFiles';
import { systemClock } from '../clock/systemClock';
import type { Clock } from '../clock/types';
import { Listeners, type Unsubscribe } from '../listeners';
import { DEFAULT_MODEL, FREE_SPACE_MARGIN_BYTES } from './descriptor';
import { createFileHasher, type FileHasher } from './fileHash';
import type {
  DownloadProgress,
  ModelDescriptor,
  ModelFileCheckDetail,
  ModelFileErrorCode,
  ModelFileState,
  ModelFileStatus,
  ModelManager,
} from './types';

export { FREE_SPACE_MARGIN_BYTES };

const KEEP_AWAKE_TAG = 'cliffword-model-download';

/** How long cancel() waits for the native task to pause before it cancels it. */
const PAUSE_DEADLINE_MS = 5000;

/** The early length check stops a transfer only after this many bytes... */
export const EARLY_ABORT_MIN_BYTES = 8 * 1024 * 1024;
/** ...and after this many progress events announcing the same wrong total. */
export const EARLY_ABORT_MIN_EVENTS = 2;
/** How long the size check waits before reading a size again (iOS may still be moving the file). */
export const SIZE_RETRY_DELAY_MS = 500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Two file URIs (or paths) name the same file; iOS may spell /var/... as /private/var/.... */
function samePath(a: string, b: string): boolean {
  const norm = (uri: string) => uriToPath(uri).replace(/\/+$/, '').replace(/^\/private\/var\//, '/var/');
  return norm(a) === norm(b);
}

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
  /** Wait before the size check reads a size again. Default SIZE_RETRY_DELAY_MS. */
  sizeRetryDelayMs?: number;
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
      const bytes = toByteCount(await CliffwordNative.availableBytes());
      if (bytes !== null) return bytes;
    } catch {
      // Fall back to expo-file-system's figure.
    }
  }
  try {
    return toByteCount(Paths.availableDiskSpace);
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
  private readonly sizeRetryDelayMs: number;
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
  /** The transfer of the running download (for diagnostics): when it started, what it last reported. */
  private transfer: { startedAt: number; reportedTotal: number | null; bytesWritten: number } | null = null;
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
    this.sizeRetryDelayMs = opts.sizeRetryDelayMs ?? SIZE_RETRY_DELAY_MS;
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

  /** Free bytes on the volume (the measure the download's space check uses), or null. */
  freeBytes(): Promise<number | null> {
    return this.measureFree().catch(() => null);
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
    if (part.exists && toByteCount(part.size) === this.descriptor.bytes) {
      return { status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null };
    }
    return { status: 'absent', progress: this.progressOf(this.resumeOffset(this.readRecord())), error: null };
  }

  private async recover(resumeOnStart: boolean): Promise<void> {
    const final = this.finalFile();
    if (final.exists) {
      const { epoch, done } = this.begin();
      void done;
      const size = await this.readSize(final);
      if (!this.alive(epoch)) return;
      if (size !== this.descriptor.bytes) {
        this.reject(epoch, final, 'size-mismatch', this.checkDetail('startup', size));
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
      await this.verify(epoch, final, 'startup');
      return;
    }

    const part = this.partFile();
    if (part.exists && toByteCount(part.size) === this.descriptor.bytes) {
      // The transfer finished but was never verified (the app stopped in between).
      const { epoch } = this.begin();
      await this.verify(epoch, part, 'final');
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
    // iOS may hand the time over as BigInt (Swift Int64); Math.floor(1n) throws.
    const mtime = toNumber(final.modificationTime);
    return Number.isFinite(mtime) && Math.floor(mtime) <= row.updatedAt;
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
      await this.verify(epoch, final, 'startup');
      return;
    }
    // A finished but unverified transfer: verify it instead of fetching it again.
    const part = this.partFile();
    if (part.exists && toByteCount(part.size) === this.descriptor.bytes) {
      await this.verify(epoch, part, 'final');
      return;
    }
    if (part.exists && (toByteCount(part.size) ?? 0) > this.descriptor.bytes) removeQuietly(part);

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
    this.transfer = { startedAt: this.clock.now(), reportedTotal: null, bytesWritten: offset };

    for (;;) {
      const from = resume ? this.resumeOffset(record) : 0;
      let gotBytes = false;
      let wrongTotal = 0;
      let wrongTotalEvents = 0;
      const onProgress = (event: { bytesWritten: unknown; totalBytes: unknown }) => {
        const bytesWritten = toNumber(event.bytesWritten);
        const totalBytes = toNumber(event.totalBytes);
        if (!this.alive(epoch)) return;
        if (this.transfer) {
          this.transfer.reportedTotal = Number.isFinite(totalBytes) ? totalBytes : null;
          if (Number.isFinite(bytesWritten)) this.transfer.bytesWritten = bytesWritten;
        }
        if (from === 0 && totalBytes > 0 && totalBytes !== this.descriptor.bytes) {
          // Early events may carry a provisional total (iOS: redirects, HTTP/2, throttled events).
          // Only the same wrong total, again, with real data behind it, stops the transfer now
          // instead of after 1.1 GB; otherwise the final size check decides.
          wrongTotalEvents = totalBytes === wrongTotal ? wrongTotalEvents + 1 : 1;
          wrongTotal = totalBytes;
          if (wrongTotalEvents >= EARLY_ABORT_MIN_EVENTS && bytesWritten >= EARLY_ABORT_MIN_BYTES) {
            this.abortWrongSize();
            return;
          }
        } else {
          wrongTotalEvents = 0;
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
      await this.verify(epoch, this.landedFile(result), 'final');
      return;
    }
  }

  /**
   * The file the finished task wrote, as a fresh File: DownloadTask resolves with the destination
   * native code moved the transfer to (the part file, unless iOS spelled or placed it otherwise).
   * A different file is verified where it is; verify() then moves it to the final name.
   */
  private landedFile(result: File): File {
    const part = this.partFile();
    try {
      if (!result.uri || samePath(result.uri, part.uri)) return part;
      const landed = new File(result.uri);
      return landed.exists || !part.exists ? landed : part;
    } catch {
      return part;
    }
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

  /**
   * Checks size and SHA-256 of `file` (the downloaded file, or the model file at startup).
   * `check` names the check in the diagnostic detail of a failure.
   */
  private async verify(epoch: number, file: File, check: 'final' | 'startup'): Promise<void> {
    if (!this.alive(epoch)) return;
    this.update({ status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null, verifyFraction: 0 });
    const size = await this.readSize(file);
    if (!this.alive(epoch)) return;
    this.writeRow('verifying', { bytes: size ?? 0 });
    if (size !== this.descriptor.bytes) {
      this.reject(epoch, file, 'size-mismatch', this.checkDetail(check, size));
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
        (rawRead, rawTotal) => {
          if (!this.alive(epoch) || this.state.status !== 'verifying') return;
          const bytesRead = toNumber(rawRead);
          const totalBytes = toNumber(rawTotal);
          const total = totalBytes > 0 ? totalBytes : this.descriptor.bytes;
          const fraction = Math.max(0, Math.min(1, bytesRead / total));
          if (!Number.isFinite(fraction)) return;
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
      this.reject(epoch, file, 'checksum-mismatch', this.checkDetail('checksum', size));
      return;
    }

    const final = this.finalFile();
    if (!samePath(file.uri, final.uri)) {
      try {
        removeQuietly(final);
        await file.move(final);
        // A transfer that landed elsewhere may leave an older part file behind.
        removeQuietly(this.partFile());
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

  /**
   * The size of `file`, read from a fresh File object, or null when it cannot be read. A size other
   * than the descriptor's (iOS reports an unreadable file as 0) is read once more after a short
   * wait: iOS may still be finishing the move into place.
   */
  private async readSize(file: File): Promise<number | null> {
    const read = (): number | null => {
      try {
        const fresh = new File(file.uri);
        if (!fresh.exists) return null;
        return toByteCount(fresh.size);
      } catch {
        return null;
      }
    };
    const first = read();
    if (first === this.descriptor.bytes) return first;
    await delay(this.sizeRetryDelayMs);
    return read() ?? first;
  }

  /** What a failed check saw, for ModelFileState.detail. */
  private checkDetail(check: ModelFileCheckDetail['check'], actualBytes: number | null): ModelFileCheckDetail {
    const transfer = this.transfer;
    return {
      check,
      expectedBytes: this.descriptor.bytes,
      actualBytes,
      reportedTotalBytes: transfer?.reportedTotal ?? null,
      bytesWrittenAtFail: transfer?.bytesWritten ?? 0,
      seconds: transfer ? Math.max(0, Math.round((this.clock.now() - transfer.startedAt) / 1000)) : null,
    };
  }

  private logFailedCheck(code: 'size-mismatch' | 'checksum-mismatch', detail: ModelFileCheckDetail): void {
    try {
      console.warn(`[model] ${code}: ${JSON.stringify(detail)}`);
    } catch {
      // Logging never breaks the download.
    }
  }

  /** The server kept announcing another length: stop the transfer, drop what arrived, say why. */
  private abortWrongSize(): void {
    const task = this.task;
    const detail = this.checkDetail('early', null);
    this.epoch += 1; // the download's own continuation stops here
    this.logFailedCheck('size-mismatch', detail);
    this.finish({ status: 'error', progress: this.progressOf(0), error: 'size-mismatch', detail });
    task?.cancel();
    removeQuietly(this.partFile());
    removeQuietly(this.recordFile());
    this.writeRow('failed', { bytes: 0, sha256: null });
  }

  /** A file that failed its check is deleted, and the status says why. */
  private reject(epoch: number, file: File, code: 'size-mismatch' | 'checksum-mismatch', detail: ModelFileCheckDetail): void {
    this.logFailedCheck(code, detail);
    removeQuietly(file);
    removeQuietly(this.recordFile());
    this.writeRow('failed', { bytes: 0, sha256: null });
    if (this.alive(epoch)) this.finish({ status: 'error', progress: this.progressOf(0), error: code, detail });
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
    return part.exists ? Math.min(toByteCount(part.size) ?? 0, this.descriptor.bytes) : 0;
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
    this.transfer = null;
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
