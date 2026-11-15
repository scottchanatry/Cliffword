/**
 * Cliffword engine: the public API the app uses.
 *
 * The engine is language-neutral plain TypeScript behind the LanguageModel interface.
 * Language packs (word splitting, word forms, frequency list, correction rules, slang
 * registers) and pair packs (glosses, cognates, explanations, interface text) are data
 * passed in; packs.ts builds the ones for Spanish for English speakers.
 *
 * Modules:
 * - scoring:     word surprise (heat), whole-word next-word lists, cliff positions, answer credit
 * - corrections: rule-made variants scored by the model; the winning rule explains
 * - learner:     per-item, per-skill memory model; difficulty settings; placement
 * - story:       target words, prompt, candidate selection, next sentence, cliff choice
 * - gaps:        native-language words inside target-language replies
 *
 * Every tunable default is also re-exported from ./config, with the table of values that
 * wait on proof/RESULTS.md.
 */

// Contracts
export * from './model/types';
export * from './lang/types';
export { chooseAnalysesInText, chooseAnalysisInContext } from './lang/choose';
export type { ChosenWord, WordContext } from './lang/choose';
export * from './pair/types';

// Core modules (their barrels list their public API)
export * from './learner';
export * from './scoring';
export * from './corrections';

// Story: targets, prompting, selection, next sentence, cliff choice
export {
  DEFAULT_TARGET_OPTIONS,
  chooseTargets,
} from './story/targets';
export type { TargetChoice, TargetContext, TargetOptions, TargetReason } from './story/targets';
export {
  DEFAULT_LEAK_PATTERNS,
  DEFAULT_SELECT_OPTIONS,
  analyzeWords,
  evaluateCandidate,
  knownShareOf,
  resolveSelectOptions,
  selectSentence,
} from './story/select';
export type {
  CandidateEvaluation,
  RejectCode,
  ScoreParts,
  SelectContext,
  SelectOptions,
  Selection,
  WordInfo,
} from './story/select';
export {
  DEFAULT_CONTEXT_SENTENCES,
  DEFAULT_EXTRACT_OPTIONS,
  REGION_NAMES,
  SPANISH_PROMPT_TEXT,
  buildContinuationPrompt,
  extractSentence,
  promptInstructionLines,
  storySentences,
} from './story/prompt';
export type { ExtractOptions, PromptOptions, PromptText } from './story/prompt';
export {
  DEFAULT_NEXT_SENTENCE_TUNING,
  generateNextSentence,
  maxTokensFor,
  targetWordsFromKeys,
} from './story/next';
export type {
  GenerationRound,
  NextSentenceDeps,
  NextSentenceDiagnostics,
  NextSentenceOptions,
  NextSentenceResult,
  NextSentenceTuning,
} from './story/next';
export { DEFAULT_CLIFF_PICK_OPTIONS, pickCliff, rankCliffPositions, resolveCliffPickOptions } from './story/cliffPick';
export type { CliffCandidate, CliffExclusion, CliffPick, CliffPickContext, CliffPickOptions } from './story/cliffPick';
export { DEFAULT_ABBREVIATIONS, splitSentences } from './story/text';

// Gaps
export {
  DEFAULT_GAP_OPTIONS,
  candidateLemma,
  findNativeGaps,
  gapEvents,
  isNativeWord,
} from './gaps/capture';
export type { GapOptions, NativeGap, NativeGapWord } from './gaps/capture';

// Packs for Spanish for English speakers
export * from './packs';
export { createSpanishPack } from './lang/es';
export type { SpanishPackOptions } from './lang/es';
export { SPANISH_EXPLAIN_KEYS, SPANISH_RULES } from './lang/es/rules';
export type { SpanishExplainKey } from './lang/es/rules';
export { REGION_CODES, SPANISH_REGISTERS, expandRegions, findSlang, registerFor } from './lang/es/registers';
export type { FindSlangOptions } from './lang/es/registers';
export { FALSE_FRIENDS, createEnEsPairPack, falseFriend } from './pair/en-es';
export type { EnEsPairPackOptions, FalseFriend } from './pair/en-es';

// Deterministic mock model, for app tests without a real model
export { MockLanguageModel, createMockModel } from './model/mock';
