/**
 * Learner model: what the learner knows, per item (lexeme or form) and per skill.
 *
 * Method
 * ------
 * Every (key, skill) pair the learner has shown evidence about holds a small memory
 * state: a half-life in hours, the time of the last event, the recall level right after
 * that event, the accumulated evidence weight and the accumulated failure weight
 * (lapses). Recall decays exponentially towards a floor:
 *
 *     recall(now) = floor + (level - floor) * 2^(-elapsedHours / halfLifeHours)
 *     floor       = baseline * (evidence - lapses) / evidence
 *
 * The floor is what the item falls back to once its memory trace has faded: the baseline
 * for an item with only successes (a cognate read without trouble never ends up less
 * known than an untouched cognate), 0 for an item with only failures, and in between in
 * proportion to the share of successful evidence. After a clean success `level` is close
 * to 1, so this is the plain half-life curve down to the floor; a failure lowers `level`
 * so the item reads as unknown right away instead of only after time has passed. Evidence moves `level` in log-odds space (a tempered Bayesian
 * update: weight w multiplies the log likelihood ratio), so weak evidence stays weak
 * whatever the starting point, and the half-life grows on success (more when the item
 * was partly forgotten: the spacing effect) and shrinks on failure.
 *
 * The probability that the learner has the skill blends that recall with a baseline:
 *
 *     c       = evidence / (evidence + evidenceHalfWeight)
 *     pKnown  = c * recall + (1 - c) * baseline
 *
 * so the item's own history counts more as evidence accumulates. The baseline is the
 * prior (from placement, cognates, or a low constant). For a form key and a skill with
 * form back-off (meaning by default), the baseline is mostly the lexeme's current
 * knowledge: someone who knows "tener" mostly understands "tuvieron". Failures on the
 * form itself shrink that inherited part. Meaning evidence on a form also counts, at
 * reduced weight, as evidence for its lexeme.
 *
 * Events map to evidence through EVENT_EVIDENCE, a data table (event type -> skills,
 * success or failure, weight). Weight 1 means one clean, unambiguous observation; it
 * scales both the evidence count and the size of the memory update.
 *
 * Everything is deterministic: time is always an argument (ms since epoch).
 */
import { lexemeOf, SKILLS, type CliffRung, type LearnerEvent, type LearnerView, type Skill } from './types';

const HOUR_MS = 3_600_000;

/** Prior probability that the learner has `skill` for `key` before any evidence. */
export type PriorFn = (key: string, skill: Skill) => number;

/** Credit levels a cliff answer can earn (mirrors the cliff_answer event). */
export type CliffCredit = Extract<LearnerEvent, { type: 'cliff_answer' }>['credit'];

/** All learner event type names. */
export type LearnerEventType = LearnerEvent['type'];

/** One piece of evidence about one skill. */
export interface Evidence {
  readonly skill: Skill;
  /** true: the learner showed the skill; false: they showed they lack it. */
  readonly success: boolean;
  /** 1 = one clean, unambiguous observation. Must be > 0 to have any effect. */
  readonly weight: number;
}

/** Event type -> evidence. cliff_answer is keyed by credit, then by rung. */
export type EventEvidenceTable = {
  readonly [T in Exclude<LearnerEventType, 'cliff_answer'>]: readonly Evidence[];
} & {
  readonly cliff_answer: Readonly<Record<CliffCredit, Readonly<Record<CliffRung, readonly Evidence[]>>>>;
};

/**
 * How each event counts as evidence. Every number is a judgement call to be calibrated
 * from usage logs; the reasoning is next to each entry.
 *
 * Weight scale: 1 = as informative as one clean free recall or one explicit "I don't
 * know" (gloss lookup). Passive signals (moving on without help) are weak because
 * learners often move on without understanding.
 */
