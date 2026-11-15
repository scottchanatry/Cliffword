/**
 * Speech recognition: "hold anywhere to speak", cliff answers, retells, sing-backs and the
 * spoken commands (otra vez, más despacio, no sé, siguiente, listo).
 *
 * A session runs from start() to its end. In order, it emits:
 *   onPartial (zero or more, when `interim`) -> onFinal (at most once, with the whole
 *   transcript) -> onEnd (exactly once).
 * A failed session emits onError and then onEnd, with no onFinal. abort() ends the session
 * with onEnd only. start() never throws for runtime conditions (no permission, no recognizer,
 * already listening): it reports them through onError.
 *
 * "Type instead" is always offered: submitTyped(text) on any implementation emits an onFinal
 * with source 'typed', so the app's answer pipeline only ever listens to onFinal.
 *
 * Levels: onLevel gives the raw input level in dBFS (for the app's own measurements);
 * onMeter gives the same stream as 0..1, smoothed, for the hold-to-speak animation, and a
 * last 0 when the session ends.
 *
 * Before the learner holds, availability() says what listening would do (ready, needs
 * permission, language missing, ...) so the screen can show a status and keep "Type instead".
 * Show error and status text through i18n: speechInErrorKey(code) / speechInStatusKey(status)
 * in ./messages.ts.
 *
 * Implementations:
 * - FakeSpeechIn: driven by tests (scripted transcripts, errors, levels).
 * - BrowserSpeechIn: the browser's SpeechRecognition (web, when present).
 * - TypedSpeechIn: no recognizer; typed answers only (web without SpeechRecognition, and native
 *   builds whose binary lacks the recognition module).
 * - ExpoSpeechIn: expo-speech-recognition on iOS and Android, on-device by default.
 */
import type { Unsubscribe } from '../listeners';

export type SpeechPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export type SpeechInKind = 'native' | 'browser' | 'typed' | 'fake';

export interface ListenOptions {
  /**
   * BCP 47 language to recognize, e.g. 'es-US'. The first choice: when the recognizer lacks it,
   * the first supported locale of `langFallbacks` is used (recognitionLocales() in ./locales.ts
   * builds the list from the pair's target language and the learner's regions).
   */
  lang: string;
  /** Other locales to try, in order, when `lang` is not supported (e.g. ['es-MX', 'es-ES']). */
  langFallbacks?: readonly string[];
  /**
   * Require on-device recognition (the product default: private, offline). true: when the
   * device cannot recognize the language on the device, the session fails with
   * 'on-device-unavailable' and never falls back to a server. false (only when the learner
   * allowed network recognition in settings): on-device is still used when available, else the
   * platform's server recognizer. The browser recognizer may use a server either way (see
   * capabilities.onDevice).
   */
  onDevice: boolean;
  /** Emit onPartial while the learner speaks. */
  interim: boolean;
  /** Keep listening across pauses until stop(): hold to speak, retell, sing-back. Default false:
   * the recognizer may end the session after the first pause. */
  continuous?: boolean;
  /** Words to expect (story words, slang, lyrics, command phrases); used where the platform
   * supports hints (iOS contextualStrings, Android 13+ biasing strings). */
  hints?: readonly string[];
}

/** A recognized word. Structurally the engine's TimedWord (retellMetrics, retellCoverage). */
export interface TranscriptWord {
  text: string;
  /** Milliseconds from the start of the session (the start() call). */
  startMs: number;
  endMs: number;
  confidence?: number;
}

/**
 * Where FinalTranscript.words timings come from:
 * - 'measured': start and end from the recognizer (iOS);
 * - 'starts': starts from the recognizer, ends estimated from word length (Android 14+ with
 *   the on-device Google recognizer);
 * - 'estimated': both estimated from the audio: words spread over the voiced parts of the input
 *   level, else over the recording (Android without word timings). Pauses are approximate.
 */
export type WordTimingSource = 'measured' | 'starts' | 'estimated';

export interface FinalTranscript {
  text: string;
  /** Per-word timings, when the implementation gives them (capabilities.wordTimings). */
  words?: TranscriptWord[];
  /** How `words` were timed (absent when there are no words). */
  wordTiming?: WordTimingSource;
  /** Length of the session in ms, from start() to its end (0 for typed answers). */
  durationMs: number;
  /**
   * Time spent speaking, in ms: voiced time from the input level when the recognizer reports
   * levels, else the span of the word timings. Feeds "minutes spoken" (the engine's addSpoken);
   * read it with spokenMsOf(transcript), which falls back to the words and then durationMs.
   */
  spokenMs?: number;
  /** 'speech' from the recognizer, 'typed' from submitTyped(). */
  source: 'speech' | 'typed';
  /** 0 to 1, when the recognizer reports one. */
  confidence?: number;
  /** Other readings of the whole utterance, best first (never the same as `text`). */
  alternatives?: string[];
  /** The locale the recognizer used, e.g. 'es-US'. */
  locale?: string;
  /** True when the audio never left the device. */
  onDevice?: boolean;
}

