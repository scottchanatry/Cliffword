/**
 * An in-memory stand-in for the parts of expo-file-system 58 that ExpoModelManager and fileHash
 * use: Paths, Directory, File (exists, size, modificationTime, delete, move, write/text, open,
 * digest), FileMode and DownloadTask (download, pause, resume, cancel, savable, fromSavable).
 * Test-only; use it as the module mock:
 *
 *   jest.mock('expo-file-system', () => jest.requireActual('../../testing/fakeExpoFileSystem'));
 *   import { fakeFs } from '../../testing/fakeExpoFileSystem';
 *   fakeFs.reset({ platform: 'android' });
 *   fakeFs.serve(url, bytes);
 *   const task = fakeFs.lastDownload();   // after the code under test started one
 *   task.progress(1000); task.complete();
 *
 * Downloads follow the native implementations read from expo-file-system 58.0.13:
 * - 'android': bytes are written into the destination as they arrive; pause() reports the file
 *   length as resume data and resuming sends a Range request from there (the file is truncated
 *   to that offset first); after a failure the partial file stays.
 * - 'ios': NSURLSession writes to a temp file and moves it into place only when complete; pause()
 *   gives opaque resume data (here base64 JSON); without it nothing can be resumed.
 * Every operation settles only when the test calls progress(), complete(), fail() or the code
 * under test pauses or cancels, so tests control the order of events.
 */

type Bytes = Uint8Array;

interface Entry {
  bytes: Bytes;
  mtime: number;
}

export type FakePlatform = 'ios' | 'android';
export type DigestMode = 'sha256' | 'throw';

export interface DownloadProgressEvent {
  bytesWritten: number;
  totalBytes: number;
}

interface TaskOptions {
  onProgress?: (data: DownloadProgressEvent) => void;
  sessionType?: 'background' | 'foreground';
  headers?: Record<string, string>;
}

export interface DownloadPauseState {
  url: string;
  fileUri: string;
  isDirectory: boolean;
  headers?: Record<string, string>;
  resumeData?: string;
}

const files = new Map<string, Entry>();
const dirs = new Set<string>();
const served = new Map<string, Bytes>();
const operations: FakeDownload[] = [];
let platform: FakePlatform = 'android';
let freeBytes: number = 50_000_000_000;
let digestMode: DigestMode = 'throw';
let digestImpl: ((bytes: Bytes) => string) | null = null;
/** When true, pause() is lost, as when it reaches the native task before the task started. */
let losePauses = false;
/** When true, File#size returns a BigInt, as expo-file-system does for Swift Int64 on iOS. */
let bigIntSizes = false;

/** File URIs whose next File#size reads fail, and how (see fakeFs.failSizeReads). */
const sizeFailures = new Map<string, { count: number; mode: SizeFailure }>();
export type SizeFailure = 'throw' | 'nan' | 'zero';
let now = 1_000_000;

const DOCUMENT = 'file:///docs/';

function tick(): number {
  now += 1;
  return now;
}

function joinUri(parts: (string | { uri: string })[]): string {
  let out = '';
  for (const part of parts) {
    const s = typeof part === 'string' ? part : part.uri;
    if (!out) out = s;
    else out = `${out.replace(/\/+$/, '')}/${s.replace(/^\/+/, '')}`;
  }
  return out;
}

const fileKey = (uri: string) => uri.replace(/\/+$/, '');
const dirKey = (uri: string) => `${uri.replace(/\/+$/, '')}/`;

function writeEntry(uri: string, bytes: Bytes, mtime = tick()): void {
  files.set(fileKey(uri), { bytes, mtime });
}

function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export enum FileMode {
  ReadWrite = 'rw',
  ReadOnly = 'r',
  WriteOnly = 'w',
  Append = 'wa',
  Truncate = 'wt',
}

export class FileHandle {
  offset: number | null = 0;
  constructor(private readonly key: string) {}

  get size(): number | null {
    return this.offset === null ? null : (files.get(this.key)?.bytes.length ?? 0);
  }

  async readBytes(length: number): Promise<Uint8Array> {
    return this.readBytesSync(length);
  }

  readBytesSync(length: number): Uint8Array {
    if (this.offset === null) throw new Error('FileHandle is closed');
    const bytes = files.get(this.key)?.bytes ?? new Uint8Array(0);
    const out = bytes.slice(this.offset, this.offset + length);
    this.offset += out.length;
    return out;
  }

  close(): void {
    this.offset = null;
  }
}

export class Directory {
  readonly uri: string;

