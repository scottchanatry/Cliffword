/**
 * Session module: the state machines the app drives. Pure and deterministic (time passed
 * in, randomness seeded), injected with { model, pack, pair } and a LearnerModel, and
 * returning plain-data, JSON-serializable screens. A null model is canned mode: starter
 * sentences (PairPack.starter) with answers checked by string and form.
 *
 * - StorySession: story cliffs with three rungs, "no sé", native-language answers, spoken
 *   commands, learner turns with self-repair, timed retell rounds, placement inside the
 *   first story, register switching at the top.
 * - LyricSession: lyric (or brought-text) cliffs, sing-back echo, slang notes, the
 *   register toggle, line play info for timed and manual playback.
 * - snapshot() / restore() on both, with a format number (STORY_SESSION_FORMAT,
 *   LYRIC_SESSION_FORMAT).
 *
 * PairPack.ui keys referenced by screens beyond those of the speaking and lyrics modules:
 * SESSION_UI_KEYS.
 */
export * from './types';
export {
  DEFAULT_SESSION_SETTINGS,
  alignmentView,
  buildPrior,
  effectiveRate,
  hintFor,
  joinSentences,
  leadAfter,
  looseText,
  resolveSessionSettings,
  sameWords,
} from './common';
export {
  DEFAULT_LANDING_OPTIONS,
  DEFAULT_OPTION_CHOICE_OPTIONS,
  arrangeOptions,
  buildOutcome,
  cannedResult,
  chooseDistractors,
  cliffUi,
  locateAnswer,
  optionResult,
} from './cliff';
export type { AnswerSpan, Distractor, LandingOptions, OptionChoiceOptions, OutcomeContext } from './cliff';
export { DEFAULT_VIEW_OPTIONS, buildSentenceView, sentenceWords } from './view';
export type { SentenceWord, ViewContext, ViewOptions, ViewState } from './view';
export { DEFAULT_STORY_SESSION_OPTIONS, StorySession } from './story';
export type { StorySessionCreate, StorySessionOptions, StorySessionSnapshot, StoryState } from './story';
export { DEFAULT_LYRIC_SESSION_OPTIONS, LyricSession } from './lyric';
export type { LyricSessionCreate, LyricSessionOptions, LyricSessionSnapshot, LyricState } from './lyric';
export { SESSION_UI_KEYS } from './uiKeys';
