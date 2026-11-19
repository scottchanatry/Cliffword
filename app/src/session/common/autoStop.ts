/**
 * When the microphone stops by itself in tap mode (the big mic button: a tap starts listening, a
 * second tap stops it). Pure: the controller feeds it the listen state as it is published and
 * asks whether to stop.
 *
 * - With levels (onMeter values), listening stops about `silenceMs` after the learner's voice
 *   was last heard: a level at or above `voiceLevel`, or a new partial transcript. Nothing is
 *   stopped before the learner has said something.
 * - Without levels (a recognizer that sends none), or in a noisy room, it stops at `capMs`.
 *
 * voiceLevel 0.45 is about -33 dBFS on the meter's scale (src/adapters/speechIn/levels.ts:
 * -60 dBFS is 0, 0 dBFS is 1): a quiet room sits near 0.15-0.25, speech near the phone 0.6-0.85.
 */
import type { ListenState } from '../contract';

export interface AutoStopOptions {
  /** Silence after speech that ends listening, ms. */
  silenceMs: number;
  /** Longest a tap-mode listen runs, ms. */
  capMs: number;
  /** Meter level (0..1) that counts as the learner's voice. */
  voiceLevel: number;
}

export const DEFAULT_AUTO_STOP: Readonly<AutoStopOptions> = { silenceMs: 1500, capMs: 6000, voiceLevel: 0.45 };

export class AutoStop {
  private readonly o: AutoStopOptions;
  private lastVoiceAt: number | null = null;
  private levels = false;
  private partial = '';

  constructor(
    private readonly startedAt: number,
    opts: Partial<AutoStopOptions> = {},
  ) {
    this.o = { ...DEFAULT_AUTO_STOP, ...opts };
  }

  /** A listen state was published at `at`. */
  observe(listen: ListenState, at: number): void {
    if (listen.phase !== 'listening') return;
    if (listen.level > 0) this.levels = true;
    if (listen.level >= this.o.voiceLevel) this.lastVoiceAt = at;
    const partial = listen.partial.trim();
    if (partial && partial !== this.partial) {
      this.partial = partial;
      this.lastVoiceAt = at;
    }
  }

  /** Listening should stop now: the cap, or silence after the voice (when levels come). */
  due(at: number): boolean {
    if (at - this.startedAt >= this.o.capMs) return true;
    return this.levels && this.lastVoiceAt !== null && at - this.lastVoiceAt >= this.o.silenceMs;
  }
}