export const EVENT_EVIDENCE: EventEvidenceTable = {
  heard: [
    // Moving on without tapping is weak evidence the word was caught by ear: many
    // learners let unknown words slide by. Meaning even weaker (caught the sound, maybe
    // not the sense).
    { skill: 'sound', success: true, weight: 0.2 },
    { skill: 'meaning', success: true, weight: 0.15 },
  ],
  tap_rehear: [
    // Asked to hear it again: sound not secure. Only half weight because replays are
    // also caused by speed, noise or curiosity rather than not knowing the word.
    { skill: 'sound', success: false, weight: 0.5 },
  ],
  hold_reveal: [
    // Had to see the word: did not recognize it by ear. Slightly below 1 because some
    // learners hold to check the spelling of a word they did catch. Says nothing about
    // the written skill (they are looking at it now).
    { skill: 'sound', success: false, weight: 0.8 },
  ],
  read: [
    // Saw the text and moved on: weak written-recognition evidence, weaker meaning
    // evidence (same reasoning as `heard`).
    { skill: 'written', success: true, weight: 0.3 },
    { skill: 'meaning', success: true, weight: 0.15 },
  ],
  gloss_lookup: [
    // Explicitly asked what it means: the clearest meaning failure there is.
    { skill: 'meaning', success: false, weight: 1 },
  ],
  cliff_answer: {
    // Successes are stronger with less help; failures are stronger with more help
    // (failing to pick from two or three spoken options says more than failing a free
    // recall, where the learner may simply have had a different word in mind).
    full: {
      // Produced the word unprompted: strong speaking evidence, and it fit the
      // context, so meaning is known; producing it implies its sound form is known.
      free: [
        { skill: 'speaking', success: true, weight: 1 },
        { skill: 'meaning', success: true, weight: 0.5 },
        { skill: 'sound', success: true, weight: 0.3 },
      ],
      // First sound was given, so production was partly cued.
      hint: [
        { skill: 'speaking', success: true, weight: 0.6 },
        { skill: 'meaning', success: true, weight: 0.4 },
        { skill: 'sound', success: true, weight: 0.2 },
      ],
      // Recognition among 2-3 spoken options (33-50% by chance): weak speaking
      // evidence, but picking the right spoken option is real evidence of recognizing
      // it by ear and knowing what fits.
      options: [
        { skill: 'speaking', success: true, weight: 0.2 },
        { skill: 'meaning', success: true, weight: 0.3 },
        { skill: 'sound', success: true, weight: 0.3 },
      ],
    },
    // Judgement call: how much a partial credit means depends on how often the scorer's
    // "plausible"/"form" verdicts are right, which the proof test did not measure.
    // Calibrate from learner logs.
    partial: {
      // A plausible but unusual word, or the right word in the wrong form.
      free: [
        { skill: 'speaking', success: true, weight: 0.4 },
        { skill: 'meaning', success: true, weight: 0.2 },
      ],
      hint: [
        { skill: 'speaking', success: true, weight: 0.25 },
        { skill: 'meaning', success: true, weight: 0.15 },
      ],
      // Picked a weaker option: close to chance, only a hint of understanding.
      options: [{ skill: 'meaning', success: true, weight: 0.1 }],
    },
    // A speaking failure at every rung.
    none: {
      // May have had another word in mind; moderate.
      free: [
        { skill: 'speaking', success: false, weight: 0.6 },
        { skill: 'meaning', success: false, weight: 0.1 },
      ],
      // Even with the first sound they could not produce it.
      hint: [
        { skill: 'speaking', success: false, weight: 0.8 },
        { skill: 'meaning', success: false, weight: 0.2 },
      ],
      // Could not even recognize it among spoken options: speaking, meaning and
      // sound all failed.
      options: [
        { skill: 'speaking', success: false, weight: 1 },
        { skill: 'meaning', success: false, weight: 0.5 },
        { skill: 'sound', success: false, weight: 0.4 },
      ],
    },
  },
  cliff_skip: [
    // "No sé": could not produce it. Below 1 because some skips are fatigue or
    // shyness; a small meaning failure because learners who understand a word
    // usually attempt it.
    { skill: 'speaking', success: false, weight: 0.8 },
    { skill: 'meaning', success: false, weight: 0.2 },
  ],
  spoke_correct: [
    // Chose and used the word unprompted. Slightly below a free cliff answer because
    // speech recognition can mis-hear and learners pick words they feel safe with.
    { skill: 'speaking', success: true, weight: 0.8 },
    { skill: 'meaning', success: true, weight: 0.5 },
  ],
  spoke_error: [
    // Proof test: asserts (margin >= 3 nats) had no false flags in 93 pairs, but the error
    // is often the form (gender, tense, ser/estar) rather than the word, so this is a
    // moderate speaking failure and no meaning evidence.
    { skill: 'speaking', success: false, weight: 0.6 },
  ],
  native_gap: [
    // Needed the word and reached for the native one: a clear speaking failure. A
    // small meaning failure because passive knowledge often surfaces when needed.
    { skill: 'speaking', success: false, weight: 1 },
    { skill: 'meaning', success: false, weight: 0.3 },
  ],
  marked_known: [
    // Self-report. Learners overestimate, so it is strong but not full meaning
    // evidence, and weaker for the skills a learner judges least well.
    { skill: 'meaning', success: true, weight: 0.8 },
    { skill: 'sound', success: true, weight: 0.4 },
    { skill: 'written', success: true, weight: 0.4 },
    { skill: 'speaking', success: true, weight: 0.2 },
  ],
};

