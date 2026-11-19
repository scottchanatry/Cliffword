/**
 * Session contracts: what the app gives a session (deps, settings), and the plain-data
 * screens and steps a session returns. Every screen and snapshot is JSON-serializable
 * (numbers are finite, no functions, no class instances), so the app can store a
 * snapshot in SQLite and render a screen without engine code.
 *
 * Display text is never a string in the learner's language: it is a UiText (a PairPack.ui
 * key with {placeholder} values) that the app resolves. Target-language text (the story,
 * the answer, a lyric line) is data and travels as strings.
 */
import type { LanguagePack, Register, SpokenCommand } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { PairPack } from '../pair/types';
import type { CliffRung, DifficultyParams, LearnerEvent } from '../learner/types';
import type { LearnerModel } from '../learner/model';
import type { PlacementSnapshot } from '../learner/placement';
import type { Credit, CreditReason, Heat } from '../scoring/types';
import type { UiText } from '../lyrics/text';
import type { RetellProgress } from '../speaking/retell';
import type { NoSeStep } from '../speaking/noSe';
import type { RepairPhase } from '../speaking/repair';
import type { Lyrics } from '../lyrics/parse';
import type { SlangNote } from '../lyrics/slang';
import type { EchoStatus } from '../lyrics/echo';
import type { CliffMode } from '../content/library';
import type { LibraryGender, LibraryTier } from '../pair/types';

export type { UiText } from '../lyrics/text';
export type { CliffMode } from '../content/library';

/**
 * Snapshot format of StorySession; bump when the stored shape changes. 2: the library
 * source (authored series); restoring a format 1 snapshot starts a fresh library session.
 */
export const STORY_SESSION_FORMAT = 2;
/** Snapshot format of LyricSession; bump when the stored shape changes. */
export const LYRIC_SESSION_FORMAT = 1;

/** auto: per word (showText); all_text / all_tiles: the learner forced every word shown or hidden. */
export type TextMode = 'auto' | 'all_text' | 'all_tiles';

/** Learner settings that change what a session does. See DEFAULT_SESSION_SETTINGS. */
export interface SessionSettings {
  /** Register the learner practises: generation, scoring prefix, street tolerance, slang targets. */
  register: Register;
  /** Region codes of the register packs that apply ([] = every pack the language pack holds). */
  regions: readonly string[];
  /** Explicit slang shown (masked and never a cliff or a target when false). */
  showExplicit: boolean;
  textMode: TextMode;
  /** Multiplies the speech rate the learner model derives (1 = as derived). */
  speechRateBias: number;
  /** Native-language answers get the target phrase to repeat; when false they are scored as answers. */
  nativeAnswersAllowed: boolean;
}

/** How the first session of a learner starts. */
export type StartMode = 'placement' | 'brand_new' | 'continue';

/**
 * The learner model's prior as data (the prior itself is a function): the app stores it
 * next to the learner snapshot and rebuilds the function with buildPrior.
 */
export type PriorSpec =
  | { kind: 'default' }
  | { kind: 'brandNew' }
  | { kind: 'placement'; placement: PlacementSnapshot };

/** What every session is built on. A null model means canned mode (no model loaded yet). */
export interface SessionDeps {
  model: LanguageModel | null;
  pack: LanguagePack;
  pair: PairPack;
  /** The learner. The session applies its events to it (unless applyEvents is false). */
  learner: LearnerModel;
}

/** Something for the app to play: a sentence up to the cliff, an answer, a word, a prompt. */
export interface SpeakCue {
  text: string;
  /** Speech rate, 1 = natural speed. */
  rate: number;
  what: 'sentence' | 'answer' | 'word' | 'prompt' | 'line' | 'scene';
  /**
   * A line with its gap (library recall and hint modes): the words before and after the
   * hidden words. `text` is then before + ' … ' + after, for a player that cannot pause;
   * a player that can plays `before`, a short silence, then `after`.
   */
  gap?: { before: string; after: string };
}

/** The meaning of a word the learner asked about (the "what does it mean" command). */
export interface MeaningView {
  word: string;
  key: string;
  /** Gloss in the native language; null when the pair pack has none. */
  gloss: string | null;
  falseFriend?: string;
  /** The whole sentence in the native language, when known (canned sentences). */
  translation?: string;
}

/** text / tile: before the cliff; gap: hidden by the cliff; future: not heard yet; masked: explicit, hidden by settings. */
export type WordDisplay = 'text' | 'tile' | 'gap' | 'future' | 'masked';

