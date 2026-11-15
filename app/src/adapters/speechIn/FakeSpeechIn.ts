/**
 * SpeechIn for tests. The test plays the learner and the recognizer:
 *
 * - say(utterance): while listening, emits growing partials (when the session asked for
 *   `interim`), then the final transcript with per-word timings, then onEnd.
 * - queueUtterance(utterance): said automatically at the next stop(), like a learner who spoke
 *   while holding and then let go. Without a queued utterance, stop() just ends the session.
 * - emitPartial / emitLevel / emitFinal / emitError for exact control.
 *
 * Permission starts 'granted' unless set; requestPermission() turns 'undetermined' into
 * `requestResult`. durationMs is measured on the injected clock (use a FakeClock and advance it).
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { wordSpans } from '../speechOut/wordSpans';
import { SpeechInBase } from './SpeechInBase';
import type {
  ListenOptions,
  SpeechInCapabilities,
  SpeechInErrorCode,
  SpeechPermission,
  TranscriptWord,
} from './types';

export interface ScriptedUtterance {
  text: string;
  /** Spoken length of each word, in ms. Default 350. */
  msPerWord?: number;
  /** Pause between words, in ms. Default 120. */
  gapMs?: number;
  /** Levels (dBFS) to emit before the words, e.g. [-40, -12, -20]. */
  levels?: readonly number[];
}

export interface FakeSpeechInOptions {
  clock?: Clock;
  permission?: SpeechPermission;
  /** What requestPermission() turns 'undetermined' into. Default 'granted'. */
  requestResult?: Extract<SpeechPermission, 'granted' | 'denied'>;
  capabilities?: Partial<SpeechInCapabilities>;
}

const toUtterance = (u: string | ScriptedUtterance): ScriptedUtterance => (typeof u === 'string' ? { text: u } : u);

export class FakeSpeechIn extends SpeechInBase {
  readonly kind = 'fake' as const;
  readonly capabilities: SpeechInCapabilities;
  /** Options of every start() call, in order. */
  readonly startCalls: ListenOptions[] = [];
  stopCalls = 0;
  abortCalls = 0;
  permission: SpeechPermission;

  private readonly clock: Clock;
  private readonly requestResult: 'granted' | 'denied';
  private readonly queue: ScriptedUtterance[] = [];
  private session: { opts: ListenOptions; startedAt: number } | null = null;

  constructor(opts: FakeSpeechInOptions = {}) {
    super();
    this.clock = opts.clock ?? systemClock;
    this.permission = opts.permission ?? 'granted';
    this.requestResult = opts.requestResult ?? 'granted';
    this.capabilities = {
      speech: true,
      onDevice: true,
      partials: true,
      levels: true,
      wordTimings: true,
      ...opts.capabilities,
    };
  }

  /** Options of the running session, or null. */
  get currentOptions(): ListenOptions | null {
    return this.session?.opts ?? null;
  }

  async permissionStatus(): Promise<SpeechPermission> {
    return this.permission;
  }

  async requestPermission(): Promise<SpeechPermission> {
    if (this.permission === 'undetermined') this.permission = this.requestResult;
    return this.permission;
  }

  async start(opts: ListenOptions): Promise<void> {
    this.startCalls.push(opts);
    if (this.listening) {
      this.errors.emit({ code: 'busy' });
      return;
    }
    if (this.permission !== 'granted') {
      this.failStart({ code: 'not-allowed' });
      return;
    }
    this.session = { opts, startedAt: this.clock.now() };
    this.listening = true;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (!this.listening) return;
    const next = this.queue.shift();
    if (next) this.say(next);
    else this.finishSession();
  }

  abort(): void {
    this.abortCalls += 1;
    this.finishSession();
  }

  /** The utterance is said at the next stop(). Several queue up, one per stop(). */
  queueUtterance(utterance: string | ScriptedUtterance): void {
    this.queue.push(toUtterance(utterance));
  }

  /** Says `utterance` now: levels, growing partials, the final with word timings, onEnd. */
  say(utterance: string | ScriptedUtterance): void {
    const u = toUtterance(utterance);
    const session = this.requireSession('say');
    for (const db of u.levels ?? []) this.levels.emit(db);
    const msPerWord = u.msPerWord ?? 350;
    const gapMs = u.gapMs ?? 120;
    const words: TranscriptWord[] = wordSpans(u.text).map((span, i) => {
      const startMs = i * (msPerWord + gapMs);
      return { text: span.text, startMs, endMs: startMs + msPerWord };
    });
    if (session.opts.interim) {
      for (const span of wordSpans(u.text)) this.partials.emit(u.text.slice(0, span.end));
    }
    const spoken = words.length ? (words[words.length - 1] as TranscriptWord).endMs : 0;
    this.emitFinal(u.text, { words, durationMs: Math.max(spoken, this.clock.now() - session.startedAt) });
  }

  emitPartial(text: string): void {
    this.requireSession('emitPartial');
    this.partials.emit(text);
  }

  emitLevel(db: number): void {
    this.requireSession('emitLevel');
    this.levels.emit(db);
  }

  /** Emits the final transcript and ends the session. durationMs defaults to the clock's elapsed time. */
  emitFinal(text: string, extra: { words?: TranscriptWord[]; durationMs?: number; confidence?: number } = {}): void {
    const session = this.requireSession('emitFinal');
    this.finals.emit({
      text,
      words: extra.words,
      durationMs: extra.durationMs ?? this.clock.now() - session.startedAt,
      source: 'speech',
      confidence: extra.confidence,
    });
    this.finishSession();
  }

  /** Emits an error and ends the session. */
  emitError(code: SpeechInErrorCode, message?: string): void {
    this.requireSession('emitError');
    this.errors.emit({ code, message });
    this.finishSession();
  }

  private finishSession(): void {
    this.session = null;
    this.endSession();
  }

  private requireSession(method: string): { opts: ListenOptions; startedAt: number } {
    if (!this.session) throw new Error(`FakeSpeechIn.${method}: not listening (call start() first)`);
    return this.session;
  }
}
