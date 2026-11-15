/**
 * SpeechOut for tests: records every call and reports estimated word timings
 * (estimateWordTimings) as boundaries. Nothing is played and the clock is never moved.
 *
 * - autoFinish (default): speak() reports every word boundary, then resolves completed: true.
 * - autoFinish: false: speak() stays pending; the test calls speakWords(n) to report the next
 *   words and finish() to end the utterance, or stop() to cut it off.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { filterVoices } from './voices';
import { estimateWordTimings, wordSpans, type TimingOptions, type WordTiming } from './wordSpans';
import type { SpeakOptions, SpeakResult, SpeechOut, Voice } from './types';

export const FAKE_VOICES: readonly Voice[] = [
  { id: 'fake.es-ES.enhanced', name: 'Lucía', lang: 'es-ES', quality: 'enhanced' },
  { id: 'fake.es-MX', name: 'Paulina', lang: 'es-MX', quality: 'default' },
  { id: 'fake.es-PR', name: 'Marisol', lang: 'es-PR', quality: 'default' },
  { id: 'fake.en-US', name: 'Samantha', lang: 'en-US', quality: 'default' },
];

export interface FakeSpeechOutOptions {
  clock?: Clock;
  voices?: readonly Voice[];
  autoFinish?: boolean;
  /** Overrides for the timing estimate (the call's rate is applied on top). */
  timing?: Partial<Omit<TimingOptions, 'rate'>>;
}

/** One recorded speak() call. */
export interface SpokenCall {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: string;
  /** The estimated timings reported (or to be reported) as boundaries. */
  timings: WordTiming[];
  startedAt: number;
  /** null while pending; set when the utterance ends. */
  completed: boolean | null;
}

interface Pending {
  call: SpokenCall;
  reported: number;
  onWordBoundary?: SpeakOptions['onWordBoundary'];
  resolve: (result: SpeakResult) => void;
}

export class FakeSpeechOut implements SpeechOut {
  readonly calls: SpokenCall[] = [];
  stopCount = 0;

  private readonly clock: Clock;
  private readonly voiceList: readonly Voice[];
  private readonly autoFinish: boolean;
  private readonly timing: Partial<TimingOptions>;
  private pending: Pending | null = null;

  constructor(opts: FakeSpeechOutOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.voiceList = opts.voices ?? FAKE_VOICES;
    this.autoFinish = opts.autoFinish ?? true;
    this.timing = opts.timing ?? {};
  }

  get isSpeaking(): boolean {
    return this.pending !== null;
  }

  /** The most recent call, if any. */
  get lastCall(): SpokenCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  /** The texts spoken so far, in order. */
  get spokenTexts(): string[] {
    return this.calls.map((c) => c.text);
  }

  speak(text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
    if (this.pending) this.end(false);
    const call: SpokenCall = {
      text,
      lang: opts.lang,
      rate: opts.rate,
      pitch: opts.pitch,
      voice: opts.voice,
      timings: estimateWordTimings(opts.words ?? wordSpans(text), { ...this.timing, rate: opts.rate ?? 1 }),
      startedAt: this.clock.now(),
      completed: null,
    };
    this.calls.push(call);
    const result = new Promise<SpeakResult>((resolve) => {
      this.pending = { call, reported: 0, onWordBoundary: opts.onWordBoundary, resolve };
    });
    if (this.autoFinish) this.finish();
    return result;
  }

  /** Manual mode: reports the boundaries of the next `count` words. */
  speakWords(count = 1): void {
    const p = this.pending;
    if (!p) throw new Error('FakeSpeechOut.speakWords: nothing is speaking');
    const until = Math.min(p.call.timings.length, p.reported + count);
    for (; p.reported < until; p.reported++) {
      const t = p.call.timings[p.reported] as WordTiming;
      p.onWordBoundary?.({ text: t.text, start: t.start, end: t.end, index: t.index, elapsedMs: t.startMs });
    }
  }

  /** Reports the remaining boundaries and ends the utterance with completed: true. */
  finish(): void {
    const p = this.pending;
    if (!p) throw new Error('FakeSpeechOut.finish: nothing is speaking');
    this.speakWords(p.call.timings.length);
    this.end(true);
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    if (this.pending) this.end(false);
  }

  async voices(lang?: string): Promise<Voice[]> {
    return filterVoices(this.voiceList, lang);
  }

  private end(completed: boolean): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.call.completed = completed;
    p.resolve({ completed });
  }
}
