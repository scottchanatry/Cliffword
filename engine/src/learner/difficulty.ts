/**
 * Difficulty: continuous settings derived from what the learner knows and how they are
 * doing right now. There are no level modes.
 *
 * Method
 * ------
 * 1. Vocabulary (expected number of known lexemes) is mapped to a smooth level
 *    x in [0, 1): a logistic curve on log vocabulary, shifted so x(0) = 0 exactly.
 *    It is strictly increasing and infinitely differentiable, so every setting below
 *    moves smoothly and monotonically with vocabulary.
 * 2. Each setting interpolates linearly in x between a beginner value and an advanced
 *    value.
 * 3. Recent performance is condensed into one "momentum" m in (-1, 1): positive when
 *    the learner is breezing (high success, few replays, few pauses), negative when
 *    struggling. m = tanh(weighted mean of standardized deviations from targets), so it
 *    is smooth and bounded. Each setting gets a bounded adjustment proportional to m.
 * 4. New words per sentence follow from the known-word band: at the band's lower edge
 *    a sentence of L words may hold (1 - band.min) * L new words, so the known share
 *    stays in the band at every level and new material keeps flowing even for
 *    beginners (fractional values mean "one every few sentences").
 */
import type { CliffRung, DifficultyParams, LearnerView } from './types';
import { lexemeOf } from './types';

/** Recent performance over the last few minutes or sentences. */
export interface RecentStats {
  /** Share of cliffs and checks answered successfully, 0..1. */
  successRate: number;
  /** Average number of replays (otra vez, tap to rehear) per sentence, >= 0. */
  replaysPerSentence: number;
  /** Hesitation pauses per minute of speaking, if measured. */
  pausesPerMinute?: number;
}

/** Input to deriveParams. */
export interface DifficultyInput {
  /** Expected number of known lexemes (see estimateVocabulary). */
  vocab: number;
  /** Recent performance; omitted means neutral. */
  recent?: RecentStats;
}

/** A setting's value for a beginner (x = 0) and an advanced learner (x -> 1). */
export interface ParamRange {
  from: number;
  to: number;
}

/** Tunable numbers of deriveParams. See DEFAULT_DIFFICULTY_OPTIONS for the reasoning. */
export interface DifficultyOptions {
  /** Vocabulary at which the level is halfway (before the x(0) = 0 shift). */
  vocabMidpoint: number;
  /** Spread of the level curve in natural-log units of vocabulary. */
  vocabSpread: number;
  sentenceMin: ParamRange;
  sentenceMax: ParamRange;
  speechRate: ParamRange;
  cliffWords: ParamRange;
  tileThreshold: ParamRange;
  /** Known-word band before performance adjustment (the same at every level). */
  knownBand: { min: number; max: number };
  /** Hard limits the band never leaves. */
  knownBandLimits: { min: number; max: number };
  /** Hard limits on speech rate. */
  speechRateLimits: { min: number; max: number };
  /** Hard limits on the tile threshold. */
  tileThresholdLimits: { min: number; max: number };
  /** How recent stats become momentum. */
  performance: {
    targetSuccess: number;
    successSpread: number;
    targetReplays: number;
    replaySpread: number;
    targetPauses: number;
    pauseSpread: number;
    weights: { success: number; replays: number; pauses: number };
  };
  /** Size of each adjustment at full momentum (|m| = 1). */
  adjust: {
    /** Speech rate is multiplied by (1 + speechRate * m). */
    speechRate: number;
    /** Sentence lengths are multiplied by (1 + sentenceLength * m). */
    sentenceLength: number;
    /**
     * The part of cliffWords above 1 is multiplied by (1 + cliffWords * m), and the
     * result is kept at or below the larger end of DifficultyOptions.cliffWords.
     */
    cliffWords: number;
    /** The known band is shifted by -knownBand * m (breezing allows more new words). */
    knownBand: number;
    /** The tile threshold is shifted by -tileThreshold * m (breezing hides text sooner). */
    tileThreshold: number;
  };
}