/** One word or number of a sentence as the app draws it. */
export interface ViewWord {
  /** Index among the word and number segments of the sentence. */
  index: number;
  /** The word as written. */
  text: string;
  /** Punctuation right before the word (opening marks), as written. */
  lead: string;
  /** Punctuation right after the word, as written. */
  trail: string;
  /** Whitespace follows the word (false at the end and in scripts without spaces). */
  spaceAfter: boolean;
  /** Learner key ("es:puesto"; the normalized form for names and unknown words). */
  key: string;
  display: WordDisplay;
  /** Estimated spoken length at the view's speech rate (tile width), ms. */
  durationMs: number;
  /** The learner does not know the word yet (pKnown(meaning) below the select threshold). */
  isNew: boolean;
  /** Native gloss of a new word. */
  gloss?: string;
  /** False-friend warning of a new word. */
  falseFriend?: string;
  /** Part of a slang form of the applicable register packs. */
  slang: boolean;
  /** Part of an explicit slang form. */
  explicit: boolean;
}

export interface SentenceView {
  text: string;
  words: ViewWord[];
  speechRate: number;
  /** Sum of the word durations, ms. */
  durationMs: number;
  /** New words with a gloss, for the gloss chip ("puesto · stall · new for you"). Hidden words are left out. */
  glosses: { index: number; word: string; gloss: string }[];
  /** The sentence holds slang. */
  slang: boolean;
}

export interface CliffOption {
  index: number;
  text: string;
}

/** The cliff the learner answers. */
export interface CliffPrompt {
  /** First hidden word (ViewWord.index). */
  wordIndex: number;
  /** Hidden words. */
  length: number;
  rung: CliffRung;
  /** options rung: two or three spoken options in a seeded order (one natural). */
  options?: CliffOption[];
  /** hint rung: the first letters of the answer. */
  hint?: string;
  /** cliff.pickOne, cliff.hint ({sound}) or cliff.prompt. */
  ui: UiText;
  /** The learner may answer in the native language (cliff.answerInEnglish). */
  nativeAllowed: boolean;
}

/** One point on the "surprising ... expected" line of the landing screen. */
export interface LandingPoint {
  text: string;
  prob: number;
  /** 0 = surprising end, 1 = expected end (log scale; see LANDING options). */
  x: number;
  answer: boolean;
  actual: boolean;
}

/** Where an answer landed. */
export interface CliffOutcome {
  /** The answer as given. */
  answer: string;
  /** The form that was scored or matched. */
  scored: string;
  /** The story's (or lyric's) own words. */
  expected: string;
  credit: Credit;
  reason: CreditReason;
  rung: CliffRung;
  /** P(answer) at the cliff; null when nothing could score it (canned mode). */
  prob: number | null;
  /** round(100 x prob) for "About N times in 100"; null when unscored. */
  timesIn100: number | null;
  /** The answer, the actual words and the top alternatives on the landing line, by x. */
  points: LandingPoint[];
  /** landing.<reason> ("You landed where a Spanish speaker would."). */
  headline: UiText;
  /** landing.timesInHundred ({n}) and landing.justAsNatural ({word}) when they apply. */
  notes: UiText[];
  /** Why a street or spelling variant earned credit (lyrics.answer.*). */
  explanation?: UiText;
  /** model: scored by probability; options: a picked option; canned: string and form match without a model. */
  scoredBy: 'model' | 'options' | 'canned';
  /** The probability is only an upper bound (CliffResult.bounded). */
  bounded?: boolean;
}

/** Words of a repeat or shadowing utterance aligned with what was expected. */
export interface AlignmentView {
  understood: number;
  total: number;
  /** stats.understood ({n}, {m}). */
  ui: UiText;
  words: { text: string; landed: boolean }[];
}

/** A word of the learner's own sentence with its heat (amber shading). */
export interface SaidWord {
  text: string;
  heat: Heat;
}

export interface RetellRoundView {
  /** 0-based round. */
  round: number;
  laneMs: number;
  words: number;
  wordsPerMinute: number;
  tiles: { startMs: number; endMs: number }[];
  pauses: { startMs: number; endMs: number }[];
  /** Content lemmas of the scene the retell used. */
  covered: number;
  total: number;
}

/** Advanced tasks offered once the frequency list is used up. */
export type AdvancedTask = 'register_switch' | 'brought_text' | 'lyrics';

