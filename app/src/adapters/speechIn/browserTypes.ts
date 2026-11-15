/**
 * The parts of the Web Speech API (SpeechRecognition) and of navigator that BrowserSpeechIn
 * uses, typed here because TypeScript's DOM library does not declare the recognizer itself.
 * Tests pass an object of this shape instead of the real globals.
 */

export interface BrowserRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface BrowserRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: BrowserRecognitionAlternative | undefined;
}

export interface BrowserRecognitionResultList {
  readonly length: number;
  readonly [index: number]: BrowserRecognitionResult | undefined;
}

export interface BrowserRecognitionEvent {
  /** Lowest index in `results` that changed. */
  readonly resultIndex: number;
  /** Every result of the session so far. */
  readonly results: BrowserRecognitionResultList;
}

export interface BrowserRecognitionErrorEvent {
  /** 'no-speech', 'aborted', 'audio-capture', 'network', 'not-allowed', 'service-not-allowed',
   * 'language-not-supported', ... */
  readonly error: string;
  readonly message?: string;
}

export interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: BrowserRecognitionEvent) => void) | null;
  onerror: ((event: BrowserRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type BrowserRecognitionConstructor = new () => BrowserRecognition;

export interface BrowserMediaStream {
  getTracks(): { stop(): void }[];
}

/** The globals BrowserSpeechIn reads (globalThis in a browser). */
export interface BrowserSpeechEnv {
  SpeechRecognition?: BrowserRecognitionConstructor;
  webkitSpeechRecognition?: BrowserRecognitionConstructor;
  navigator?: {
    permissions?: { query(descriptor: { name: string }): Promise<{ state: string }> };
    mediaDevices?: { getUserMedia(constraints: { audio: boolean }): Promise<BrowserMediaStream> };
  };
}

/** The recognizer constructor of `env`, standard name first; null when there is none. */
export function findRecognition(env: BrowserSpeechEnv): BrowserRecognitionConstructor | null {
  return env.SpeechRecognition ?? env.webkitSpeechRecognition ?? null;
}
