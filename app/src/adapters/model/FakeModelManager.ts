/**
 * In-memory ModelManager for tests and web. Nothing is downloaded or written.
 *
 * - 'instant' mode (default): startDownload() steps through downloading, verifying and ready
 *   on its own (a microtask apart, so listeners see each state). With `initial: 'ready'`
 *   (default) the model is ready from the start, as on web, where the mock model runs.
 * - 'manual' mode: startDownload() moves to 'downloading' and waits; the test drives it with
 *   progressTo(), finishDownload(), verify(), complete() and fail().
 */
import { Listeners, type Unsubscribe } from '../listeners';
import { DEFAULT_MODEL } from './descriptor';
import type {
  DownloadProgress,
  ModelDescriptor,
  ModelFileErrorCode,
  ModelFileState,
  ModelFileStatus,
  ModelManager,
} from './types';

export interface FakeModelManagerOptions {
  descriptor?: ModelDescriptor;
  /** Starting status. Default 'ready'. */
  initial?: Extract<ModelFileStatus, 'absent' | 'ready'>;
  /** Default 'instant'. */
  mode?: 'instant' | 'manual';
  /** Default `memory://models/<fileName>`. */
  filePath?: string;
}

const tick = () => Promise.resolve();

export class FakeModelManager implements ModelManager {
  readonly descriptor: ModelDescriptor;
  readonly filePath: string;
  /** Test inspection: how many downloads were started (resumes included). */
  downloadsStarted = 0;

  private readonly mode: 'instant' | 'manual';
  private state: ModelFileState;
  private running: Promise<ModelFileStatus> | null = null;
  private settle: ((status: ModelFileStatus) => void) | null = null;
  private readonly listeners = new Listeners<ModelFileState>();

  constructor(opts: FakeModelManagerOptions = {}) {
    this.descriptor = opts.descriptor ?? DEFAULT_MODEL;
    this.filePath = opts.filePath ?? `memory://models/${this.descriptor.fileName}`;
    this.mode = opts.mode ?? 'instant';
    const ready = (opts.initial ?? 'ready') === 'ready';
    this.state = {
      status: ready ? 'ready' : 'absent',
      progress: this.progressOf(ready ? this.descriptor.bytes : 0),
      error: null,
    };
  }

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

  startDownload(): Promise<ModelFileStatus> {
    if (this.state.status === 'ready') return Promise.resolve('ready');
    if (this.running) return this.running;
    this.downloadsStarted += 1;
    const resumeFrom = this.state.status === 'absent' ? this.state.progress.bytesWritten : 0;
    this.running = new Promise<ModelFileStatus>((resolve) => {
      this.settle = resolve;
    });
    this.update({ status: 'downloading', progress: this.progressOf(resumeFrom), error: null });
    if (this.mode === 'instant') void this.runInstant();
    return this.running;
  }

  async cancel(): Promise<void> {
    if (!this.running) return;
    // The partial download is kept: the next startDownload() resumes from it.
    this.finish({ status: 'absent', progress: this.state.progress, error: null });
  }

  async delete(): Promise<void> {
    this.finish({ status: 'absent', progress: this.progressOf(0), error: null });
  }

  /** Manual mode: report `bytes` written so far. */
  progressTo(bytes: number): void {
    this.expect('downloading', 'progressTo');
    this.update({ ...this.state, progress: this.progressOf(bytes) });
  }

  /** Manual mode: the last byte arrived; status moves to 'verifying'. */
  finishDownload(): void {
    this.expect('downloading', 'finishDownload');
    this.update({ status: 'verifying', progress: this.progressOf(this.descriptor.bytes), error: null });
  }

  /** Manual mode: the checksum matched ('ready') or not ('error', checksum-mismatch). */
  verify(matches = true): void {
    this.expect('verifying', 'verify');
    if (matches) this.finish({ ...this.state, status: 'ready' });
    else this.finish({ status: 'error', progress: this.progressOf(0), error: 'checksum-mismatch' });
  }

  /** Manual mode: finishDownload() then verify(true). */
  complete(): void {
    if (this.state.status === 'downloading') this.finishDownload();
    this.verify(true);
  }

  /** Manual mode: the download or verification failed with `code`. */
  fail(code: ModelFileErrorCode = 'network'): void {
    if (!this.running) throw new Error('FakeModelManager.fail: no download is running');
    this.finish({ status: 'error', progress: this.state.progress, error: code });
  }

  /** Each step checks the status afresh: a cancel() or delete() may have run in between. */
  private async runInstant(): Promise<void> {
    await tick();
    if (this.status() !== 'downloading') return;
    this.update({ ...this.state, progress: this.progressOf(this.descriptor.bytes) });
    await tick();
    if (this.status() !== 'downloading') return;
    this.update({ ...this.state, status: 'verifying' });
    await tick();
    if (this.status() !== 'verifying') return;
    this.finish({ ...this.state, status: 'ready' });
  }

  /** Ends the running download (if any) in `state` and resolves its promise. */
  private finish(state: ModelFileState): void {
    const settle = this.settle;
    this.running = null;
    this.settle = null;
    this.update(state);
    settle?.(state.status);
  }

  private update(state: ModelFileState): void {
    this.state = state;
    this.listeners.emit(state);
  }

  private expect(status: ModelFileStatus, method: string): void {
    if (this.state.status !== status) {
      throw new Error(`FakeModelManager.${method}: status is '${this.state.status}', expected '${status}'`);
    }
  }

  private progressOf(bytes: number): DownloadProgress {
    const total = this.descriptor.bytes;
    const written = Math.max(0, Math.min(total, bytes));
    return { bytesWritten: written, bytesTotal: total, fraction: total > 0 ? written / total : 0 };
  }
}