/**
 * The evidence an event carries, looked up in `table` (EVENT_EVIDENCE by default).
 * cliff_answer is looked up by its credit and rung; unknown types yield no evidence.
 */
export function evidenceFor(event: LearnerEvent, table: EventEvidenceTable = EVENT_EVIDENCE): readonly Evidence[] {
  if (event.type === 'cliff_answer') {
    return table.cliff_answer[event.credit]?.[event.rung] ?? [];
  }
  const list: readonly Evidence[] | undefined = table[event.type];
  return list ?? [];
}

/** Tunable numbers of the memory model. See DEFAULT_LEARNER_PARAMS for the reasoning. */
export interface LearnerParams {
  /** Half-life given to an item with prior 0 on its first event. */
  initialHalfLifeHours: number;
  /** An item's starting half-life is multiplied by 2^(doublings * prior). */
  priorHalfLifeDoublings: number;
  /** Half-lives never fall below this. */
  minHalfLifeHours: number;
  /** Half-lives never grow above this. */
  maxHalfLifeHours: number;
  /** Half-life multiplier for a full-weight success on a fully forgotten item. */
  successGrowth: number;
  /** Share of successGrowth earned when recall is still near 1 (massed repetition). */
  massedFloor: number;
  /** A full-weight success adds this to the log-odds of the recall level. */
  successLogOdds: number;
  /** Half-life multiplier for a full-weight failure. */
  failureShrink: number;
  /** A full-weight failure subtracts this from the log-odds of the recall level. */
  failureLogOdds: number;
  /**
   * Before an update the recall level is clamped to [1 - levelCap, levelCap], so an
   * item that reads as certain can still be knocked down by one failure.
   */
  levelCap: number;
  /** Evidence weight at which an item's own memory and its baseline count equally. */
  evidenceHalfWeight: number;
  /** Per skill: share of the lexeme's knowledge a form inherits (0 = none). */
  formBackoff: Record<Skill, number>;
  /** Each unit of failure weight on the form multiplies the inherited part by this. */
  formLapseKeep: number;
  /** Evidence on a form also counts for its lexeme at these weight multipliers. */
  formToLexeme: { success: number; failure: number };
}

/** Partial params; the nested records may also be partial. */
export type LearnerParamsInput = Partial<Omit<LearnerParams, 'formBackoff' | 'formToLexeme'>> & {
  formBackoff?: Partial<Record<Skill, number>>;
  formToLexeme?: Partial<LearnerParams['formToLexeme']>;
};

