/**
 * Every tunable default of the engine in one place.
 *
 * Each module keeps its own defaults next to the code that uses them (with the
 * reasoning for every number); this file only re-exports them, so the app and the
 * proof-test follow-up have one import to read or override from. Every function that
 * takes options merges a Partial<...> over these defaults, so a caller overrides only
 * what it needs.
 *
 * Proof test outcome (proof/RESULTS.md, step 1 of docs/BRIEF.md). Model: Qwen3-1.7B,
 * Q4_K_M (1.1 GB): the same 97% minimal-pair accuracy as Qwen3-4B at half the size and
 * twice the speed. Gemma 3n E2B gave broken output in that llama.cpp build; retest it
 * on llama.rn before ruling it out.
 *
 * | Object                          | Field                  | Value          | Source                                                        |
 * |---------------------------------|------------------------|----------------|---------------------------------------------------------------|
 * | LanguagePack.scoringPrefix (es) |                        | "Frase en español:\n" | measured: required (97% vs 85% without)               |
 * | RegisterPack.scoringPrefix (PR) |                        | names slang    | measured: helps only the words it names; see scoring/context  |
 * | DEFAULT_JUDGE_OPTIONS           | assertMargin           | 3              | measured: 80% of errors caught, 0 false flags                 |
 * | DEFAULT_JUDGE_OPTIONS           | hintMargin             | 1              | measured: 95% caught with hints, 1 false flag                 |
 * | DEFAULT_JUDGE_OPTIONS           | lengthAdjustPerToken   | 0              | measured: no gain on 1.7B (mock tests pin 1)                  |
 * | DEFAULT_JUDGE_OPTIONS           | tieMargin              | 1              | judgement                                                     |
 * | DEFAULT_HEAT_OPTIONS            | thresholds             | [7, 9.5, 12]   | measured: top fifth / tenth / 2-3% of correct words           |
 * | DEFAULT_HEAT_OPTIONS            | sentenceStartAllowance | 2.5            | measured: first words run 2.7 nats higher                     |
 * | DEFAULT_HEAT_OPTIONS            | baseline               | off            | measured: a frequency baseline hurt localization              |
 * | DEFAULT_NEXT_WORD_OPTIONS       | minProb                | 1e-3           | proof method's pruning floor                                  |
 * | DEFAULT_NEXT_WORD_OPTIONS       | beamWidth, topTokens   | 12, 20         | narrower than the proof (30, 60) to fit the call budget       |
 * | DEFAULT_CLIFF_OPTIONS           | plausibleFloor         | 0.02           | checked against the proof's next-word lists                   |
 * | DEFAULT_CLIFF_PICK_OPTIONS      | probFloor              | 0.02           | checked against the proof's next-word lists                   |
 * | DEFAULT_CREDIT_OPTIONS          | partialFloor           | 1e-4           | measured on the real model: credits 40/40 natural, 0/23 wrong |
 * | DEFAULT_CREDIT_OPTIONS          | fullRatio, fullFloor   | 0.25, 0.05     | consistent with the lists; calibrate from learner answers     |
 * | DEFAULT_VARIANT_OPTIONS         | maxVariants            | 16             | 1.9 s for 1 + 6 on 4 CPU cores; measure on device             |
 * | DEFAULT_NEXT_SENTENCE_TUNING    | tokensPerWord          | 2              | measured 1.6 for Qwen3, plus headroom                         |
 * | EVENT_EVIDENCE (learner/model)  | cliff_answer.partial   | weights        | judgement; calibrate from learner logs                        |
 * | EVENT_EVIDENCE (learner/model)  | spoke_error            | weight 0.6     | asserts had no false flags; kept moderate                     |
 *
 * Street register (measured): slang scores about 4.5 nats per word worse than neutral
 * paraphrases and a register prefix recovers only 1.2, so street mode must pass
 * slangExemption(pack, regions) as HeatOptions.exempt (never shade slang), score after
 * scoringContext(pack, before, { register: 'street', regions, words: slangIn(...) }),
 * and take cliff answers on slang or lyric lines from the pack or the lyrics, not from
 * next-word lists (top-10 mass 0.12 there). Corrections already protect slang words.
 *
 * Bounded scores (rules, not tunables). A runtime that reports only top-N token lists
 * (llama.rn by forced decoding; model/topN.ts simulates it) gives a token outside its
 * list only an upper-bound logprob (TokenScore.upperBound). The engine never lets such a
 * bound raise a verdict or credit:
 * - judgeSentence: a margin with a bounded token in either compared region is never
 *   asserted (hint at most) and the Judgement says bounded: true (corrections/judge.ts);
 * - scoreWords: a word with a bounded token keeps its heat (a lower bound) and is marked
 *   WordScore.bounded (scoring/wordScores.ts); cliffPositions marks CliffPosition.bounded;
 * - scoreCliffAnswer: a bounded answer probability never earns 'likely' or 'plausible'
 *   credit, only 'form' or 'none', and the result says bounded: true (scoring/cliff.ts).
 * With exact scores (the HTTP adapter, a native scoring method) nothing changes.
 *
 * Validation on the real model (proof/ENGINE_REAL_MODEL.md, Qwen3-1.7B Q4_K_M through
 * proof/model_server.py, 2026-11-15): judgeSentence on the 93 proof pairs, street
 * sentences, heat localization, cliffs, generation and top-N forced decoding were run
 * through the engine's own functions. Judge 3 / 1 and heat [7, 9.5, 12] were kept (the
 * one false assert came from a rule-made variant, not from a margin; no other heat
 * threshold traded better). The credit partialFloor went from 0.005 to 1e-4: 0.005 gave
 * 12 of 40 natural cliff answers no credit (reír, nadar, cocina...), while wrong answers
 * stayed at or below 1e-5. See the doc for the per-rule tables and the device-adapter
 * decision.
 *
 * Everything else (learner memory, difficulty curves, placement, selection weights, rung
 * thresholds, target choice) is a documented judgement call to be calibrated from
 * learner logs, not from the proof test.
 */

// Scoring
export { DEFAULT_HEAT_OPTIONS, DEFAULT_BASELINE_OPTIONS } from './scoring/wordScores';
export { DEFAULT_NEXT_WORD_OPTIONS } from './scoring/nextWord';
export { DEFAULT_CLIFF_OPTIONS, DEFAULT_CREDIT_OPTIONS } from './scoring/cliff';
export { DEFAULT_SCORING_CONTEXT_OPTIONS } from './scoring/context';
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
export { SPANISH_SCORING_PREFIX } from './lang/es';
export { DEFAULT_LEADING_CLIPS, DEFAULT_TRAILING_CLIPS } from './lang/es/segment';
export { DEFAULT_FIND_SLANG_OPTIONS } from './lang/es/registers';
export { DEFAULT_EN_ES_OPTIONS } from './pair/en-es';