export interface RegisterTaskView {
  /** The line in the register the learner hears. */
  prompt: string;
  from: Register;
  /** The register to say it in. */
  to: Register;
  /** What a speaker of that register would say. */
  expected: string;
  swaps: { from: string; to: string }[];
  /** After the learner spoke. */
  result?: AlignmentView;
}

export interface StoryMeta {
  /** 1-based chapter (scene); the episode number in library mode. */
  chapter: number;
  /** Starter or episode title in the target language, '' for generated scenes. */
  title: string;
  /** Sentences shown in this chapter (episode). */
  sentence: number;
  /** Credited speaking time in this session, ms. */
  spokenMs: number;
  mode: 'story' | 'placement' | 'starter' | 'library';
  /** No model: canned sentences, answers checked by string and form. */
  canned: boolean;
  /** Library mode: where the learner is in the series. */
  library?: LibraryMeta;
}

/** The learner's form of address: '{you:a|b}' variants agree with it. */
export type LearnerAddress = LibraryGender;

/** Recall mode shows and plays the whole line first ('playing'), then hides the gap ('gap'). */
export type CliffPhase = 'playing' | 'gap';

/** Where a library session is: the series, the episode, the line, the learner level. */
export interface LibraryMeta {
  /** LibraryTrack.id. */
  track: string;
  /** Track card title in the learner's native language ('' when the track has no metadata). */
  trackTitle: string;
  /** Episode on screen (or next to play). */
  episode: number;
  /** Written episodes of the track. */
  episodes: number;
  /** LibraryStory.id of the episode being played, null between episodes. */
  storyId: string | null;
  tier: LibraryTier | null;
  /** 1-based line on screen; 0 before the first line. */
  line: number;
  /** Lines of the episode; 0 between episodes. */
  lines: number;
  /** Learner level 0-5 (moves after each episode). */
  level: number;
  /** Cliff mode of the level. */
  mode: CliffMode;
  /** Who says the line on screen: a cast member's local name, null for narration. */
  speaker: string | null;
  /**
   * Who speaks on screen, as the story writes it (LibrarySentence.speaker or
   * LibraryTurn.speaker: a cast id, or a name): the line's speaker, or the character asking
   * the question on screen (turn, repair). null for narration and between lines. Language-
   * neutral, so the app can key a picture on it (track + cast id).
   */
  speakerId: string | null;
  /** LibrarySentence.id of the line on screen. */
  lineId: string | null;
  /** The episode is a replay of a finished one. */
  replay: boolean;
}

/** The gap word's gloss and where it sits in the translation (hint mode: shown in bold). */
export interface TranslationHint {
  /** cliff.hint, e.g. 'piano'. */
  text: string;
  /** Character span of the gloss in the translation, when found there. */
  start: number;
  end: number;
  found: boolean;
}

/** A reply to a character's question in library mode. */
export interface TurnReplyView {
  heard: string;
  /** canned: the reply holds target-language words; model: the judge found it natural (ok or repaired). */
  accepted: boolean;
  scoredBy: 'model' | 'canned';
  /** turn.accepted or turn.trySpanish. */
  ui: UiText;
}

/** Results of a finished episode (kept per track in the library state). */
export interface EpisodeResult {
  episode: number;
  storyId: string;
  /** Cliffs of the episode the learner reached (answered, picked, skipped or "no sé"). */
  cliffs: number;
  /** Cliffs answered by voice or typing, with credit, before options or "no sé". */
  unaided: number;
  /** Cliffs answered with credit, a tapped option included (missing in results from before it). */
  correct?: number;
  levelBefore: number;
  levelAfter: number;
  replay: boolean;
  at: number;
}

/** What a library session starts with (StorySessionCreate.library). */
export interface LibraryStart {
  /** LibraryTrack.id to start (the first playable track when missing or coming soon). */
  trackId?: string;
  /** "How much do you know?": brand new 0, a little 2, comfortable 4 (any 0-5). */
  startLevel?: number;
  /** How characters address the learner (default 'm'). */
  address?: LearnerAddress;
  /** Track choices for the starting track: choice key -> option id. */
  choices?: Record<string, string>;
}

