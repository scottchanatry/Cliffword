/**
 * The seam between the session controllers (src/session/story, src/session/lyric) and the
 * views that render them (src/features/story, src/features/music). Controllers own an engine
 * StorySession / LyricSession, the speech, music and storage plumbing; views only read a
 * view model and call actions. Views never import adapters, storage or the engine session
 * classes, and controllers never import components.
 *
 * The screens are the engine's own plain-data screens (StoryScreen, LyricScreen from
 * @cliffword/engine). Everything else here is app-only state the engine does not know about:
 * listening, which word is being spoken, whether a model call is in flight.
 *
 * Every action is fire-and-forget for the view: the controller serializes calls into the
 * session (one at a time, in order) and publishes the new view model. An action that does not
 * apply to the current screen is ignored.
 */
import type {
  LyricScreen,
  MeaningView,
  SpokenCommand,
  StoryScreen,
  TextMode,
  UiText,
} from '@cliffword/engine';

/** Hold-to-speak state, shared by every screen that listens. */
export type ListenState =
  | { phase: 'idle' }
  /** Touch is down; the recognizer is warming up (no rings yet). */
  | { phase: 'warming' }
  /** Recording. level is 0..1 (throttled), partial is the live transcript. */
  | { phase: 'listening'; level: number; partial: string }
  /** Released; waiting for the final transcript and the session's answer. */
  | { phase: 'finishing' }
  /** A speech-in error; message is an i18n key (speechIn.error.*). Typing still works. */
  | { phase: 'error'; messageKey: string };

/** Where scores come from right now. */
export type ModelMode =
  /** Qwen3-1.7B is loaded: scoring and generation by the model. */
  | 'model'
  /** No model yet (downloading, declined, failed): canned starter content, answers matched by form. */
  | 'canned';

/** What every controller publishes besides its screen. */
export interface CommonViewState {
  listen: ListenState;
  /** A session call is in flight (generation can take seconds): views show a calm waiting state. */
  busy: boolean;
  modelMode: ModelMode;
  /** The meaning sheet for "¿qué significa?" or a held word; null when closed. */
  meaning: MeaningView | null;
  /** Credited speaking time today, ms (the headline metric). */
  spokenTodayMs: number;
  /** A non-fatal problem to show once (i18n key + values), e.g. TTS unavailable. */
  notice: UiText | null;
}

export interface CommonActions {
  /** Touch-down anywhere: warm the recognizer. */
  holdBegin(): void;
  /** The hold passed the long-press threshold: start listening. */
  holdStart(): void;
  /** Release: finish listening and send the utterance to the session. */
  holdEnd(): void;
  /** The touch was cancelled (scroll, interruption): drop the utterance. */
  holdCancel(): void;
  /** "Type instead": the same path as a spoken final, marked typed (no speaking credit). */
  typeAnswer(text: string): void;
  /** Command chips (Otra vez, Más despacio, No sé, Siguiente, Listo, ¿Qué significa?). */
  command(cmd: SpokenCommand, argument?: string): void;
  /** Tap an option of the options rung. */
  pickOption(index: number): void;
  closeMeaning(): void;
  dismissNotice(): void;
}

// ---------------------------------------------------------------------------
// Story tab
// ---------------------------------------------------------------------------

export interface StoryViewModel extends CommonViewState {
  /** null while the controller restores or produces the first step. */
  screen: StoryScreen | null;
  /** ViewWord.index currently being spoken by TTS (tile highlight), or null. */
  speakingWord: number | null;
  textMode: TextMode;
}

export interface StoryActions extends CommonActions {
  /** Start or resume: restores the stored session or begins one (placement, brand new or continue). */
  start(): void;
  /** Continue after a landing, an up-next card, placement done or an error. */
  next(): void;
  /** Tap a tile: hear the word (tap_rehear). */
  hearWord(index: number): void;
  /** Hold a tile: see the word (hold_reveal). */
  revealWord(index: number): void;
  /** Play the current sentence or prompt again (same as the 'again' command, without the event). */
  replay(): void;
  /** "Show text" pill: auto, all text or all tiles. */
  setTextMode(mode: TextMode): void;
  /** Begin the register-switch task offered at the top of the frequency list. */
  startRegisterTask(): void;
}

export interface StoryController {
  getSnapshot(): StoryViewModel;
  subscribe(listener: () => void): () => void;
  actions: StoryActions;
  /** Stop speech and listening, store the session snapshot; called on unmount and app background. */
  suspend(): Promise<void>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Music tab: one song (pasted lyrics) or one brought text
// ---------------------------------------------------------------------------

/** The Apple Music track, when the song is linked to one. */
export interface PlaybackState {
  available: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number | null;
}

export interface LyricViewModel extends CommonViewState {
  screen: LyricScreen | null;
  playback: PlaybackState;
  /** Neutral or street register shown on the song page. */
  register: 'neutral' | 'street';
}

export interface LyricActions extends CommonActions {
  start(): void;
  next(): void;
  /** Open one line (play it, or show it in manual mode). */
  openLine(index: number): void;
  /** Start the sing-back echo on the current line. */
  startEcho(): void;
  setRegister(register: 'neutral' | 'street'): void;
  /** Show the whole song (read view). */
  showSong(): void;
  /** Mark a line's start while listening ("time it while you listen"). */
  markLine(index: number, positionMs: number): void;
  play(): void;
  pause(): void;
}

export interface LyricController {
  getSnapshot(): LyricViewModel;
  subscribe(listener: () => void): () => void;
  actions: LyricActions;
  suspend(): Promise<void>;
  dispose(): void;
}