/**
 * Defaults. All of these should be calibrated from learner logs (predicted pKnown vs
 * observed success); none come from the model proof test.
 */
export const DEFAULT_LEARNER_PARAMS: Readonly<LearnerParams> = Object.freeze({
  // A word met once is half forgotten after a day without review, in line with
  // first-exposure forgetting curves (Ebbinghaus; half-life regression studies report
  // new-item half-lives of the order of a day).
  initialHalfLifeHours: 24,
  // Something the prior already calls known (a cognate, a frequent word below the
  // placement threshold) is an old, consolidated memory: prior 1 starts 2^8 = 256x
  // longer (about 8.5 months), prior 0.5 starts 16x longer (16 days). Without this a
  // known word heard once would decay below its prior within days.
  priorHalfLifeDoublings: 8,
  // Repeated failures cannot make an item fade within minutes.
  minHalfLifeHours: 0.5,
  // Two years: nothing is assumed permanent.
  maxHalfLifeHours: 2 * 8760,
  // Close to SM-2's default ease factor of 2.5.
  successGrowth: 2.5,
  // Spacing effect: a success while recall is still ~1 earns only 20% of the growth,
  // so ten repetitions in one sitting do not count like ten spaced reviews.
  massedFloor: 0.2,
  // A full success multiplies the odds of recall by 100 (ln 100 = 4.6): from the
  // default 2% prior one free production lifts recall to about 67%, and a second one a
  // day later makes it near certain. A weak signal (weight 0.2) multiplies the odds by
  // only 2.5, so hearing an unknown word once barely moves it.
  successLogOdds: 4.6,
  // A full failure halves the half-life (a Leitner-style demotion, gentler than a
  // reset to the initial half-life).
  failureShrink: 0.5,
  // A full failure divides the odds by about 150 (ln 150 = 5.0): right after a success
  // (99%) it drops recall to about 40%; from 90% to about 6%. Slightly stronger than a
  // success because a clear failure ("what does this mean?") is less ambiguous than
  // a success, which can be a lucky guess.
  failureLogOdds: 5,
  // Recall is never treated as more certain than 99% when updating, so a failure right
  // after a run of successes still registers.
  levelCap: 0.99,
  // After one full observation the item's own memory and the prior count equally;
  // after four, its own memory counts 80%.
  evidenceHalfWeight: 1,
  // Knowing "tener" means mostly understanding "tuvieron"; the remaining 15% covers
  // unfamiliar irregular forms. Sound, written form and speaking are form-specific
  // (the sound of "tuvieron" is not the sound of "tener"), so they do not back off.
  formBackoff: Object.freeze({ meaning: 0.85, sound: 0, written: 0, speaking: 0 }),
  // One full failure on the form itself halves what it inherits.
  formLapseKeep: 0.5,
  // Understanding a form is nearly as good evidence for its lexeme; failing a form is
  // weak evidence against the lexeme (usually the inflection was the problem), so a
  // couple of lookups of "tuvieron" only dent a well-known "tener".
  formToLexeme: Object.freeze({ success: 0.8, failure: 0.1 }),
}) as Readonly<LearnerParams>;

/**
 * Default prior: with no placement, every item is assumed unknown. 2% leaves room for
 * incidental exposure without letting unknown words count as known.
 */
export const DEFAULT_PRIOR = 0.02;

/** The default prior function: DEFAULT_PRIOR for every key and skill. */
export const defaultPrior: PriorFn = () => DEFAULT_PRIOR;

/** Memory state of one (key, skill) pair. JSON-safe. */
export interface MemoryState {
  halfLifeHours: number;
  /** Time of the latest event (ms since epoch). */
  lastAt: number;
  /** Recall right after the latest event; close to 1 after a clean success. */
  level: number;
  /** Accumulated evidence weight (successes and failures). */
  evidence: number;
  /** Accumulated failure weight. */
  lapses: number;
}

