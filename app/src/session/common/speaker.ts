/**
 * The voice of a session controller: picks the target-language voice in the learner's region
 * order once, and plays one text at a time through SpeechOut with the language pack's word
 * spans. A newer say() or stop() supersedes the one before (its token goes stale), so a
 * controller never acts on a cue the learner already moved past.
 *
 * Used by both session controllers (src/session/story, src/session/lyric).
 */
import type { LanguagePack } from '@cliffword/engine';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import type { SpeechOut, Voice, WordBoundary, WordSpan } from '../../adapters/speechOut/types';
import { normalizeLang, VOICE_LIST_TIMEOUT_MS } from '../../adapters/speechOut/voices';

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

/**
 * How long the installed-voice list may take (defined with the speech-out adapter, which bounds
 * its own voices() by it). A browser without speech voices never answers (expo-speech on the web
 * waits for 'voiceschanged'); after this the platform default voice for the language is used, so
 * a cue never blocks the session queue.
 */
export { VOICE_LIST_TIMEOUT_MS };

/** The voice list, or null when it did not come within VOICE_LIST_TIMEOUT_MS (the timer is always cleared). */
async function voicesWithin(speechOut: SpeechOut, lang: string, ms: number): Promise<Voice[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([speechOut.voices(lang), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The installed voices for a language, or none when the platform does not answer within
 * VOICE_LIST_TIMEOUT_MS or fails (the voice pickers of onboarding and Settings use it too).
 */
export async function installedVoices(speechOut: SpeechOut, lang: string): Promise<Voice[]> {
  try {
    return (await voicesWithin(speechOut, lang, VOICE_LIST_TIMEOUT_MS)) ?? [];
  } catch {
    return [];
  }
}

/** completed: played to the end; stopped: superseded or stopped; failed: the voice could not play. */
export type SayOutcome = 'completed' | 'stopped' | 'failed';

export interface SpeakerDeps {
  speechOut: SpeechOut;
  pack: Pick<LanguagePack, 'code' | 'segment'>;
  /** The learner's slang regions (settings.regions), for the voice's locale order. */
  regions: () => readonly string[];
  /** The voice the learner chose (settings.voiceId); null or not installed: picked by region. */
  voiceId?: () => string | null;
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

  /** The regions or the chosen voice changed: pick the voice again at the next say(). */
  resetVoice(): void {
    this.pick = null;
  }

  /**
   * The voice for the target language: the learner's chosen one (settings.voiceId) when it is
   * installed, else the first installed one in the learner's region order ("Automatic", the
   * same pick as useVoices' autoVoice). Without an answer from the platform in
   * VOICE_LIST_TIMEOUT_MS: the platform default for the first locale.
   */
  voice(): Promise<VoiceChoice> {
    this.pick ??= (async (): Promise<VoiceChoice> => {
      const { pack, speechOut } = this.deps;
      const wanted = recognitionLocales(pack.code, this.deps.regions(), this.deps.deviceLocales ?? []);
      try {
        const voices = (await voicesWithin(speechOut, pack.code, VOICE_LIST_TIMEOUT_MS)) ?? [];
        const chosenId = this.deps.voiceId?.() ?? null;
        const chosen = chosenId ? voices.find((x) => x.id === chosenId) : undefined;
        if (chosen) return { lang: chosen.lang, voice: chosen.id };
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