  constructor(...uris: (string | { uri: string })[]) {
    this.uri = dirKey(joinUri(uris));
  }

  get exists(): boolean {
    return dirs.has(this.uri);
  }

  create(options: { intermediates?: boolean; idempotent?: boolean } = {}): void {
    if (dirs.has(this.uri) && !options.idempotent) throw new Error(`Directory exists: ${this.uri}`);
    dirs.add(this.uri);
  }

  delete(): void {
    dirs.delete(this.uri);
    for (const key of [...files.keys()]) if (key.startsWith(this.uri)) files.delete(key);
  }
}

export class File {
  uri: string;

  constructor(...uris: (string | { uri: string })[]) {
    this.uri = fileKey(joinUri(uris));
  }

  get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  /** 0 when missing, as on iOS. fakeFs.failSizeReads makes the next reads fail. */
  get size(): number {
    const failure = sizeFailures.get(this.uri);
    if (failure && failure.count > 0) {
      failure.count -= 1;
      if (failure.mode === 'throw') throw new Error(`Unable to get file attribute: ${this.uri}`);
      return failure.mode === 'nan' ? Number.NaN : 0;
    }
    const size = files.get(this.uri)?.bytes.length ?? 0;
    return (bigIntSizes ? BigInt(size) : size) as number;
  }

  get modificationTime(): number | null {
    return files.get(this.uri)?.mtime ?? null;
  }

  delete(): void {
    if (!files.delete(this.uri)) throw new Error(`No file at ${this.uri}`);
  }

  async move(destination: File | Directory): Promise<void> {
    this.moveSync(destination);
  }

  moveSync(destination: File | Directory): void {
    const entry = files.get(this.uri);
    if (!entry) throw new Error(`No file at ${this.uri}`);
    const target = destination instanceof Directory ? fileKey(destination.uri + this.name) : destination.uri;
    if (files.has(target)) throw new Error(`Destination exists: ${target}`);
    files.delete(this.uri);
    files.set(target, entry); // a rename keeps the modification time
    this.uri = target;
  }

  writeSync(content: string | Uint8Array): void {
    writeEntry(this.uri, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }

  async write(content: string | Uint8Array): Promise<void> {
    this.writeSync(content);
  }

  textSync(): string {
    const entry = files.get(this.uri);
    if (!entry) throw new Error(`No file at ${this.uri}`);
    return new TextDecoder().decode(entry.bytes);
  }

  async text(): Promise<string> {
    return this.textSync();
  }

  open(_mode: FileMode = FileMode.ReadOnly): FileHandle {
    if (!files.has(this.uri)) throw new Error(`No file at ${this.uri}`);
    return new FileHandle(this.uri);
  }

  async digest(algorithm: string): Promise<string> {
    const entry = files.get(this.uri);
    if (!entry) throw new Error(`No file at ${this.uri}`);
    if (digestMode === 'throw' || !digestImpl || algorithm !== 'SHA-256') throw new Error('digest unavailable');
    return digestImpl(entry.bytes);
  }
}

export class Paths {
  static get document(): Directory {
    return new Directory(DOCUMENT);
  }

  static get availableDiskSpace(): number {
    return freeBytes;
  }
}

type TaskState = 'idle' | 'active' | 'paused' | 'completed' | 'cancelled' | 'error';

function assertState(state: TaskState, allowed: TaskState[], method: string): void {
  if (!allowed.includes(state)) throw new Error(`DownloadTask.${method}: state is ${state}`);
}

/** One downloadAsync() or resumeAsync() call, driven by the test. */
export class FakeDownload {
  /** Bytes the destination (android) or the temp file (ios) holds. */
  received: number;
  settled = false;
  private resolve!: (value: File | null) => void;
  private reject!: (error: Error) => void;
  readonly promise: Promise<File | null>;