export type SpeechInErrorCode =
  /** Microphone or speech permission refused. */
  | 'not-allowed'
  /** Nothing was heard (or the hold ended before the learner spoke). */
  | 'no-speech'
  /** Speech was heard but not recognized as words (Android ERROR_NO_MATCH, iOS nomatch). */
  | 'no-match'
  /** The microphone could not be opened. */
  | 'audio-capture'
  /** A server-based recognizer could not be reached. */
  | 'network'
  /** No recognizer for the language. */
  | 'language-not-supported'
  /** The language needs an on-device model that this device lacks or has not downloaded
   * (Android language pack; iOS without on-device support), and network recognition is off. */
  | 'on-device-unavailable'
  /** start() while a session is running; the running session continues. */
  | 'busy'
  /** Something else (another app, a call, the system) stopped the session. */
  | 'interrupted'
  /** This implementation cannot recognize speech (typed answers only). */
  | 'unavailable'
  | 'unknown';

/** An error event. `message` is for logs; the app shows text by `code` through i18n. */
export interface SpeechInError {
  code: SpeechInErrorCode;
  message?: string;
}

export interface SpeechInCapabilities {
  /** Recognizes speech at all. False: typed answers only. */
  speech: boolean;
  /** Recognition runs on the device. */
  onDevice: boolean;
  /** Emits onPartial. */
  partials: boolean;
  /** Emits onLevel and onMeter. */
  levels: boolean;
  /** FinalTranscript.words is filled. */
  wordTimings: boolean;
}

/**
 * What listening would do now, for the status line and the permission card:
 * - 'ready': hold to speak works;
 * - 'needs-permission': ask (requestPermission(), or the first hold asks);
 * - 'permission-denied': only the system Settings can turn it back on;
 * - 'language-not-supported': no recognizer for the language;
 * - 'on-device-unavailable': the on-device model is missing; see SpeechAvailability.canDownload;
 * - 'unavailable': no recognizer at all.
 * "Type instead" works in every state.
 */
export type SpeechInStatus =
  | 'ready'
  | 'needs-permission'
  | 'permission-denied'
  | 'language-not-supported'
  | 'on-device-unavailable'
  | 'unavailable';

export interface SpeechAvailability {
  status: SpeechInStatus;
  permission: SpeechPermission;
  /** The locale a session would use, or null when none fits. */
  locale: string | null;
  /** A session would recognize on the device. */
  onDevice: boolean;
  /** downloadLanguage() can fetch the on-device model (Android 13+). */
  canDownload: boolean;
}

/** What availability() needs from the listen options. */
export type AvailabilityQuery = Pick<ListenOptions, 'lang' | 'langFallbacks' | 'onDevice'>;

/** downloadLanguage() result: 'done' (ready now), 'started' (a system download or dialog is
 * under way), 'unsupported' (not possible here) or 'failed'. */
export type LanguageDownload = 'done' | 'started' | 'unsupported' | 'failed';

export interface SpeechIn {
  readonly kind: SpeechInKind;
  readonly capabilities: SpeechInCapabilities;
  /** True from a successful start() until the session's onEnd. */
  readonly isListening: boolean;

  /** Current permission, without asking. 'unsupported' when there is nothing to ask for. */
  permissionStatus(): Promise<SpeechPermission>;
  /** Asks for microphone (and speech recognition) permission if not decided yet. */
  requestPermission(): Promise<SpeechPermission>;
  /** What a session with these options would do now. Never throws and never asks. */
  availability(query: AvailabilityQuery): Promise<SpeechAvailability>;
  /** Fetches the on-device model for the language when the platform allows it (Android 13+). */
  downloadLanguage(lang: string): Promise<LanguageDownload>;

  /** Starts a session. Resolves once listening has begun (or the failure was reported). */
  start(opts: ListenOptions): Promise<void>;
  /** Asks the recognizer to finish: the final transcript and onEnd follow. Called before the
   * recognizer has started listening (a hold that ends early), it cancels: onEnd only. */
  stop(): Promise<void>;
  /** Ends the session at once, discarding what was heard (onEnd only). */
  abort(): void;
  /** "Type instead": emits onFinal { text, source: 'typed' }. Aborts a running session first.
   * Blank text is ignored. */
  submitTyped(text: string): void;

  onPartial(listener: (text: string) => void): Unsubscribe;
  onFinal(listener: (transcript: FinalTranscript) => void): Unsubscribe;
  /** Input level in dBFS: 0 is the loudest, about -60 and below is silence. */
  onLevel(listener: (db: number) => void): Unsubscribe;
  /** Input level for the hold-to-speak animation: 0 (silence) to 1, smoothed, at the level
   * rate (ExpoSpeechIn: at most one value per 50 ms), and a last 0 when the session ends. */
  onMeter(listener: (level: number) => void): Unsubscribe;
  onError(listener: (error: SpeechInError) => void): Unsubscribe;
  onEnd(listener: () => void): Unsubscribe;
}
