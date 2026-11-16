/**
 * The voice of a session controller: picks the target-language voice in the learner's region
 * order once, and plays one text at a time through SpeechOut with the language pack's word
 * spans. A newer say() or stop() supersedes the one before (its token goes stale), so a
 * controller never acts on a cue the learner already moved past.
 *
 * Same behaviour as the story controller's voice() / play() / stopSpeaking() plumbing, shared so
 * both controllers can use it.
 */
import type { LanguagePack } from '@cliffword/engine';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import type { SpeechOut, WordBoundary, WordSpan } from '../../adapters/speechOut/types';
import { normalizeLang } from '../../adapters/speechOut/voices';

export interface VoiceChoice {
  lang: string;
  voice?: string;
}

/** The word and number segments of a text as spans, in order (never split on spaces). */
export function wordSpansOf(pack: Pick<LanguagePack, 'segment'>, text: string): WordSpan[] {
  return pack
    .segment(text)
    .filter((s) => s.kind === 'word' || s.kind === 'number')
    .map((s) => ({ text: s.text, start: s.start, end: s.end }));
}

/** completed: played to the end; stopped: superseded or stopped; failed: the voice could not play. */
export type SayOutcome = 'completed' | 'stopped' | 'failed';

export interface SpeakerDeps {
  speechOut: SpeechOut;
  pack: Pick<LanguagePack, 'code' | 'segment'>;
  /** The learner's slang regions (settings.regions), for the voice's locale order. */
  regions: () => readonly string[];
  deviceLocales?: readonly string[];
  onError?: (error: unknown) => void;
}

export class Speaker {
  private token = 0;
  private pending = 0;
  private pick: Promise<VoiceChoice> | null = null;

  constructor(private readonly deps: SpeakerDeps) {}

  /** Something is being said (or a say() is about to start). */
  get speaking(): boolean {
    return this.pending > 0;
  }

  /** The regions changed: pick the voice again at the next say(). */
  resetVoice(): void {
    this.pick = null;
  }

  /** The voice for the target language: the first installed one in the learner's region order. */
  voice(): Promise<VoiceChoice> {
    this.pick ??= (async (): Promise<VoiceChoice> => {
      const { pack, speechOut } = this.deps;
      const wanted = recognitionLocales(pack.code, this.deps.regions(), this.deps.deviceLocales ?? []);
      try {
        const voices = await speechOut.voices(pack.code);
        for (const lang of wanted) {
          const v = voices.find((x) => normalizeLang(x.lang) === normalizeLang(lang));
          if (v) return { lang: v.lang, voice: v.id };
        }
        const first = voices[0];
        if (first) return { lang: first.lang, voice: first.id };
      } catch {
        // The platform default voice for the language.
      }
      return { lang: wanted[0] ?? pack.code };
    })();
    return this.pick;
  }

  /**
   * Say `text` (superseding whatever is being said). `words` default to the pack's word spans of
   * the text; `onWord` gets each boundary while this say is current.
   */
  async say(text: string, opts: { rate: number; words?: readonly WordSpan[]; onWord?: (b: WordBoundary) => void }): Promise<SayOutcome> {
    const token = ++this.token;
    this.pending += 1;
    try {
      const voice = await this.voice();
      if (token !== this.token) return 'stopped';
      const result = await this.deps.speechOut.speak(text, {
        ...voice,
        rate: opts.rate,
        words: opts.words ?? wordSpansOf(this.deps.pack, text),
        ...(opts.onWord
          ? {
              onWordBoundary: (b: WordBoundary) => {
                if (token === this.token) opts.onWord?.(b);
              },
            }
          : {}),
      });
      return result.completed && token === this.token ? 'completed' : 'stopped';
    } catch (e) {
      this.deps.onError?.(e);
      return token === this.token ? 'failed' : 'stopped';
    } finally {
      this.pending -= 1;
    }
  }

  /** Stop what is being said; any say() in flight resolves 'stopped'. */
  stop(): void {
    this.token += 1;
    if (this.pending > 0) void this.deps.speechOut.stop().catch((e: unknown) => this.deps.onError?.(e));
  }
}