/** Defaults; to be calibrated from usage. */
export const DEFAULT_DIFFICULTY_OPTIONS: Readonly<DifficultyOptions> = Object.freeze({
  // Around 2000 lexemes a learner handles everyday conversation: call that mid-level.
  vocabMidpoint: 2000,
  // ln-units: x is ~0.13 at 200 words, 0.5 at 2000, ~0.76 at 8000 and ~0.87 at 20000.
  vocabSpread: 1.2,
  // Beginners: 3 to 6 words (one clause). Advanced: 12 to 25 (native-like sentences).
  sentenceMin: { from: 3, to: 12 },
  sentenceMax: { from: 6, to: 25 },
  // Beginners hear speech at 70% speed; advanced learners at natural speed.
  speechRate: { from: 0.7, to: 1 },
  // One hidden word for beginners; multi-word chunks and idioms (up to 4) when advanced.
  // Momentum never takes it above the larger end of the range (4).
  cliffWords: { from: 1, to: 4 },
  // Beginners keep text until fairly sure they know the word by ear (0.85); advanced
  // learners switch to tiles sooner (0.7), since context carries them.
  tileThreshold: { from: 0.85, to: 0.7 },
  // The brief: about 95 to 98% known words per sentence at every level.
  knownBand: { min: 0.95, max: 0.98 },
  knownBandLimits: { min: 0.93, max: 0.99 },
  // Never slower than 60% (distorts speech) or faster than 110% of natural.
  speechRateLimits: { min: 0.6, max: 1.1 },
  tileThresholdLimits: { min: 0.5, max: 0.95 },
  performance: {
    // Desirable difficulty: about 80% success keeps learners challenged but winning.
    targetSuccess: 0.8,
    successSpread: 0.15,
    // About one replay every other sentence is normal.
    targetReplays: 0.5,
    replaySpread: 0.75,
    // A few hesitation pauses per minute are normal in learner speech.
    targetPauses: 4,
    pauseSpread: 4,
    // Success is the most direct signal; pauses the noisiest.
    weights: { success: 0.5, replays: 0.3, pauses: 0.2 },
  },
  adjust: {
    speechRate: 0.08,
    sentenceLength: 0.1,
    cliffWords: 0.25,
    knownBand: 0.01,
    tileThreshold: 0.05,
  },
}) as Readonly<DifficultyOptions>;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(r: ParamRange, x: number): number {
  return r.from + (r.to - r.from) * x;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Smooth level in [0, 1) from vocabulary: a logistic on ln(vocab + 1) centred on
 * ln(vocabMidpoint), rescaled so 0 words gives exactly 0. Negative or NaN vocabulary
 * counts as 0; infinite vocabulary gives 1.
 */
export function vocabLevel(vocab: number, opts: Pick<DifficultyOptions, 'vocabMidpoint' | 'vocabSpread'> = DEFAULT_DIFFICULTY_OPTIONS): number {
  const v = vocab > 0 ? vocab : 0;
  const mid = Math.log(opts.vocabMidpoint);
  const s0 = sigmoid((0 - mid) / opts.vocabSpread);
  const s = sigmoid((Math.log(v + 1) - mid) / opts.vocabSpread);
  return clamp((s - s0) / (1 - s0), 0, 1);
}

/**
 * Momentum in (-1, 1) from recent performance: positive when breezing, negative when
 * struggling, 0 when neutral or unknown. Each available signal is standardized
 * against its target (success above target, replays and pauses below target count as
 * breezing), combined as a weighted mean over the signals present, and squashed with
 * tanh. Non-finite signals are treated as missing.
 */
export function momentum(recent: RecentStats | undefined, perf: DifficultyOptions['performance'] = DEFAULT_DIFFICULTY_OPTIONS.performance): number {
  if (!recent) return 0;
  let sum = 0;
  let wsum = 0;
  const add = (value: number | undefined, z: (v: number) => number, w: number): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(w > 0)) return;
    sum += w * z(value);
    wsum += w;
  };
  add(recent.successRate, (v) => (clamp(v, 0, 1) - perf.targetSuccess) / perf.successSpread, perf.weights.success);
  add(recent.replaysPerSentence, (v) => (perf.targetReplays - Math.max(0, v)) / perf.replaySpread, perf.weights.replays);
  add(recent.pausesPerMinute, (v) => (perf.targetPauses - Math.max(0, v)) / perf.pauseSpread, perf.weights.pauses);
  return wsum > 0 ? Math.tanh(sum / wsum) : 0;
}

/**
 * Difficulty settings for a learner with `vocab` known lexemes and recent performance
 * `recent`. Continuous (values are not rounded: round sentence lengths and cliffWords
 * where they are used), smooth, and monotonic in vocab: longer sentences, faster
 * speech, longer cliffs, more new words per sentence and a lower tile threshold as
 * vocabulary grows. Recent performance adjusts each setting by a bounded amount
 * (see DifficultyOptions.adjust); the known band always stays inside knownBandLimits.
 */
