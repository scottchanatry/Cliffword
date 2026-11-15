/**
 * Text to speech: the story voice, tile rehearing, "otra vez" and "más despacio".
 *
 * Implementations:
 * - ExpoSpeechOut: expo-speech, the platform voices (AVSpeechSynthesizer on iOS, Android
 *   TextToSpeech, speechSynthesis on web). Used on every platform.
 * - FakeSpeechOut: records calls and reports estimated word timings; for tests.
 */

/** A word of the spoken text, as character offsets into it. */
export interface WordSpan {
  text: string;
  /** Offset of the first character (inclusive). */
  start: number;
  /** Offset after the last character (exclusive). */
  end: number;
}

/** Reported when the voice reaches a word. */
export interface WordBoundary extends WordSpan {
  /** Index of the word in the spans used for this utterance. */
  index: number;
  /** Milliseconds since the utterance started. */
  elapsedMs: number;
}

export interface SpeakOptions {
  /** BCP 47 language of the text, e.g. 'es-ES'. Platform default when omitted. */
  lang?: string;
  /** 1 is the voice's normal rate (the engine's DifficultyParams.speechRate uses the same scale). */
  rate?: number;
  /** 1 is the voice's normal pitch. */
  pitch?: number;
  /** A Voice.id from voices(). Platform default for `lang` when omitted. */
  voice?: string;
  /**
   * The words of `text`. Pass the language pack's segmentation (never assume spaces separate
   * words); a Unicode word pattern is used when omitted. Boundaries refer to these spans.
   */
  words?: readonly WordSpan[];
  /** Called as the voice reaches each word, in order, at most once per word. */
  onWordBoundary?: (boundary: WordBoundary) => void;
}

export interface SpeakResult {
  /** True when the whole text was spoken; false when stop() or a later speak() cut it off. */
  completed: boolean;
}

export interface Voice {
  /** Pass as SpeakOptions.voice. Platform-specific; read it from voices(), never hard-code it. */
  id: string;
  name: string;
  /** BCP 47, e.g. 'es-MX'. */
  lang: string;
  quality: 'default' | 'enhanced';
}

export type SpeechOutErrorCode = 'unavailable' | 'failed';

export class SpeechOutError extends Error {
  readonly code: SpeechOutErrorCode;

  constructor(code: SpeechOutErrorCode, message: string) {
    super(message);
    this.name = 'SpeechOutError';
    this.code = code;
  }
}

export interface SpeechOut {
  /**
   * Speaks `text`. Anything already playing is stopped first (its promise resolves with
   * completed: false). Resolves when the utterance ends; rejects with SpeechOutError when the
   * platform voice fails.
   */
  speak(text: string, opts?: SpeakOptions): Promise<SpeakResult>;
  /** Stops the current utterance, if any. */
  stop(): Promise<void>;
  /** Installed voices, enhanced first. With `lang` ('es' or 'es-MX'), only voices for it. */
  voices(lang?: string): Promise<Voice[]>;
  /** True from speak() until that utterance ends or is stopped. */
  readonly isSpeaking: boolean;
}