/** One track as the experience picker shows it, with the learner's progress. */
export interface TrackProgressView {
  id: string;
  title: string;
  tagline: string;
  city: string;
  country: string;
  /** No written episode: shown as coming soon, cannot be started. */
  comingSoon: boolean;
  /** Written episodes. */
  episodes: number;
  /** Finished episode numbers. */
  completed: number[];
  /** Episode the track continues with, null when the track is done or coming soon. */
  next: number | null;
  done: boolean;
  /** The learner is in this track now. */
  current: boolean;
  /** An episode in progress: its number and the lines done. */
  playing: { episode: number; line: number; lines: number } | null;
  /** Choices made for this track (key -> option id). */
  choices: Record<string, string>;
  /** Choice keys of the track not made yet (asked before the first episode). */
  missingChoices: string[];
}

/**
 * One entry of an episode so far (EpisodeTranscript): a line of the story, a question a
 * character asked the learner, or the learner's reply to it.
 */
export type TranscriptEntry =
  | {
      kind: 'line';
      /** LibrarySentence.id. */
      id: string;
      /** Who says it, as the story writes it (a cast id, or a name); null for narration. */
      speakerId: string | null;
      /** The speaker's display name (the cast member's local name); null for narration. */
      speaker: string | null;
      /** The line with every variant resolved and its gap filled with the story's words. */
      text: string;
      /** The line in the learner's language. */
      translation: string;
      /** Character span of the gap's words in `text`; null when they cannot be located. */
      gap: { start: number; end: number } | null;
    }
  | {
      kind: 'question';
      /** LibraryTurn.id. */
      id: string;
      speakerId: string | null;
      speaker: string | null;
      /** The question (LibraryTurn.line), resolved. */
      text: string;
      translation: string;
    }
  | {
      kind: 'reply';
      /** LibraryTurn.id of the question it answers. */
      turnId: string;
      /** What the learner said or typed last, as heard. */
      text: string;
    };

/**
 * Library mode: the episode in progress so far, as a conversation (StorySession.libraryTranscript).
 * The lines before the one on screen in story order, with the questions asked after them and
 * the learner's replies; the line or question on screen is not in it (it is the focus). It is
 * rebuilt from the episode's data and the session state, so it survives snapshot() and
 * restore(), and starts empty with each new episode and each replay.
 */
export interface EpisodeTranscript {
  /** LibraryTrack.id. */
  track: string;
  episode: number;
  /** LibraryStory.id of the episode. */
  storyId: string;
  replay: boolean;
  entries: TranscriptEntry[];
}

/** The library side of a session for the picker and the profile. */
export interface LibraryProgress {
  level: number;
  address: LearnerAddress;
  track: string;
  tracks: TrackProgressView[];
}

