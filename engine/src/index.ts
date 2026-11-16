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
 * - speaking:    spoken commands, transcript alignment, retell, minutes spoken, self-repair,
 *                "no sé", native-language answers, tile durations
 * - lyrics:      pasted lyrics and brought text: parsing, slang notes, register pairs,
 *                lyric cliffs, surprise maps, sing-back echo, the shared word aligner
 * - session:     StorySession and LyricSession, the state machines the app drives
 * - model:       the LanguageModel contract, the deterministic mock, the HTTP adapter for
 *                proof/model_server.py and the top-N bounded wrapper
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
  DEFAULT_LIST_PATTERN,
  DEFAULT_PLACEHOLDER_PATTERN,
  DEFAULT_SELECT_OPTIONS,
  REJECT_CODES,
  analyzeWords,
  countRejects,
  evaluateCandidate,
  knownShareOf,
  packLeakPatterns,
  rankEvaluations,
  repeatsItself,
  resolveSelectOptions,
  sameOpening,
  selectSentence,
} from './story/select';
export type {
  CandidateEvaluation,
  RejectCode,
  ScoreParts,
  SelectCandidate,
  SelectContext,
  SelectOptions,
  Selection,
  WordInfo,
} from './story/select';
export {
  DEFAULT_CONTEXT_SENTENCES,
  DEFAULT_EXTRACT_OPTIONS,
  DEFAULT_STORY_PROMPT_OPTIONS,
  MODEL_META_LABELS,
  MODEL_META_PREAMBLE_WORDS,
  buildContinuationPrompt,
  buildStoryPrompt,
  extractOptionsFor,
  extractSentence,
  lengthHintFor,
  levelName,
  promptInstructionLines,
  storySentences,
  tagFor,
} from './story/prompt';
export type {
  ExtractOptions,
  PromptOptions,
  PromptText,
  StoryLine,
  StoryPrompt,
  StoryPromptInput,
  StoryPromptOptions,
} from './story/prompt';
export {
  DEFAULT_NEXT_SENTENCE_TUNING,
  generateNextSentence,
  knownLexemeCount,
  maxTokensFor,
  safeTagFor,
  storyNames,
  targetWordsFromKeys,
  vocabularyFor,
} from './story/next';
export type {
  GenerationRound,
  NextSentenceDeps,
  NextSentenceDiagnostics,
  NextSentenceOptions,
  NextSentenceResult,
  NextSentenceTuning,
  VocabularyInput,
} from './story/next';
export { DEFAULT_CLIFF_PICK_OPTIONS, pickCliff, rankCliffPositions, resolveCliffPickOptions } from './story/cliffPick';
export type { CliffCandidate, CliffExclusion, CliffPick, CliffPickContext, CliffPickOptions } from './story/cliffPick';
export { NO_ABBREVIATIONS, splitSentences } from './story/text';
// Spanish story data (LanguagePack.story, LanguagePack.abbreviations). SPANISH_PROMPT_TEXT,
// REGION_NAMES and DEFAULT_ABBREVIATIONS were defaults inside story/ before the data moved
// into the pack; the old names stay as aliases of the Spanish data.
export {
  SPANISH_ABBREVIATIONS,
  SPANISH_ABBREVIATIONS as DEFAULT_ABBREVIATIONS,
  SPANISH_LEAK_PATTERNS,
  SPANISH_META_WORDS,
  SPANISH_PREAMBLE_WORDS,
  SPANISH_PROMPT_TEXT,
  SPANISH_REGION_NAMES,
  SPANISH_REGION_NAMES as REGION_NAMES,
  SPANISH_STORY_DATA,
  SPANISH_STORY_EXAMPLES,
  SPANISH_STORY_LABELS,
  SPANISH_STORY_PROMPT_TEXT,
} from './lang/es/story';

// Gaps
export {
  DEFAULT_GAP_OPTIONS,
  candidateLemma,
  findNativeGaps,
  gapEvents,
  isNativeWord,
} from './gaps/capture';
export type { GapOptions, NativeGap, NativeGapWord } from './gaps/capture';

// Speaking, lyrics and sessions (their barrels list their public API)
export * from './speaking';
export * from './lyrics';
export * from './session';

// Packs for Spanish for English speakers
export * from './packs';
export { SPANISH_COMMANDS, attachClitic, createSpanishPack, splitClitics } from './lang/es';
export type { SpanishPackOptions } from './lang/es';
export {
  CLITIC_ORDER,
  NEGATION_WORDS,
  PRONOUN_MOVE_RULES,
  SPANISH_CLITICS,
  SPANISH_EXPLAIN_KEYS,
  SPANISH_RULES,
} from './lang/es/rules';
export type { SpanishExplainKey } from './lang/es/rules';
export { REGION_CODES, SPANISH_REGISTERS, expandRegions, findSlang, registerFor } from './lang/es/registers';
export type { FindSlangOptions } from './lang/es/registers';
export { EN_ES_STARTER, FALSE_FRIENDS, createEnEsPairPack, falseFriend } from './pair/en-es';
export type { EnEsPairPackOptions, FalseFriend } from './pair/en-es';

// Model adapters. Deterministic mock model, for app tests without a real model.
export { MockLanguageModel, createMockModel } from './model/mock';
// HTTP adapter for proof/model_server.py (development and real-model tests).
export { DEFAULT_HTTP_MODEL_OPTIONS, HttpLanguageModel, HttpModelError, checkTokenScores } from './model/http';
export type { FetchLike, FetchResponseLike, HttpModelHealth, HttpModelOptions } from './model/http';
// A runtime that reports only top-N token lists (llama.rn forced decoding), simulated.
export { DEFAULT_TOP_N_OPTIONS, TopNBoundedModel, boundedCount } from './model/topN';
export type { TopNOptions } from './model/topN';
// model/contract.ts (runLanguageModelContract) is a test-only helper: it imports vitest
// and registers tests, so it is imported by path from test files, never from here.
