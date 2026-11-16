/**
 * One serial queue for every call into an engine session: a session's async steps must not
 * overlap, and its sync ones are not busy-safe. A busy job counts from the moment it is queued
 * until it ends, so the view shows a calm waiting state while model calls run.
 *
 * Shared by the session controllers (src/session/lyric; the story controller can adopt it: it
 * is the same queue as StoryControllerImpl.enqueue).
 */
export interface SerialQueueOptions {
  /** Called when the busy count goes from 0 to more, or back to 0. */
  onBusy?: (busy: boolean) => void;
  /** A job that threw. The queue goes on with the next job. */
  onError?: (error: unknown) => void;
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private busyJobs = 0;
  private closed = false;

  constructor(private readonly opts: SerialQueueOptions = {}) {}

  get busy(): boolean {
    return this.busyJobs > 0;
  }

  /** Run `job` after every earlier job. Resolves with its result, or undefined when it threw or the queue closed. */
  enqueue<T>(job: () => Promise<T> | T, busy = false): Promise<T | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    if (busy) {
      this.busyJobs += 1;
      if (this.busyJobs === 1) this.opts.onBusy?.(true);
    }
    const run = async (): Promise<T | undefined> => {
      try {
        if (this.closed) return undefined;
        return await job();
      } catch (e) {
        this.opts.onError?.(e);
        return undefined;
      } finally {
        if (busy) {
          this.busyJobs -= 1;
          if (this.busyJobs === 0) this.opts.onBusy?.(false);
        }
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result;
    return result;
  }

  /**
   * Resolves once every queued job, and what they set off (settled speech promises that queue
   * more jobs), has run.
   */
  async idle(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const tail = this.tail;
      await tail;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (tail === this.tail) return;
    }
  }

  /** No more jobs run (queued ones resolve undefined). */
  close(): void {
    this.closed = true;
  }
}
