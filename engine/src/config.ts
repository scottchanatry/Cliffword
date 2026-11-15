/**
 * Every tunable default of the engine in one place.
 *
 * Each module keeps its own defaults next to the code that uses them (with the
 * reasoning for every number); this file only re-exports them, so the app and the
 * proof-test follow-up have one import to read or override from. Every function that
 * takes options merges a Partial<...> over these defaults, so a caller overrides only
 * what it needs.
 *
 * Values that wait on the proof test (proof/RESULTS.md, step 1 of docs/BRIEF.md). They
 * are placeholders until then; each is marked "set from proof/RESULTS.md" in its source.
 *
 * | Object                          | Field                         | Placeholder | What the proof test measures                                  |
 * |---------------------------------|-------------------------------|-------------|---------------------------------------------------------------|
 * | DEFAULT_HEAT_OPTIONS            | thresholds                    | [4, 7, 10]  | surprisal (nats) of correct vs. wrong words, per heat level   |
 * | DEFAULT_BASELINE_OPTIONS        | commonRank                    | 500         | rank below which rarity adds no surprisal                     |
 * | DEFAULT_BASELINE_OPTIONS        | natsPerLogRank                | 0.5         | how much rarity explains surprisal on correct sentences       |
 * | DEFAULT_BASELINE_OPTIONS        | maxBaseline                   | 4           | cap on the rarity allowance                                   |
 * | DEFAULT_NEXT_WORD_OPTIONS       | beamWidth                     | 12          | next-word recall vs. speed (step 5, whole-word lists)         |
 * | DEFAULT_NEXT_WORD_OPTIONS       | topTokens                     | 20          | boundary-mass tightness vs. speed                             |
 * | DEFAULT_NEXT_WORD_OPTIONS       | minProb                       | 1e-4        | smallest word probability worth keeping                       |
 * | DEFAULT_CLIFF_OPTIONS           | plausibleFloor                | 0.02        | probability of natural alternative continuations              |
 * | DEFAULT_CREDIT_OPTIONS          | fullRatio                     | 0.25        | answer probability relative to the top alternative            |
 * | DEFAULT_CREDIT_OPTIONS          | fullFloor                     | 0.05        | absolute probability of natural answers                       |
 * | DEFAULT_CREDIT_OPTIONS          | partialFloor                  | 0.005       | probability of possible-but-unusual answers                   |
 * | DEFAULT_CREDIT_OPTIONS          | multiFullMargin               | 1.0         | nats per word, multi-word answers vs. the actual words        |
 * | DEFAULT_CREDIT_OPTIONS          | multiPartialMargin            | 2.5         | same, for partial credit                                      |
 * | DEFAULT_VARIANT_OPTIONS         | maxVariants                   | 16          | time to score one sentence plus N variants (speed)            |
 * | DEFAULT_JUDGE_OPTIONS           | maxVariants                   | 16          | (inherited from DEFAULT_VARIANT_OPTIONS)                      |
 * | DEFAULT_JUDGE_OPTIONS           | assertMargin                  | 3           | margin above which >= 95% of flagged pairs are true errors    |
 * | DEFAULT_JUDGE_OPTIONS           | hintMargin                    | 1           | margin distribution of correct vs. incorrect pairs            |
 * | DEFAULT_JUDGE_OPTIONS           | tieMargin                     | 1           | margins between competing rules                               |
 * | DEFAULT_JUDGE_OPTIONS           | lengthAdjustPerToken          | 1           | typical cost of a short function-word token (insert/delete)   |
 * | DEFAULT_CLIFF_PICK_OPTIONS      | probFloor                     | 0.02        | probability below which a cliff word is not guessable         |
 * | DEFAULT_NEXT_SENTENCE_TUNING    | tokensPerWord                 | 2           | tokens per Spanish word for the chosen model's tokenizer      |
 * | EVENT_EVIDENCE (learner/model)  | cliff_answer.partial          | weights     | how often the scorer's plausible/form verdicts are right      |
 * | EVENT_EVIDENCE (learner/model)  | spoke_error                   | weight 0.6  | precision of asserted corrections                             |
 *
 * Also waiting on the proof test, but not yet a setting: whether street-register
 * scoring needs a register-setting context prefix (the slang penalty with and without
 * one), and which model the device adapter loads.
 *
 * Everything else (learner memory, difficulty curves, placement, selection weights, rung
 * thresholds, target choice) is a documented judgement call to be calibrated from
 * learner logs, not from the proof test.
 */

// Scoring
export { DEFAULT_HEAT_OPTIONS, DEFAULT_BASELINE_OPTIONS } from './scoring/wordScores';
export { DEFAULT_NEXT_WORD_OPTIONS } from './scoring/nextWord';
export { DEFAULT_CLIFF_OPTIONS, DEFAULT_CREDIT_OPTIONS } from './scoring/cliff';
export { DEFAULT_ACCENT_MARKS } from './scoring/text';

// Corrections
export { DEFAULT_VARIANT_OPTIONS } from './corrections/variants';
export { DEFAULT_JUDGE_OPTIONS } from './corrections/judge';

// Learner
export { DEFAULT_LEARNER_PARAMS, DEFAULT_PRIOR, EVENT_EVIDENCE } from './learner/model';
export { DEFAULT_DIFFICULTY_OPTIONS, DEFAULT_RUNG_OPTIONS } from './learner/difficulty';
export { DEFAULT_PLACEMENT_OPTIONS } from './learner/placement';

// Story
export { DEFAULT_SELECT_OPTIONS, DEFAULT_LEAK_PATTERNS } from './story/select';
export { DEFAULT_EXTRACT_OPTIONS, DEFAULT_CONTEXT_SENTENCES } from './story/prompt';
export { DEFAULT_NEXT_SENTENCE_TUNING } from './story/next';
export { DEFAULT_CLIFF_PICK_OPTIONS } from './story/cliffPick';
export { DEFAULT_TARGET_OPTIONS } from './story/targets';
export { DEFAULT_ABBREVIATIONS } from './story/text';

// Gaps
export { DEFAULT_GAP_OPTIONS } from './gaps/capture';

// Spanish pack and English-Spanish pair pack
export { DEFAULT_ANALYZE_OPTIONS } from './lang/es/analyze';
export { DEFAULT_LEADING_CLIPS, DEFAULT_TRAILING_CLIPS } from './lang/es/segment';
export { DEFAULT_FIND_SLANG_OPTIONS } from './lang/es/registers';
export { DEFAULT_EN_ES_OPTIONS } from './pair/en-es';