export type StoryScreen =
  | { kind: 'idle'; meta: StoryMeta }
  | {
      kind: 'cliff';
      meta: StoryMeta;
      sentence: SentenceView;
      cliff: CliffPrompt;
      /** Library mode: how the cliff is asked (by the learner's level). */
      mode?: CliffMode;
      /** Library recall mode: 'playing' (the whole line is shown and played) before 'gap'. */
      phase?: CliffPhase;
      /** Library mode: the line in the learner's language (null in predict mode before the answer). */
      translation?: string | null;
      /** Library hint mode: the gap word's gloss, bold in the translation. */
      translationHint?: TranslationHint | null;
      /** Library mode: who says the line (null for narration). */
      speaker?: string | null;
      /** Library mode: what the gap stands for, in plain English ('the price'). */
      concept?: string;
      /** Library hint mode: the answer that missed, before the options were offered. */
      missed?: string | null;
    }
  | {
      kind: 'landing';
      meta: StoryMeta;
      sentence: SentenceView;
      outcome: CliffOutcome;
      shadow?: AlignmentView;
      /** Library mode fields: the feedback after every answer. */
      mode?: CliffMode;
      /** The learner's answer as given ('' for a skip). */
      answer?: string;
      /** The story's own words. */
      expected?: string;
      /** Up to 3 other natural answers: the listed ones, then the model's top alternatives when a model is loaded. */
      alternatives?: string[];
      /** The line in the learner's language. */
      translation?: string | null;
      /** 'model' when the on-device model checked the answer. */
      scoredBy?: CliffOutcome['scoredBy'];
      speaker?: string | null;
    }
  | {
      kind: 'noSe';
      meta: StoryMeta;
      sentence: SentenceView;
      step: NoSeStep;
      answer: string;
      ui: UiText | null;
      repeat?: AlignmentView;
      /** Library mode: the line in the learner's language, and who says it. */
      translation?: string | null;
      speaker?: string | null;
    }
  | {
      kind: 'nativeReply';
      meta: StoryMeta;
      heard: string;
      /** The target phrase to repeat; null when the pair pack had nothing. */
      target: string | null;
      phrases: { native: string; target: string | null }[];
      ui: UiText | null;
      /** The sentence with its cliff revealed. */
      sentence?: SentenceView;
      repeat?: AlignmentView;
    }
  | {
      kind: 'turn';
      meta: StoryMeta;
      prompt: { speaker: string; line: string };
      /** story.asks ({speaker}): "Marta asks you". */
      ui: UiText;
      /** The learner answered in the native language: the target words to say instead. */
      native?: { heard: string; target: string | null };
      /** Library mode: the question in the learner's language. */
      translation?: string;
      /** Library mode: a natural answer, once the learner replied or said "no sé" (null before). */
      example?: string | null;
      /** turn.example ({example}) with the example, when shown. */
      exampleUi?: UiText | null;
      /** Library mode without a model: the reply and whether it was accepted. */
      reply?: TurnReplyView | null;
    }
  | {
      kind: 'repair';
      meta: StoryMeta;
      prompt: { speaker: string; line: string };
      phase: RepairPhase;
      said: SaidWord[];
      attempts: number;
      /** The flagged word (index among the said words) while prompting a repair or hinting. */
      highlight: number | null;
      expected: string | null;
      /** pair.explanations[explainKey], only once the answer is shown. */
      explanation: string | null;
      explainKey: string | null;
      ui: UiText | null;
      done: boolean;
      native?: { heard: string; target: string | null };
      /** Library mode: the question in the learner's language, and a natural answer once done. */
      translation?: string;
      example?: string | null;
      exampleUi?: UiText | null;
    }
  | { kind: 'upNext'; meta: StoryMeta; next: 'retell'; advanced: AdvancedTask[] }
  | {
      kind: 'retell';
      meta: StoryMeta;
      round: number;
      rounds: number;
      laneMs: number;
      ui: UiText;
      /** The scene to retell. */
      scene: string;
      results: RetellRoundView[];
      progress: RetellProgress | null;
      done: boolean;
    }
  | { kind: 'register'; meta: StoryMeta; task: RegisterTaskView }
  | { kind: 'placementDone'; meta: StoryMeta; vocabulary: number; thresholdRank: number; items: number }
  /** Library mode: an episode ended. next() starts the next one (or shows trackDone). */
  | {
      kind: 'episodeDone';
      meta: StoryMeta;
      track: string;
      episode: number;
      /** Episode title in the target language and in the learner's language. */
      title: string;
      titleNative: string;
      /** Cliffs reached, those answered without options or "no sé" (the level rule), and those answered right in any way (a tapped option too). */
      cliffs: number;
      unaided: number;
      correct: number;
      levelBefore: number;
      levelAfter: number;
      levelChange: -1 | 0 | 1;
      /** The episode that comes next, null when the track is complete. */
      next: { episode: number; title: string; titleNative: string } | null;
      replay: boolean;
      /** episode.done ({episode} {title}). */
      ui: UiText;
      /** episode.levelUp, episode.levelDown or episode.levelSame ({level}). */
      levelUi: UiText;
    }
  /** Library mode: every episode of the track is done; other experiences are suggested. */
  | {
      kind: 'trackDone';
      meta: StoryMeta;
      track: string;
      /** Track card title in the learner's language. */
      title: string;
      episodes: number;
      /** Playable tracks not finished yet, in picker order. */
      suggestions: { id: string; title: string; tagline: string }[];
      /** track.done ({title}). */
      ui: UiText;
    }
  /** No sentence could be made (no model sentence and no starter content); next() tries again. */
  | { kind: 'error'; meta: StoryMeta; ui: UiText };

/** Placement news in a step. */
export interface PlacementNews {
  /** The probe that was just answered. */
  recorded?: { key: string; rank: number; success: boolean };
  /** Band the next probe comes from. */
  nextBand: number;
  done: boolean;
  /** When done: the tracker to store in the prior spec. */
  snapshot?: PlacementSnapshot;
}

/**
 * Why a session refused a call. 'busy': another step of the session was still running
 * (an async step waiting for the model). A refused call changes nothing: it returns at
 * once with the screen as it was before the running step began and no events, and the
 * app may call again once that step has resolved.
 */
export type StepRefusal = 'busy';

