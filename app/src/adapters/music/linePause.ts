/**
 * Pausing at the end of a lyric line: the pieces every MusicPlayer shares for pauseAt().
 *
 * - pauseTarget(ms, opts): the position to pause at (ms - leadMs, never below 0).
 * - decidePause(state, targetMs): what pauseAt() does right away: arm the target, pause now (the
 *   target is up to PAUSE_TOLERANCE_MS behind the position), report that playback is already
 *   paused there, or cancel (no song, ended, too far past).
 * - PauseSlot: the one armed target and its promise; a new target replaces the old one.
 * - PausePoller: the line-end pause helper for players without a native timer. It reads the
 *   position (extrapolated is fine), sleeps until shortly before the target, then checks every
 *   `pollMs` and sleeps exactly the remainder for the last step, so the pause lands within a few
 *   ms of the target plus timer jitter (well inside PAUSE_TOLERANCE_MS). MusicKitPlayer uses the
 *   module's native timer instead and falls back to this one.
 */
import {
  PAUSE_TOLERANCE_MS,
  type PauseAtCancelReason,
  type PauseAtOptions,
  type PauseAtResult,
  type PlaybackState,
} from './types';

/** setTimeout/clearTimeout, injectable for tests (jest fake timers replace the globals anyway). */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The position pauseAt(ms, opts) aims for: ms - leadMs, at least 0. */
export function pauseTarget(ms: number, opts: PauseAtOptions = {}): number {
  const lead = Math.max(0, opts.leadMs ?? 0);
  return Math.max(0, ms - lead);
}

export type PauseDecision =
  | { kind: 'arm' }
  | { kind: 'pause-now' }
  | { kind: 'already-paused' }
  | { kind: 'cancel'; reason: PauseAtCancelReason };

/**
 * What pauseAt() does at once, given the current snapshot (positionMs read now) and the target.
 * A target ahead of the position is armed, even while paused (it fires once playback reaches it).
 */
export function decidePause(state: PlaybackState, targetMs: number, toleranceMs: number = PAUSE_TOLERANCE_MS): PauseDecision {
  if (!state.song) return { kind: 'cancel', reason: 'no-song' };
  if (state.status === 'ended') return { kind: 'cancel', reason: 'ended' };
  const past = state.positionMs - targetMs;
  if (past > toleranceMs) return { kind: 'cancel', reason: 'past-target' };
  if (past < 0) return { kind: 'arm' };
  return state.status === 'playing' ? { kind: 'pause-now' } : { kind: 'already-paused' };
}

interface Armed {
  token: number;
  targetMs: number;
  resolve: (result: PauseAtResult) => void;
}

/** The single armed pauseAt() target. Tokens tell a late native event from the current target. */
export class PauseSlot {
  private armed: Armed | null = null;
  private seq = 0;

  /** Arms a new target; the previous one resolves 'cancelled' / 'replaced'. */
  arm(targetMs: number): { token: number; promise: Promise<PauseAtResult> } {
    this.cancel('replaced');
    this.seq += 1;
    const token = this.seq;
    const promise = new Promise<PauseAtResult>((resolve) => {
      this.armed = { token, targetMs, resolve };
    });
    return { token, promise };
  }

  /** The armed target, or null. */
  current(): { token: number; targetMs: number } | null {
    return this.armed ? { token: this.armed.token, targetMs: this.armed.targetMs } : null;
  }

  /** Resolves the armed target as paused at positionMs. A stale token (or none armed) does nothing: false. */
  fire(token: number, positionMs: number): boolean {
    const armed = this.armed;
    if (!armed || armed.token !== token) return false;
    this.armed = null;
    armed.resolve({ outcome: 'paused', targetMs: armed.targetMs, positionMs });
    return true;
  }

  /** Resolves the armed target as cancelled. Nothing armed: false. */
  cancel(reason: PauseAtCancelReason): boolean {
    const armed = this.armed;
    if (!armed) return false;
    this.armed = null;
    armed.resolve({ outcome: 'cancelled', targetMs: armed.targetMs, reason });
    return true;
  }
}

/** What PausePoller reads and drives. */
export interface PausePollTarget {
  /** The current position in ms (an extrapolated value is fine). */
  positionMs(): number;
  isPlaying(): boolean;
  pause(): Promise<void>;
}

export interface PausePollerOptions {
  timers?: Timers;
  /** Check interval near the target, ms. Default 20. */
  pollMs?: number;
  /** Start checking every pollMs this long before the target, ms. Default 400. */
  windowMs?: number;
  /** Longest sleep far from the target or while paused, so seeks and stalls are noticed, ms. Default 1000. */
  maxSleepMs?: number;
}

/** Remaining time at or below which the poller pauses instead of sleeping again, ms. */
const PAUSE_EPSILON_MS = 3;
/** Re-check interval while playback is paused or loading, ms. */
const IDLE_RECHECK_MS = 250;

/**
 * The line-end pause helper (see the file header). One target at a time; arm() replaces the
 * previous target, whose promise resolves null, as cancel() does.
 */
export class PausePoller {
  private readonly timers: Timers;
  private readonly pollMs: number;
  private readonly windowMs: number;
  private readonly maxSleepMs: number;
  private handle: unknown = null;
  private finish: ((positionMs: number | null) => void) | null = null;

  constructor(opts: PausePollerOptions = {}) {
    this.timers = opts.timers ?? systemTimers;
    this.pollMs = Math.max(1, opts.pollMs ?? 20);
    this.windowMs = Math.max(this.pollMs, opts.windowMs ?? 400);
    this.maxSleepMs = Math.max(this.pollMs, opts.maxSleepMs ?? 1000);
  }

  /** Pauses `player` when it reaches targetMs. Resolves with the position after the pause, or null if cancelled. */
  arm(player: PausePollTarget, targetMs: number): Promise<number | null> {
    this.cancel();
    return new Promise<number | null>((resolve) => {
      let done = false;
      const finish = (positionMs: number | null) => {
        if (done) return;
        done = true;
        if (this.finish === finish) this.finish = null;
        this.clearTimer();
        resolve(positionMs);
      };
      this.finish = finish;

      const check = () => {
        this.handle = null;
        if (done) return;
        if (!player.isPlaying()) {
          this.handle = this.timers.setTimeout(check, Math.min(IDLE_RECHECK_MS, this.maxSleepMs));
          return;
        }
        const remaining = targetMs - player.positionMs();
        if (remaining <= PAUSE_EPSILON_MS) {
          player.pause().then(
            () => finish(player.positionMs()),
            () => finish(null),
          );
          return;
        }
        const delay =
          remaining > this.windowMs ? Math.min(remaining - this.windowMs, this.maxSleepMs) : Math.min(remaining, this.pollMs);
        this.handle = this.timers.setTimeout(check, delay);
      };
      check();
    });
  }

  /** Disarms the target; its promise resolves null. */
  cancel(): void {
    const finish = this.finish;
    this.finish = null;
    this.clearTimer();
    finish?.(null);
  }

  get armed(): boolean {
    return this.finish !== null;
  }

  private clearTimer(): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
  }
}
