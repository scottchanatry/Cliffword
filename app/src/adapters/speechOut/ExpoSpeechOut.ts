/**
 * SpeechOut over expo-speech: AVSpeechSynthesizer on iOS, TextToSpeech on Android and the
 * browser's speechSynthesis on web.
 *
 * expo-speech queues utterances; this adapter keeps one at a time (speak() stops the current
 * one) and settles each promise exactly once. After stop(), late callbacks from the platform
 * for the stopped utterance (web reports a cancel as an error, iOS as onStopped) are ignored.
 * Word boundaries arrive as character offsets and are mapped to the utterance's word spans.
 */
import * as ExpoSpeech from 'expo-speech';
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { filterVoices } from './voices';
import { spanIndexAt, wordSpans } from './wordSpans';
import { SpeechOutError, type SpeakOptions, type SpeakResult, type SpeechOut, type Voice } from './types';

/** The part of expo-speech this adapter uses (injectable for tests). */
export interface ExpoSpeechModule {
  speak(text: string, options?: ExpoSpeech.SpeechOptions): void;
  stop(): Promise<void>;
  getAvailableVoicesAsync(): Promise<ExpoSpeech.Voice[]>;
}

interface Active {
  token: number;
  settle: (result: SpeakResult) => void;
}

/** Native boundary events carry { charIndex, charLength }; web SpeechSynthesisEvents do too. */
interface BoundaryEvent {
  charIndex: number;
}

export class ExpoSpeechOut implements SpeechOut {
  private active: Active | null = null;
  private seq = 0;

  constructor(
    private readonly speech: ExpoSpeechModule = ExpoSpeech,
    private readonly clock: Clock = systemClock,
  ) {}

  get isSpeaking(): boolean {
    return this.active !== null;
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
    if (this.active) await this.stop();
    const token = ++this.seq;
    const spans = opts.words ?? wordSpans(text);
    let startedAt = this.clock.now();
    let lastIndex = -1;

    return new Promise<SpeakResult>((resolve, reject) => {
      // Runs `fn` only for the current utterance, once.
      const own = (fn: () => void) => {
        if (this.active?.token !== token) return;
        this.active = null;
        fn();
      };
      this.active = { token, settle: (result) => resolve(result) };

      const onWordBoundary = opts.onWordBoundary;
      const options: ExpoSpeech.SpeechOptions = {
        language: opts.lang,
        rate: opts.rate,
        pitch: opts.pitch,
        voice: opts.voice,
        onStart: () => {
          if (this.active?.token === token) startedAt = this.clock.now();
        },
        onDone: () => own(() => resolve({ completed: true })),
        onStopped: () => own(() => resolve({ completed: false })),
        onError: (error: Error) =>
          own(() => reject(new SpeechOutError('failed', error?.message || 'Speech synthesis failed.'))),
        onBoundary: onWordBoundary
          ? (event: BoundaryEvent) => {
              if (this.active?.token !== token) return;
              const index = spanIndexAt(spans, event.charIndex);
              const span = spans[index];
              if (!span || index <= lastIndex) return;
              lastIndex = index;
              onWordBoundary({ ...span, index, elapsedMs: this.clock.now() - startedAt });
            }
          : undefined,
      };

      try {
        this.speech.speak(text, options);
      } catch (error) {
        own(() => reject(new SpeechOutError('unavailable', error instanceof Error ? error.message : String(error))));
      }
    });
  }

  async stop(): Promise<void> {
    const active = this.active;
    this.active = null;
    active?.settle({ completed: false });
    try {
      await this.speech.stop();
    } catch {
      // Nothing to stop, or no voice engine: either way nothing is speaking now.
    }
  }

  async voices(lang?: string): Promise<Voice[]> {
    let list: ExpoSpeech.Voice[] | undefined;
    try {
      list = await this.speech.getAvailableVoicesAsync();
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return filterVoices(
      list.map((v) => ({
        id: v.identifier,
        name: v.name,
        lang: v.language,
        quality: v.quality === ExpoSpeech.VoiceQuality.Enhanced ? 'enhanced' : 'default',
      })),
      lang,
    );
  }
}