  constructor(
    readonly task: DownloadTask,
    readonly kind: 'download' | 'resume',
    /** Where the operation started (0 for a fresh download). */
    readonly offset: number,
  ) {
    this.received = offset;
    this.promise = new Promise<File | null>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  get url(): string {
    return this.task.url;
  }

  get sessionType(): string | undefined {
    return this.task.options?.sessionType;
  }

  private content(): Bytes {
    const bytes = served.get(this.task.url);
    if (!bytes) throw new Error(`fakeFs: nothing served at ${this.task.url}`);
    return bytes;
  }

  /** The server sends bytes up to `absoluteBytes`; onProgress fires (absolute, full total). */
  progress(absoluteBytes: number, opts: { relative?: boolean } = {}): void {
    if (this.settled) throw new Error('fakeFs: operation already settled');
    const content = this.content();
    const next = Math.min(absoluteBytes, content.length);
    if (platform === 'android') {
      const dest = this.task.destination.uri;
      const existing = files.get(dest)?.bytes ?? new Uint8Array(0);
      writeEntry(dest, concat(existing.slice(0, this.received), content.slice(this.received, next)));
    }
    this.received = next;
    // iOS may report bytes relative to the resume point with the remaining length as total.
    const event = opts.relative
      ? { bytesWritten: next - this.offset, totalBytes: content.length - this.offset }
      : { bytesWritten: next, totalBytes: content.length };
    this.task.options?.onProgress?.(event);
  }

  /** A raw progress event, as native code forwards it (any bytesWritten and totalBytes). */
  emit(event: DownloadProgressEvent): void {
    if (this.settled) throw new Error('fakeFs: operation already settled');
    this.task.options?.onProgress?.(event);
  }

  /**
   * The transfer finishes. `corrupt` flips a byte; `truncate` drops the last bytes; `landAt`
   * writes the file to another URI (iOS) and resolves with that File.
   */
  complete(opts: { corrupt?: boolean; truncate?: number; landAt?: string } = {}): void {
    if (this.settled) throw new Error('fakeFs: operation already settled');
    let bytes = this.content().slice();
    if (opts.corrupt) bytes[Math.floor(bytes.length / 2)] = ((bytes[Math.floor(bytes.length / 2)] as number) + 1) & 0xff;
    if (opts.truncate) bytes = bytes.slice(0, bytes.length - opts.truncate);
    const dest = opts.landAt ? fileKey(opts.landAt) : this.task.destination.uri;
    if (platform === 'android') {
      const existing = files.get(dest)?.bytes ?? new Uint8Array(0);
      writeEntry(dest, concat(existing.slice(0, this.received), bytes.slice(this.received)));
    } else {
      writeEntry(dest, bytes);
    }
    this.received = bytes.length;
    this.settled = true;
    this.task.state = 'completed';
    this.task.options?.onProgress?.({ bytesWritten: bytes.length, totalBytes: bytes.length });
    this.resolve(new File(dest));
  }

  /** The transfer fails (network error, HTTP error, disk full...). */
  fail(message = 'The network connection was lost.'): void {
    if (this.settled) throw new Error('fakeFs: operation already settled');
    this.settled = true;
    this.task.state = 'error';
    this.reject(new Error(message));
  }

  /** Called by DownloadTask.pause(): resolves null and hands back resume data. */
  pauseNow(): string | undefined {
    if (this.settled) return undefined;
    this.settled = true;
    this.task.state = 'paused';
    this.resolve(null);
    if (platform === 'android') {
      const length = files.get(this.task.destination.uri)?.bytes.length ?? 0;
      return length > 0 ? String(length) : String(this.received);
    }
    return this.received > 0 ? btoa(JSON.stringify({ received: this.received, url: this.task.url })) : undefined;
  }

  /** Called by DownloadTask.cancel(). */
  cancelNow(): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(Object.assign(new Error('Download was cancelled'), { code: 'ERR_DOWNLOAD_CANCELLED' }));
  }
}

export class DownloadTask {
  state: TaskState = 'idle';
  resumeData: string | undefined;
  current: FakeDownload | null = null;

  constructor(
    readonly url: string,
    readonly destination: File | Directory,
    readonly options?: TaskOptions,
  ) {}

  async downloadAsync(): Promise<File | null> {
    assertState(this.state, ['idle'], 'downloadAsync');
    this.state = 'active';
    if (platform === 'android') writeEntry(this.destination.uri, new Uint8Array(0));
    const op = new FakeDownload(this, 'download', 0);
    this.current = op;
    operations.push(op);
    return op.promise;
  }

  pause(): void {
    assertState(this.state, ['active'], 'pause');
    if (losePauses) return;
    this.resumeData = this.current?.pauseNow();
  }

  async pauseAsync(): Promise<void> {
    this.pause();
    await this.current?.promise.catch(() => null);
  }

  async resumeAsync(): Promise<File | null> {
    assertState(this.state, ['paused'], 'resumeAsync');
    if (!this.resumeData) throw new Error('No resume data available.');
    let offset: number;
    if (platform === 'android') {
      offset = Number(this.resumeData);
      if (!Number.isFinite(offset)) throw new Error('Invalid resume data');
      const existing = files.get(this.destination.uri)?.bytes ?? new Uint8Array(0);
      writeEntry(this.destination.uri, existing.slice(0, offset));
    } else {
      try {
        const decoded = JSON.parse(atob(this.resumeData)) as { received: number; url: string };
        if (decoded.url !== this.url || !(iosTempFiles.get(this.resumeData) ?? true)) throw new Error('stale');
        offset = decoded.received;
      } catch {
        this.state = 'error';
        throw new Error('The resume data is invalid');
      }
    }
    this.state = 'active';
    const op = new FakeDownload(this, 'resume', offset);
    this.current = op;
    operations.push(op);
    return op.promise;
  }

