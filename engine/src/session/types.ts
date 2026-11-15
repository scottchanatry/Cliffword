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

export type { UiText } from '../lyrics/text';

/** Snapshot format of StorySession; bump when the stored shape changes. */
export const STORY_SESSION_FORMAT = 1;
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
  /** landing.timesIn100 ({n}) and landing.justAsNatural ({word}) when they apply. */
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
  /** 1-based chapter (scene). */
  chapter: number;
  /** Starter title in the target language, '' for generated scenes. */
  title: string;
  /** Sentences shown in this chapter. */
  sentence: number;
  /** Credited speaking time in this session, ms. */
  spokenMs: number;
  mode: 'story' | 'placement' | 'starter';
  /** No model: canned sentences, answers checked by string and form. */
  canned: boolean;
}

export type StoryScreen =
  | { kind: 'idle'; meta: StoryMeta }
  | { kind: 'cliff'; meta: StoryMeta; sentence: SentenceView; cliff: CliffPrompt }
  | { kind: 'landing'; meta: StoryMeta; sentence: SentenceView; outcome: CliffOutcome; shadow?: AlignmentView }
  | {
      kind: 'noSe';
      meta: StoryMeta;
      sentence: SentenceView;
      step: NoSeStep;
      answer: string;
      ui: UiText | null;
      repeat?: AlignmentView;
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
