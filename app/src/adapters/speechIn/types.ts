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
 * Implementations:
 * - FakeSpeechIn: driven by tests (scripted transcripts, errors, levels).
 * - BrowserSpeechIn: the browser's SpeechRecognition (web, when present).
 * - TypedSpeechIn: no recognizer; typed answers only (web without SpeechRecognition, and native
 *   until expo-speech-recognition lands in a later stage).
 * - A native adapter over expo-speech-recognition (later stage), on device.
 */
import type { Unsubscribe } from '../listeners';

export type SpeechPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export type SpeechInKind = 'native' | 'browser' | 'typed' | 'fake';

export interface ListenOptions {
  /** BCP 47 language to recognize, e.g. 'es-ES'. */
  lang: string;
  /**
   * Recognize on the device (the product default: private, offline). Native adapters require
   * it; the browser recognizer may still use a server (see capabilities.onDevice).
   */
  onDevice: boolean;
  /** Emit onPartial while the learner speaks. */
  interim: boolean;
  /** Keep listening across pauses until stop() (retell, sing-back). Default false: the
   * recognizer ends the session after the first pause. */
  continuous?: boolean;
  /** Words to expect (story words, slang, lyrics); used where the platform supports hints. */
  hints?: readonly string[];
}

export interface TranscriptWord {
  text: string;
  /** Milliseconds from the start of the session. */
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface FinalTranscript {
  text: string;
  /** Per-word timings, when the recognizer gives them (capabilities.wordTimings). */
  words?: TranscriptWord[];
  /** Length of the session in ms (0 for typed answers). Feeds "minutes spoken". */
  durationMs: number;
  /** 'speech' from the recognizer, 'typed' from submitTyped(). */
  source: 'speech' | 'typed';
  /** 0 to 1, when the recognizer reports one. */
  confidence?: number;
}

export type SpeechInErrorCode =
  /** Microphone or speech permission refused. */
  | 'not-allowed'
  /** Nothing was heard. */
  | 'no-speech'
  /** The microphone could not be opened. */
  | 'audio-capture'
  /** A server-based recognizer could not be reached. */
  | 'network'
  /** No recognizer (or no on-device model) for the language. */
  | 'language-not-supported'
  /** start() while a session is running; the running session continues. */
  | 'busy'
  /** Something else (another app, the system) stopped the session. */
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
  /** Emits onLevel. */
  levels: boolean;
  /** FinalTranscript.words is filled. */
  wordTimings: boolean;
}

export interface SpeechIn {
  readonly kind: SpeechInKind;
  readonly capabilities: SpeechInCapabilities;
  /** True from a successful start() until the session's onEnd. */
  readonly isListening: boolean;

  /** Current permission, without asking. 'unsupported' when there is nothing to ask for. */
  permissionStatus(): Promise<SpeechPermission>;
  /** Asks for microphone (and speech recognition) permission if not decided yet. */
  requestPermission(): Promise<SpeechPermission>;

  /** Starts a session. Resolves once listening has begun (or the failure was reported). */
  start(opts: ListenOptions): Promise<void>;
  /** Asks the recognizer to finish: the final transcript and onEnd follow. */
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
  onError(listener: (error: SpeechInError) => void): Unsubscribe;
  onEnd(listener: () => void): Unsubscribe;
}