  cancel(): void {
    if (['completed', 'cancelled', 'error'].includes(this.state)) return;
    this.state = 'cancelled';
    this.current?.cancelNow();
  }

  savable(): DownloadPauseState {
    assertState(this.state, ['paused'], 'savable');
    return {
      url: this.url,
      fileUri: this.destination.uri,
      isDirectory: this.destination instanceof Directory,
      headers: this.options?.headers,
      resumeData: this.resumeData,
    };
  }

  release(): void {}

  static fromSavable(state: DownloadPauseState, options?: TaskOptions): DownloadTask {
    if (!state.resumeData) throw new Error('Cannot restore task: DownloadPauseState has no resumeData');
    const dest = state.isDirectory ? new Directory(state.fileUri) : new File(state.fileUri);
    const task = new DownloadTask(state.url, dest, options);
    task.resumeData = state.resumeData;
    task.state = 'paused';
    return task;
  }
}

/** iOS resume data marked stale (the system purged its temp file). */
const iosTempFiles = new Map<string, boolean>();

/** Test controls. */
export const fakeFs = {
  /** Empties every file and directory and sets the platform style of downloads. */
  reset(opts: { platform?: FakePlatform; freeBytes?: number; digest?: DigestMode; digestImpl?: (bytes: Bytes) => string } = {}): void {
    files.clear();
    dirs.clear();
    served.clear();
    operations.length = 0;
    iosTempFiles.clear();
    sizeFailures.clear();
    bigIntSizes = false;
    platform = opts.platform ?? 'android';
    freeBytes = opts.freeBytes ?? 50_000_000_000;
    digestMode = opts.digest ?? 'throw';
    digestImpl = opts.digestImpl ?? null;
    losePauses = false;
    now = 1_000_000;
    dirs.add(DOCUMENT);
  },
  /** Makes pause() calls get lost (pauseAsync() then waits for the transfer to end). */
  losePauses(lose: boolean): void {
    losePauses = lose;
  },
  setFreeBytes(bytes: number): void {
    freeBytes = bytes;
  },
  setDigest(mode: DigestMode, impl?: (bytes: Bytes) => string): void {
    digestMode = mode;
    if (impl) digestImpl = impl;
  },
  /** What the server returns for `url`. */
  serve(url: string, bytes: Bytes): void {
    served.set(url, bytes);
  },
  writeFile(uri: string, bytes: Bytes, mtime?: number): void {
    writeEntry(uri, bytes, mtime ?? tick());
  },
  readFile(uri: string): Bytes | null {
    return files.get(fileKey(uri))?.bytes ?? null;
  },
  exists(uri: string): boolean {
    return files.has(fileKey(uri));
  },
  /** Every file URI, sorted. */
  list(): string[] {
    return [...files.keys()].sort();
  },
  dirExists(uri: string): boolean {
    return dirs.has(dirKey(uri));
  },
  /** Every download operation started so far (downloadAsync and resumeAsync calls). */
  operations(): readonly FakeDownload[] {
    return operations;
  },
  lastDownload(): FakeDownload {
    const op = operations[operations.length - 1];
    if (!op) throw new Error('fakeFs: no download was started');
    return op;
  },
  /**
   * The next `count` File#size reads of `uri` fail: 'throw' (iOS getAttribute error), 'nan', or
   * 'zero' (what expo-file-system's iOS size property returns when the read fails).
   */
  /** File#size returns BigInt from now on (iOS: Swift Int64). Reset by reset(). */
  useBigIntSizes(on = true): void {
    bigIntSizes = on;
  },

  failSizeReads(uri: string, count: number, mode: SizeFailure = 'throw'): void {
    sizeFailures.set(fileKey(uri), { count, mode });
  },
  /** Makes saved iOS resume data unusable (as if iOS purged the temp file). */
  invalidateResumeData(resumeData: string): void {
    iosTempFiles.set(resumeData, false);
  },
  /** Advances the clock used for modification times. */
  advance(ms: number): void {
    now += ms;
  },
  get now(): number {
    return now;
  },
};

fakeFs.reset();
