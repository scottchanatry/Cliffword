/**
 * Model calls of a session: one at a time, and replayable after a prefetch.
 *
 * A device runtime (llama.rn) has one context; a prefetch that generates while the
 * learner speaks at the landing screen must not overlap the scoring of that answer. The
 * gate runs every call of a session, and of its prefetch, through one queue.
 *
 * Prefetch (StorySession.prefetch) runs the next step on a copy of the session through
 * the gate's recording view; the real step then runs through the replaying view, which
 * answers a call from the recording when the same request was made (same method, same
 * arguments) and calls the model otherwise. The LanguageModel contract makes every
 * request deterministic (generation is seeded), so a replayed answer is exactly what the
 * model would return: the story is the same whether or not a prefetch ran, and a step
 * whose inputs changed in between (the learner model, the settings, the time) simply
 * makes different requests and gets fresh answers.
 */
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';

type Method = 'scoreContinuation' | 'nextTokens' | 'generate';

export class ModelGate {
  private queue: Promise<unknown> = Promise.resolve();
  private recorded = new Map<string, Promise<unknown>>();
  /** Calls that reached the model. */
  calls = 0;
  /** Calls answered from a recording. */
  replayed = 0;
  /** Calls made by recording views (prefetch). */
  recordedCalls = 0;

  /**
   * `after`: the calls of a gate this one replaces (StorySession.setModel while a prefetch
   * still runs on the old gate) finish before this gate's first call starts, so model calls
   * never overlap across the switch either.
   */
  constructor(
    readonly model: LanguageModel,
    after?: Promise<unknown>,
  ) {
    if (after) this.queue = after.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Settles when every call queued so far has finished. */
  idle(): Promise<unknown> {
    return this.queue;
  }

  /** Run `fn` after every call queued before it. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /**
   * Stop this gate (its session switched models): calls that have not started yet fail
   * instead of reaching the model, so a prefetch still running on it ends at once (a
   * failed prefetch only costs the replay) and the replacing gate, which starts after
   * this one's queue, never runs a call beside it.
   */
  retire(): void {
    this.retired = true;
    this.recorded.clear();
  }

  private retired = false;

  private call<T>(method: Method, args: unknown[], invoke: () => Promise<T>, mode: 'record' | 'replay'): Promise<T> {
    if (this.retired) return Promise.reject(new Error('ModelGate: the model was replaced'));
    const key = JSON.stringify([method, args]);
    if (mode === 'replay') {
      const hit = this.recorded.get(key);
      if (hit) {
        this.replayed += 1;
        return hit as Promise<T>;
      }
    }
    const p = this.serial(() => {
      if (this.retired) return Promise.reject(new Error('ModelGate: the model was replaced'));
      this.calls += 1;
      if (mode === 'record') this.recordedCalls += 1;
      return invoke();
    });
    if (mode === 'record') {
      this.recorded.set(key, p);
      // A failed call is not replayed: the real step asks the model again.
      p.catch(() => {
        if (this.recorded.get(key) === p) this.recorded.delete(key);
      });
    }
    return p;
  }

  private view(mode: 'record' | 'replay'): LanguageModel {
    const m = this.model;
    return {
      id: m.id,
      scoreContinuation: (context: string, text: string): Promise<TokenScore[]> =>
        this.call('scoreContinuation', [context, text], () => m.scoreContinuation(context, text), mode),
      nextTokens: (context: string, k: number): Promise<TokenCandidate[]> =>
        this.call('nextTokens', [context, k], () => m.nextTokens(context, k), mode),
      generate: (prompt: string, opts: GenerateOptions): Promise<string[]> =>
        this.call('generate', [prompt, opts], () => m.generate(prompt, opts), mode),
    };
  }

  /** The view the session's own steps use: serialized, answering recorded requests from the recording. */
  replay(): LanguageModel {
    return this.view('replay');
  }

  /** The view a prefetch uses: serialized, keeping every answer for replay. */
  record(): LanguageModel {
    return this.view('record');
  }

  /** Forget every recorded answer. */
  clear(): void {
    this.recorded.clear();
  }

  /** Number of recorded answers kept. */
  get size(): number {
    return this.recorded.size;
  }
}