/** Clamp to [0, 1]; NaN becomes 0. */
export function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Recall of a memory at `now`: floor + (level - floor) * 2^(-elapsedHours / halfLife),
 * with floor 0 by default (see recallFloor). Elapsed time is never negative (a query
 * before the latest event reads as "just now"); a NaN time also reads as "just now".
 */
export function recallAt(state: MemoryState, now: number, floor = 0): number {
  const dt = now - state.lastAt;
  const hours = dt > 0 ? dt / HOUR_MS : 0;
  const f = clamp01(floor);
  return clamp01(f + (state.level - f) * Math.pow(2, -hours / state.halfLifeHours));
}

/**
 * The level recall decays to: baseline x (evidence - lapses) / evidence, i.e. the
 * baseline for a success-only history, 0 for a failure-only one (0 without evidence).
 */
export function recallFloor(state: Pick<MemoryState, 'evidence' | 'lapses'>, baseline: number): number {
  if (!(state.evidence > 0)) return 0;
  return clamp01(baseline) * clamp01((state.evidence - state.lapses) / state.evidence);
}

/** Weight of an item's own memory against its baseline: e / (e + halfWeight). */
export function evidenceConfidence(evidence: number, halfWeight: number): number {
  return evidence > 0 ? evidence / (evidence + halfWeight) : 0;
}

/**
 * Starting half-life of an item whose baseline (prior) is `prior`:
 * initialHalfLife * 2^(priorHalfLifeDoublings * prior), within the min/max bounds.
 */
export function initialHalfLife(prior: number, params: LearnerParams): number {
  const h = params.initialHalfLifeHours * Math.pow(2, params.priorHalfLifeDoublings * clamp01(prior));
  return clamp(h, params.minHalfLifeHours, params.maxHalfLifeHours);
}

/** Inputs to updateMemory besides the previous state. */
export interface MemoryUpdate {
  success: boolean;
  weight: number;
  at: number;
  /** pKnown of the item just before this evidence (its baseline if it has no state). */
  pBefore: number;
  /**
   * The item's baseline at this time for a given lapse weight: called with the new lapse
   * weight (just after this evidence) and with the previous one (for the recall floor).
   */
  baselineAfter: (lapses: number) => number;
}

/**
 * Apply one piece of evidence to a memory state and return the new state (pure).
 *
 * The current recall r (decaying towards recallFloor; the baseline pBefore for an item
 * with no state) is clamped to
 * [1 - levelCap, levelCap] and moved in log-odds space:
 * Success: logit(level) = logit(r) + w * successLogOdds;
 *   half-life *= (1 + (successGrowth - 1) * spacing)^w, where
 *   spacing = massedFloor + (1 - massedFloor) * (1 - r), so a success on a half
 *   forgotten item grows the half-life more than one right after the last review.
 * Failure: logit(level) = logit(r) - w * failureLogOdds; half-life *= failureShrink^w;
 *   lapses += w.
 * Evidence += w either way. A first event starts from half-life initialHalfLife(pBefore).
 *
 * Finally the level is clamped so that a success never lowers pKnown and a failure
 * never raises it (this can otherwise happen when recent recall sits below the
 * baseline and the evidence is weak, because more evidence also shifts weight away
 * from the baseline). Weights <= 0 or non-finite leave the state unchanged.
 */