/** What one call into a story session returns. */
export interface StoryStep {
  screen: StoryScreen;
  /** Learner events this step produced (already applied to the learner unless applyEvents is false). */
  events: LearnerEvent[];
  speak?: SpeakCue;
  meaning?: MeaningView;
  placement?: PlacementNews;
  /** Set when the learner's prior changed: store it with the learner snapshot. */
  prior?: PriorSpec;
  /** The session replaced its LearnerModel (new prior); read session.learner. */
  learnerReplaced?: boolean;
  /** The command that was recognized in the utterance, if any. */
  command?: SpokenCommand;
  /** Set when the call was refused and changed nothing (see StepRefusal). */
  refused?: StepRefusal;
}

// ---------------------------------------------------------------------------
// Lyrics and brought text
// ---------------------------------------------------------------------------

/** Where a line starts and where the track stops for its cliff. */
export interface LinePlay {
  /** timed: LRC times; tapped: times the learner tapped; manual: the learner advances by hand. */
  mode: 'timed' | 'tapped' | 'manual';
  startMs: number | null;
  /** Start of the next line, when known. */
  endMs: number | null;
  /** Where the track pauses for the cliff: the first hidden word's mark, else the line start. */
  pauseAtMs: number | null;
  /** pauseAtMs comes from a word mark (enhanced LRC). */
  precise: boolean;
}

export interface LyricLineView {
  index: number;
  text: string;
  /** Character spans of slang in the line. */
  slang: { start: number; end: number; explicit: boolean }[];
  /** Spans hidden because explicit lyrics are off. */
  masked: { start: number; end: number }[];
  repeat: boolean;
}

export interface LyricMeta {
  title: string;
  artist: string;
  /** Lines (or sentences) in the song (text). */
  total: number;
  spokenMs: number;
  register: Register;
  canned: boolean;
  source: 'lyrics' | 'text';
}

export interface EchoTile {
  text: string;
  slang: boolean;
  status: EchoStatus;
}

export type LyricScreen =
  | {
      kind: 'read';
      meta: LyricMeta;
      lines: LyricLineView[];
      notes: SlangNote[];
      playback: 'timed' | 'tapped' | 'manual';
    }
  | { kind: 'line'; meta: LyricMeta; lineIndex: number; line: LyricLineView; play: LinePlay }
  | {
      kind: 'cliff';
      meta: LyricMeta;
      lineIndex: number;
      previous: string;
      /** The line up to the gap. */
      before: string;
      /** Hidden words. */
      gapLength: number;
      rung: CliffRung;
      options?: CliffOption[];
      hint?: string;
      ui: UiText;
      play: LinePlay;
      slang: boolean;
    }
  | { kind: 'result'; meta: LyricMeta; lineIndex: number; outcome: CliffOutcome; line: string }
  | {
      kind: 'noSe';
      meta: LyricMeta;
      lineIndex: number;
      step: NoSeStep;
      answer: string;
      ui: UiText | null;
      repeat?: AlignmentView;
    }
  | {
      kind: 'nativeReply';
      meta: LyricMeta;
      lineIndex: number;
      heard: string;
      target: string | null;
      ui: UiText | null;
      repeat?: AlignmentView;
    }
  | {
      kind: 'echo';
      meta: LyricMeta;
      lineIndex: number;
      line: string;
      tiles: EchoTile[] | null;
      landed: number | null;
      total: number;
      ui: UiText | null;
    }
  | {
      kind: 'registers';
      meta: LyricMeta;
      pairs: { lineIndex: number; street: string; neutral: string; swaps: { from: string; to: string }[] }[];
    }
  | { kind: 'done'; meta: LyricMeta; answered: number; full: number };

export interface LyricStep {
  screen: LyricScreen;
  events: LearnerEvent[];
  speak?: SpeakCue;
  meaning?: MeaningView;
  command?: SpokenCommand;
  /** Set when the call was refused and changed nothing (see StepRefusal). */
  refused?: StepRefusal;
}

/** The source of a lyric session: pasted (parsed) lyrics, or a text the learner brought. */
export type LyricSource = { kind: 'lyrics'; lyrics: Lyrics } | { kind: 'text'; text: string };

/** Extra signals that come with an utterance. */
export interface UtteranceInfo {
  /** Length of the utterance (ms), for minutes spoken (creditedMs). */
  durationMs?: number;
  /** Recognized words with timings (ms from the lane start), for retell rounds. */
  words?: readonly { text: string; startMs: number; endMs: number }[];
}

/** Params a session derived for the current sentence, kept for the view (plain numbers). */
export type SessionParams = DifficultyParams;
