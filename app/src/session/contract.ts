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
  SentenceView,
  SpokenCommand,
  StoryScreen,
  SurpriseUnit,
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
  /**
   * Optional (added by the story views): the chapter's earlier sentences, oldest first, as
   * the session drew them once resolved (e.g. each landing's sentence). The views draw them
   * above the current sentence, as the design's passage; without it only the current
   * sentence shows.
   */
  previous?: readonly SentenceView[];
  /**
   * Optional (added by the story controller): on the options rung each option is read aloud
   * after the sentence; this is CliffOption.index of the one being read (its chip lights), or
   * null.
   */
  speakingOption?: number | null;
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
  /**
   * Optional (added for the stores' AI-generated content rules, docs/STORE.md decision 6):
   * "Report this sentence" on a screen that shows a story sentence (cliff, landing, noSe,
   * nativeReply, turn, repair). It opens the learner's mail app with a report to the contact
   * address (the sentence, model-written or canned, the app version and the platform), then
   * publishes a notice: sent to the mail app, or no mail app opened. Absent: the views offer
   * no report action.
   */
  reportSentence?(): void;
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
  /**
   * Optional (added by the music views): settings.showExplicit. The cliff's "Explicit · on"
   * pill shows it, and while it is false the views also hide explicit slang in the raw lines
   * a screen carries (cliff previous/before, echo, registers), which have no masked spans.
   * Absent: no pill, nothing extra hidden.
   */
  showExplicit?: boolean;
  /**
   * Optional (added by the music views): settings.regions (the register packs that apply),
   * so slang notes the views look up for a line (echo hold, register labels) use the same
   * packs as the session. Absent: every pack.
   */
  regions?: readonly string[];
  /**
   * Optional (added by the music views): word surprise of a brought text (engine
   * surpriseMap, one unit per sentence), for the reader's amber shading. Absent or null:
   * not scored (no model yet), the text is drawn unshaded.
   */
  surprise?: readonly SurpriseUnit[] | null;
  /**
   * Optional (added in the stage 3 review): the song's genre as its source gives it (Apple Music),
   * for A3's "artist · genre · region" line. Absent or null: no genre shown.
   */
  genre?: string | null;
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
  /**
   * Optional (added by the music views): the "Explicit · on" pill on the cliff turns
   * explicit lyrics off or on (settings.showExplicit). Absent: the pill is a static chip.
   */
  setShowExplicit?(show: boolean): void;
  /**
   * Optional (added by the music views): tap a hollow (missed) tile of the echo's learner
   * row: hear that word of the line slowly. index is the EchoTile index (the line's word and
   * number segments). Absent: the tiles are drawn only.
   */
  hearWord?(index: number): void;
}

export interface LyricController {
  getSnapshot(): LyricViewModel;
  subscribe(listener: () => void): () => void;
  actions: LyricActions;
  suspend(): Promise<void>;
  dispose(): void;
}