export function updateMemory(
  prev: MemoryState | undefined,
  u: MemoryUpdate,
  params: LearnerParams,
): MemoryState | undefined {
  const w = u.weight;
  if (!(w > 0) || !Number.isFinite(w)) return prev;
  const r0 = prev ? recallAt(prev, u.at, recallFloor(prev, u.baselineAfter(prev.lapses))) : clamp01(u.pBefore);
  const h0 = prev ? prev.halfLifeHours : initialHalfLife(u.pBefore, params);
  const e1 = (prev?.evidence ?? 0) + w;
  const lapses1 = (prev?.lapses ?? 0) + (u.success ? 0 : w);
  const x0 = logit(clamp(r0, 1 - params.levelCap, params.levelCap));
  let h1: number;
  let r1: number;
  if (u.success) {
    const spacing = params.massedFloor + (1 - params.massedFloor) * (1 - r0);
    h1 = h0 * Math.pow(1 + (params.successGrowth - 1) * spacing, w);
    r1 = Math.max(r0, sigmoid(x0 + w * params.successLogOdds));
  } else {
    h1 = h0 * Math.pow(params.failureShrink, w);
    r1 = Math.min(r0, sigmoid(x0 - w * params.failureLogOdds));
  }
  // Direction guard: keep pAfter >= pBefore on success, <= on failure.
  const c1 = evidenceConfidence(e1, params.evidenceHalfWeight);
  const bAfter = clamp01(u.baselineAfter(lapses1));
  const bound = (u.pBefore - (1 - c1) * bAfter) / c1;
  r1 = clamp01(u.success ? Math.max(r1, bound) : Math.min(r1, bound));
  return {
    halfLifeHours: clamp(h1, params.minHalfLifeHours, params.maxHalfLifeHours),
    lastAt: prev ? Math.max(prev.lastAt, u.at) : u.at,
    level: r1,
    evidence: e1,
    lapses: lapses1,
  };
}

/**
 * Merge partial params over the defaults (nested records merged key by key) and check
 * they are usable. Throws RangeError on values that would break the math.
 */
export function resolveLearnerParams(input: LearnerParamsInput = {}): LearnerParams {
  const d = DEFAULT_LEARNER_PARAMS;
  const p: LearnerParams = {
    ...d,
    ...stripUndefined(input),
    formBackoff: { ...d.formBackoff, ...stripUndefined(input.formBackoff ?? {}) },
    formToLexeme: { ...d.formToLexeme, ...stripUndefined(input.formToLexeme ?? {}) },
  };
  const positive: (keyof LearnerParams)[] = [
    'initialHalfLifeHours', 'minHalfLifeHours', 'maxHalfLifeHours', 'successGrowth', 'evidenceHalfWeight',
    'successLogOdds', 'failureLogOdds',
  ];
  for (const k of positive) {
    const v = p[k];
    if (typeof v !== 'number' || !(v > 0) || !Number.isFinite(v)) throw new RangeError(`learner param ${k} must be a positive finite number`);
  }
  if (p.minHalfLifeHours > p.maxHalfLifeHours) throw new RangeError('minHalfLifeHours must not exceed maxHalfLifeHours');
  if (p.successGrowth < 1) throw new RangeError('successGrowth must be >= 1');
  if (!(p.levelCap > 0.5 && p.levelCap < 1)) throw new RangeError('levelCap must be within (0.5, 1)');
  const unit: [string, number][] = [
    ['massedFloor', p.massedFloor], ['failureShrink', p.failureShrink], ['formLapseKeep', p.formLapseKeep],
    ['formToLexeme.success', p.formToLexeme.success], ['formToLexeme.failure', p.formToLexeme.failure],
    ...SKILLS.map((s): [string, number] => [`formBackoff.${s}`, p.formBackoff[s]]),
  ];
  for (const [k, v] of unit) {
    if (!(v >= 0 && v <= 1)) throw new RangeError(`learner param ${k} must be within [0, 1]`);
  }
  if (!(p.priorHalfLifeDoublings >= 0) || !Number.isFinite(p.priorHalfLifeDoublings)) {
    throw new RangeError('priorHalfLifeDoublings must be a non-negative finite number');
  }
  return p;
}