export function deriveParams(input: DifficultyInput, opts: DifficultyOptions = DEFAULT_DIFFICULTY_OPTIONS): DifficultyParams {
  const x = vocabLevel(input.vocab, opts);
  const m = momentum(input.recent, opts.performance);
  const a = opts.adjust;

  const lengthFactor = 1 + a.sentenceLength * m;
  const minWords = lerp(opts.sentenceMin, x) * lengthFactor;
  const maxWords = Math.max(minWords, lerp(opts.sentenceMax, x) * lengthFactor);

  const bandShift = -a.knownBand * m;
  const lim = opts.knownBandLimits;
  const bandMin = clamp(opts.knownBand.min + bandShift, lim.min, lim.max);
  const bandMax = clamp(opts.knownBand.max + bandShift, bandMin, lim.max);

  const meanWords = (minWords + maxWords) / 2;
  const newWordsPerSentence = (1 - bandMin) * meanWords;

  const speechRate = clamp(lerp(opts.speechRate, x) * (1 + a.speechRate * m), opts.speechRateLimits.min, opts.speechRateLimits.max);

  const cliffBase = lerp(opts.cliffWords, x);
  const cliffMax = Math.max(1, opts.cliffWords.from, opts.cliffWords.to);
  const cliffWords = clamp(1 + (cliffBase - 1) * (1 + a.cliffWords * m), 1, cliffMax);

  const tileThreshold = clamp(
    lerp(opts.tileThreshold, x) - a.tileThreshold * m,
    opts.tileThresholdLimits.min,
    opts.tileThresholdLimits.max,
  );

  return {
    sentenceWords: { min: minWords, max: maxWords },
    knownBand: { min: bandMin, max: bandMax },
    newWordsPerSentence,
    speechRate,
    cliffWords,
    tileThreshold,
  };
}

/** Speaking thresholds for choosing a cliff rung. */
export interface RungOptions {
  /** Below this pKnown(speaking) the learner picks from spoken options. */
  optionsBelow: number;
  /** Below this (and at least optionsBelow) they answer with a first-sound hint. */
  hintBelow: number;
  /**
   * When pKnown(meaning) and pKnown(sound) are both at least this, the rung is at least
   * 'hint' even if speaking is still low. Set above 1 to disable.
   */
  promoteOnRecognition: number;
}

/** Defaults; to be calibrated from cliff success rates per rung. */
export const DEFAULT_RUNG_OPTIONS: Readonly<RungOptions> = Object.freeze({
  // Under 0.3 a free answer would usually fail: recognition first.
  optionsBelow: 0.3,
  // From 0.3 to 0.6 a first sound tips most attempts into success; above, answer freely.
  hintBelow: 0.6,
  // Correct picks among options are only weak speaking evidence (they can be guesses),
  // so a word the learner clearly recognizes by ear and understands would otherwise
  // sit on options for a week of correct answers. Recognition this solid means it is
  // time to try producing it with a hint.
  promoteOnRecognition: 0.75,
});

/**
 * Cliff rung for the target word `key`: 'options' when pKnown(speaking) is below
 * optionsBelow, 'hint' when below hintBelow, otherwise 'free'. A word the learner
 * clearly recognizes (meaning and sound both at least promoteOnRecognition) gets at
 * least 'hint', so weak evidence from option picks cannot hold them on options.
 */
export function cliffRungFor(learner: LearnerView, key: string, now: number, opts: Partial<RungOptions> = {}): CliffRung {
  const o = { ...DEFAULT_RUNG_OPTIONS, ...opts };
  const p = learner.pKnown(key, 'speaking', now);
  if (p >= o.hintBelow) return 'free';
  if (p >= o.optionsBelow) return 'hint';
  const recognized =
    learner.pKnown(key, 'meaning', now) >= o.promoteOnRecognition && learner.pKnown(key, 'sound', now) >= o.promoteOnRecognition;
  return recognized ? 'hint' : 'options';
}

/**
 * Whether `key` is shown as text (true) or as a blank tile (false): text while the
 * learner does not yet know the word by ear, i.e. pKnown(sound) < params.tileThreshold.
 */
export function showText(learner: LearnerView, key: string, now: number, params: Pick<DifficultyParams, 'tileThreshold'>): boolean {
  return !(learner.pKnown(key, 'sound', now) >= params.tileThreshold);
}

/**
 * Expected number of lexemes the learner knows for meaning: the sum of
 * pKnown(lexeme, meaning) over the frequency list plus any other lexeme with evidence
 * (e.g. slang lexemes outside the list). By linearity of expectation this is the
 * expected count. Form keys are mapped to their lexeme and duplicates counted once.
 * Prior mass of words outside the list without evidence is not counted.
 */
export function estimateVocabulary(learner: LearnerView, now: number, frequencyLemmaKeys: Iterable<string>): number {
  const lexemes = new Set<string>();
  for (const k of frequencyLemmaKeys) if (k) lexemes.add(lexemeOf(k));
  for (const k of learner.knownKeys()) if (k) lexemes.add(lexemeOf(k));
  let total = 0;
  for (const k of lexemes) {
    const p = learner.pKnown(k, 'meaning', now);
    if (p > 0) total += Math.min(1, p);
  }
  return total;
}