/** The lexeme key of a form key, or undefined for a lexeme key (or a malformed "#..." key). */
function parentLexeme(key: string): string | undefined {
  const lex = lexemeOf(key);
  return lex !== key && lex !== '' ? lex : undefined;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Constructor options of LearnerModel. */
export interface LearnerModelOptions {
  /** Prior per key and skill; defaults to DEFAULT_PRIOR everywhere. */
  prior?: PriorFn;
  params?: LearnerParamsInput;
  /** Event-to-evidence table; defaults to EVENT_EVIDENCE. */
  evidence?: EventEvidenceTable;
}

/** One stored memory in a snapshot. */
export interface SnapshotItem {
  key: string;
  skill: Skill;
  state: MemoryState;
}

/** JSON-safe snapshot of a LearnerModel (the prior function is not included). */
export interface LearnerSnapshot {
  version: 1;
  params: LearnerParams;
  /** Present only when the model used a custom evidence table. */
  evidence?: EventEvidenceTable;
  /** Sorted by key, then by skill in SKILLS order. */
  items: SnapshotItem[];
}

/**
 * The learner model. Implements LearnerView for the rest of the engine.
 *
 * Keys are opaque: "es:está" and "es:esta" are different items, as are "es:'tá" and
 * "es:estar". Normalization (case, accents, clipped forms) is the language pack's job.
 */
export class LearnerModel implements LearnerView {
  readonly params: Readonly<LearnerParams>;
  private readonly prior: PriorFn;
  private readonly table: EventEvidenceTable;
  private readonly memory = new Map<string, Map<Skill, MemoryState>>();

  constructor(opts: LearnerModelOptions = {}) {
    this.prior = opts.prior ?? defaultPrior;
    this.params = resolveLearnerParams(opts.params);
    this.table = opts.evidence ?? EVENT_EVIDENCE;
  }

  /**
   * Record one event. Each piece of evidence it carries (see EVENT_EVIDENCE) updates
   * the item's memory for that skill; for a form key and a skill with form back-off,
   * the evidence also updates the lexeme at formToLexeme weight. Events with an empty
   * key or a non-finite time are ignored. Events may arrive out of order; one earlier
   * than the item's latest event is applied as if it happened at that latest time.
   * Returns true when the event was applied.
   */
  apply(event: LearnerEvent): boolean {
    if (typeof event.key !== 'string' || event.key === '' || !Number.isFinite(event.at)) return false;
    for (const ev of evidenceFor(event, this.table)) this.applyEvidence(event.key, ev, event.at);
    return true;
  }

  /**
   * Record many events in time order (stable sort by `at`, so equal times keep their
   * given order). Returns the number applied.
   */
  applyAll(events: Iterable<LearnerEvent>): number {
    const list = [...events].map((e, i) => ({ e, i }));
    list.sort((a, b) => (a.e.at - b.e.at) || (a.i - b.i));
    let n = 0;
    for (const { e } of list) if (this.apply(e)) n++;
    return n;
  }

  /**
   * Probability in [0, 1] that the learner has `skill` for `key` at `now`:
   * c * recall + (1 - c) * baseline with c = evidence / (evidence + evidenceHalfWeight),
   * recall decaying towards recallFloor(state, baseline). With no evidence this is the
   * baseline (prior, or the back-off blend for forms).
   */
  pKnown(key: string, skill: Skill, now: number): number {
    const st = this.memory.get(key)?.get(skill);
    const base = this.baseline(key, skill, now, st?.lapses ?? 0);
    if (!st) return base;
    const c = evidenceConfidence(st.evidence, this.params.evidenceHalfWeight);
    return clamp01(c * recallAt(st, now, recallFloor(st, base)) + (1 - c) * base);
  }

  /** Keys with any recorded evidence (forms and lexemes), in insertion order. */
  knownKeys(): Iterable<string> {
    return [...this.memory.keys()];
  }

  /** A copy of the memory state for (key, skill), or undefined if none. */
  memoryOf(key: string, skill: Skill): MemoryState | undefined {
    const st = this.memory.get(key)?.get(skill);
    return st ? { ...st } : undefined;
  }

  /**
   * Baseline of an item before its own evidence is counted. For a lexeme (or a skill
   * without back-off) it is the prior. For a form with back-off share s for this skill:
   *     (1 - s) * prior(form) + s * formLapseKeep^lapses * pKnown(lexeme)
   * so a form mostly inherits its lexeme's knowledge, and failures on the form itself
   * shrink the inherited part (never shifting weight to the prior, so a failure can
   * only lower the baseline).
   */
  baseline(key: string, skill: Skill, now: number, lapses = this.memory.get(key)?.get(skill)?.lapses ?? 0): number {
    const own = clamp01(this.prior(key, skill));
    const lex = parentLexeme(key);
    const share = this.params.formBackoff[skill];
    if (lex === undefined || !(share > 0)) return own;
    const inherited = share * Math.pow(this.params.formLapseKeep, lapses) * this.pKnown(lex, skill, now);
    return clamp01((1 - share) * own + inherited);
  }

  /** JSON-safe snapshot of all memory states and params (not the prior function). */
  snapshot(): LearnerSnapshot {
    const items: SnapshotItem[] = [];
    const keys = [...this.memory.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const key of keys) {
      const bySkill = this.memory.get(key);
      if (!bySkill) continue;
      for (const skill of SKILLS) {
        const st = bySkill.get(skill);
        if (st) items.push({ key, skill, state: { ...st } });
      }
    }
    const snap: LearnerSnapshot = {
      version: 1,
      params: JSON.parse(JSON.stringify(this.params)) as LearnerParams,
      items,
    };
    if (this.table !== EVENT_EVIDENCE) snap.evidence = JSON.parse(JSON.stringify(this.table)) as EventEvidenceTable;
    return snap;
  }

  /**
   * Rebuild a model from a snapshot. The prior function is not serializable, so pass
   * the same prior used originally to get identical pKnown values. Throws on a
   * snapshot that is not version 1 or has malformed items.
   */
  static restore(snapshot: LearnerSnapshot, opts: { prior?: PriorFn } = {}): LearnerModel {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.items)) {
      throw new Error('LearnerModel.restore: unsupported snapshot');
    }
    const model = new LearnerModel({ prior: opts.prior, params: snapshot.params, evidence: snapshot.evidence });
    for (const item of snapshot.items) {
      const st = item?.state;
      const ok =
        typeof item?.key === 'string' && item.key !== '' && SKILLS.includes(item.skill) && !!st &&
        [st.halfLifeHours, st.lastAt, st.level, st.evidence, st.lapses].every((x) => typeof x === 'number' && Number.isFinite(x)) &&
        st.halfLifeHours > 0;
      if (!ok) throw new Error('LearnerModel.restore: malformed snapshot item');
      model.setState(item.key, item.skill, { ...st });
    }
    return model;
  }

  private setState(key: string, skill: Skill, st: MemoryState): void {
    let bySkill = this.memory.get(key);
    if (!bySkill) {
      bySkill = new Map();
      this.memory.set(key, bySkill);
    }
    bySkill.set(skill, st);
  }

  private applyEvidence(key: string, ev: Evidence, at: number): void {
    if (!(ev.weight > 0)) return;
    const pBefore = this.pKnown(key, ev.skill, at);
    const lex = parentLexeme(key);
    if (lex !== undefined && this.params.formBackoff[ev.skill] > 0) {
      const share = ev.success ? this.params.formToLexeme.success : this.params.formToLexeme.failure;
      this.updateOne(lex, ev.skill, ev.success, ev.weight * share, at, this.pKnown(lex, ev.skill, at));
    }
    this.updateOne(key, ev.skill, ev.success, ev.weight, at, pBefore);
  }

  private updateOne(key: string, skill: Skill, success: boolean, weight: number, at: number, pBefore: number): void {
    const prev = this.memory.get(key)?.get(skill);
    const next = updateMemory(
      prev,
      { success, weight, at, pBefore, baselineAfter: (lapses) => this.baseline(key, skill, at, lapses) },
      this.params,
    );
    if (next && next !== prev) this.setState(key, skill, next);
  }
}
