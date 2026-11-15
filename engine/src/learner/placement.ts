/**
 * Placement: the first story gets harder until the learner stalls, and the answers
 * along the way estimate how far down the frequency list the learner's knowledge
 * reaches. There is no test screen.
 *
 * Method
 * ------
 * - Frequency ranks are grouped into bands on a log scale: band b holds ranks in
 *   [ratio^b, ratio^(b+1)) (ratio 2 by default, so band 10 is ranks 1024-2047).
 * - Staircase: a success at or above the current target band moves the target up
 *   (two bands at a time until the first failure, then one); a failure at or below the
 *   target moves it to one band below the failed band. Successes on easier words are
 *   kept for the fit but do not move the target.
 * - Stall: two failures at the same band with no success at that band or harder in
 *   between. Placement is done when stalled (once at least minItems words have been
 *   seen, because a stall after three or four words is mostly noise) or after maxItems
 *   items. After a stall the staircase keeps probing around the threshold.
 * - Estimate: a one-parameter logistic fit on log rank,
 *       P(success | rank) = sigmoid(slope * (theta - ln rank)),
 *   with a fixed slope (a two-parameter fit is unstable on a dozen answers and
 *   diverges on perfectly separated ones) and a weak Gaussian prior on theta. The MAP
 *   theta is the root of a strictly decreasing derivative, found by bisection, so it
 *   is deterministic and always finite. The threshold rank is exp(theta): the rank at
 *   which the learner knows half the words.
 * - prior() turns the estimate into a LearnerModel prior: P(meaning) from the fitted
 *   curve at the word's rank, scaled per skill, with cognates floored at a moderate
 *   value.
 */
import type { LanguagePack } from '../lang/types';
import type { PriorFn } from './model';
import { lexemeOf, type Skill } from './types';

/** Tunable numbers of placement. See DEFAULT_PLACEMENT_OPTIONS for the reasoning. */
export interface PlacementOptions {
  /** Width of a frequency band as a rank ratio. */
  bandRatio: number;
  /** The first band probed is the band containing this rank. */
  startRank: number;
  /** Lowest and highest band ever suggested. */
  minBand: number;
  maxBand: number;
  /** Bands to climb after a success, before the first failure. */
  fastClimbStep: number;
  /** Bands to climb after a success, once a failure has been seen. */
  climbStep: number;
  /** Failures at one band (without an intervening success at it or harder) that mean "stalled". */
  stallFailures: number;
  /** A stall ends placement only once this many items have been recorded. */
  minItems: number;
  /** Placement ends after this many recorded items. */
  maxItems: number;
  /** Logistic slope per natural-log unit of rank. */
  slope: number;
  /** Centre of the prior on the threshold rank. */
  priorCenterRank: number;
  /** Standard deviation of the prior on ln(threshold rank). */
  priorSpreadLn: number;
  /** P(skill) = P(meaning from the fit) * skillShare[skill]. */
  skillShare: Record<Skill, number>;
  /** Priors are kept inside [minPrior, maxPrior]. */
  minPrior: number;
  maxPrior: number;
  /** Rank assumed for a word missing from the frequency list. */
  unknownRank: number;
  /** Floor for cognates, per skill. */
  cognatePrior: Record<Skill, number>;
  /** Prior for every non-cognate in brandNew(). */
  brandNewPrior: number;
}

/** Defaults; to be calibrated against learners who take both placement and later stories. */
export const DEFAULT_PLACEMENT_OPTIONS: Readonly<PlacementOptions> = Object.freeze({
  // Factor-of-two bands: coarse enough to climb fast, and the fit refines inside them.
  bandRatio: 2,
  // Band 6 = ranks 64-127: the commonest content words beyond the taught function words.
  startRank: 64,
  minBand: 0,
  // Band 15 = ranks 32768-65535: beyond any learner frequency list.
  maxBand: 15,
  // Climb fast while everything is known so strong learners are not bored.
  fastClimbStep: 2,
  climbStep: 1,
  // The brief: done when the learner stalls, i.e. two failures in a row at a band.
  stallFailures: 2,
  // Simulated noisy learners (logistic answers, slope 1.5) land within a factor of two
  // of their true threshold about 85% of the time when placement may stop after 4
  // words, and about 93% with at least 12 (16: 94%, 20: 96%). A first story easily
  // holds a dozen probe words, so 12 costs the learner nothing.
  minItems: 12,
  // A first story of a few minutes holds about this many probe words.
  maxItems: 40,
  // At twice the threshold rank a word is known with p = 0.26, at half with p = 0.74:
  // vocabulary knowledge falls off gradually, not as a cliff.
  slope: 1.5,
  // Centre on a lower-intermediate learner; the spread (e^3 = 20x either way at one
  // standard deviation) lets the answers dominate after a few items.
  priorCenterRank: 1000,
  priorSpreadLn: 3,
  // Placement mostly measures understanding. Written recognition tracks it closely;
  // recognition by ear lags reading for most classroom learners; production lags
  // comprehension most.
  skillShare: Object.freeze({ meaning: 1, written: 0.9, sound: 0.8, speaking: 0.5 }),
  // Never certain either way from a few minutes of placement. The ceiling sits above the
  // top of the known-word band (0.95 to 0.98, at most 0.99 with momentum; see
  // DEFAULT_DIFFICULTY_OPTIONS): at 0.95 a placed learner's commonest words could at best
  // reach the band's lower edge, so no sentence would land inside it.
  minPrior: 0.002,
  maxPrior: 0.99,
  unknownRank: 50000,
  // Cognates: probably understood (hospital, chocolate), less reliably by ear, rarely
  // produced unprompted at first.
  cognatePrior: Object.freeze({ meaning: 0.5, written: 0.5, sound: 0.3, speaking: 0.1 }),
  // "I'm brand new": assume nothing beyond cognates.
  brandNewPrior: 0.002,
}) as Readonly<PlacementOptions>;

/** A frequency band to probe next. Ranks are real numbers: pick words with minRank <= rank < maxRank. */
export interface PlacementBand {
  band: number;
  minRank: number;
  maxRank: number;
  /** Geometric centre of the band. */
  centerRank: number;
}

/** One recorded placement item. */
export interface PlacementItem {
  key: string;
  rank: number;
  success: boolean;
}

/** Result of the logistic fit. */
export interface PlacementEstimate {
  /** Rank at which the learner knows half the words: exp(logThreshold). */
  thresholdRank: number;
  logThreshold: number;
  slope: number;
  /** Posterior standard deviation of logThreshold (Laplace approximation). */
  standardErrorLn: number;
  items: number;
}

/** JSON-safe snapshot of a PlacementTracker. */
export interface PlacementSnapshot {
  version: 1;
  options: PlacementOptions;
  items: PlacementItem[];
}

/** Options over the defaults; keys given as undefined keep their default. */
function withDefaults(opts: Partial<PlacementOptions>): PlacementOptions {
  const out: PlacementOptions = { ...DEFAULT_PLACEMENT_OPTIONS };
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Band index of a rank: floor(ln rank / ln ratio), with a tiny tolerance so exact
 * powers of the ratio land in their own band despite floating-point error, clamped to
 * [minBand, maxBand].
 */
export function bandOf(rank: number, opts: Pick<PlacementOptions, 'bandRatio' | 'minBand' | 'maxBand'> = DEFAULT_PLACEMENT_OPTIONS): number {
  const r = rank >= 1 ? rank : 1;
  return clamp(Math.floor(Math.log(r) / Math.log(opts.bandRatio) + 1e-9), opts.minBand, opts.maxBand);
}

/** Rank bounds of band b: [ratio^b, ratio^(b+1)), centre ratio^(b+0.5). */
export function bandRange(band: number, opts: Pick<PlacementOptions, 'bandRatio'> = DEFAULT_PLACEMENT_OPTIONS): PlacementBand {
  const q = opts.bandRatio;
  return { band, minRank: Math.pow(q, band), maxRank: Math.pow(q, band + 1), centerRank: Math.pow(q, band + 0.5) };
}

/**
 * MAP estimate of theta = ln(threshold rank) for answers at the given ranks under
 * P(success) = sigmoid(slope * (theta - ln rank)) with a N(mu, sigma^2) prior on theta.
 * The log-posterior derivative
 *     g(theta) = sum slope * (y_i - p_i(theta)) - (theta - mu) / sigma^2
 * is strictly decreasing, so its single root is found by bisection (deterministic,
 * always finite, even for perfectly separated answers).
 */
export function fitLogThreshold(
  items: readonly { rank: number; success: boolean }[],
  slope: number,
  mu: number,
  sigma: number,
): { theta: number; standardError: number } {
  const lnr = items.map((it) => Math.log(it.rank >= 1 ? it.rank : 1));
  const prec = 1 / (sigma * sigma);
  const g = (theta: number): number => {
    let s = -(theta - mu) * prec;
    for (let i = 0; i < items.length; i++) {
      s += slope * ((items[i]?.success ? 1 : 0) - sigmoid(slope * (theta - (lnr[i] ?? 0))));
    }
    return s;
  };
  // Bracket: every data term is within +-slope, so the root is within n*slope/prec of mu.
  const reach = items.length * slope * sigma * sigma + 1;
  let lo = mu - reach;
  let hi = mu + reach;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  let info = prec;
  for (const l of lnr) {
    const p = sigmoid(slope * (theta - l));
    info += slope * slope * p * (1 - p);
  }
  return { theta, standardError: 1 / Math.sqrt(info) };
}

/**
 * Tracks the placement story: records answers, suggests the next frequency band to
 * probe, says when placement is done, and turns the answers into a prior.
 */
export class PlacementTracker {
  readonly options: Readonly<PlacementOptions>;
  private readonly history: PlacementItem[] = [];
  private target: number;
  private sawFailure = false;
  private isStalled = false;
  /** Failures per band since the last success at that band or harder. */
  private readonly failuresAt = new Map<number, number>();

  constructor(opts: Partial<PlacementOptions> = {}) {
    this.options = withDefaults(opts);
    this.target = bandOf(this.options.startRank, this.options);
  }

  /**
   * Record whether the learner knew the word `key` with frequency rank `rank`
   * (1 = most frequent). Updates the staircase and the stall check (see the module
   * comment). Returns false, recording nothing, if the rank is not a finite number >= 1.
   * Items recorded after placement is done still count for the estimate.
   */
  record(key: string, rank: number, success: boolean): boolean {
    if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return false;
    const o = this.options;
    this.history.push({ key, rank, success });
    const b = bandOf(rank, o);
    if (success) {
      for (const k of [...this.failuresAt.keys()]) if (k <= b) this.failuresAt.delete(k);
      if (b >= this.target) {
        this.target = clamp(b + (this.sawFailure ? o.climbStep : o.fastClimbStep), o.minBand, o.maxBand);
      }
    } else {
      this.sawFailure = true;
      const n = (this.failuresAt.get(b) ?? 0) + 1;
      this.failuresAt.set(b, n);
      if (n >= o.stallFailures) this.isStalled = true;
      if (b <= this.target) this.target = clamp(b - 1, o.minBand, o.maxBand);
    }
    return true;
  }

  /** The frequency band the next probe word should come from. */
  nextBand(): PlacementBand {
    return bandRange(this.target, this.options);
  }

  /** True once two failures in a row hit the same band. */
  get stalled(): boolean {
    return this.isStalled;
  }

  /** True when stalled with at least minItems items, or when maxItems items have been recorded. */
  get done(): boolean {
    const n = this.history.length;
    return (this.isStalled && n >= this.options.minItems) || n >= this.options.maxItems;
  }

  /** Same as `done`, as a method. */
  isDone(): boolean {
    return this.done;
  }

  /** Recorded items, oldest first (copies). */
  items(): PlacementItem[] {
    return this.history.map((it) => ({ ...it }));
  }

  /**
   * Logistic fit of the answers so far on log rank (see fitLogThreshold). With no
   * answers it returns the prior centre.
   */
  estimate(): PlacementEstimate {
    const o = this.options;
    const { theta, standardError } = fitLogThreshold(this.history, o.slope, Math.log(o.priorCenterRank), o.priorSpreadLn);
    return { thresholdRank: Math.exp(theta), logThreshold: theta, slope: o.slope, standardErrorLn: standardError, items: this.history.length };
  }

  /**
   * A prior function for LearnerModel from the current estimate (fixed at call time):
   * P(meaning | key) = sigmoid(slope * (theta - ln rank(lexeme))), times skillShare for
   * other skills, floored at cognatePrior for cognates, kept inside [minPrior, maxPrior].
   * `rankOf` receives the lexeme key (form keys are reduced to their lexeme) and
   * returns its frequency rank, or undefined for words not in the list (unknownRank is
   * used). See rankOfFromPack. `cognateKeys` are lexeme keys, e.g. "es:hospital".
   */
  prior(rankOf: (lexemeKey: string) => number | undefined, cognateKeys: Iterable<string> = []): PriorFn {
    const o = this.options;
    const { logThreshold: theta } = this.estimate();
    const cognates = new Set([...cognateKeys].map(lexemeOf));
    return (key, skill) => {
      const lex = lexemeOf(key);
      const rank = rankOf(lex);
      const r = typeof rank === 'number' && rank >= 1 && Number.isFinite(rank) ? rank : o.unknownRank;
      let p = sigmoid(o.slope * (theta - Math.log(r))) * (o.skillShare[skill] ?? 0);
      if (cognates.has(lex)) p = Math.max(p, o.cognatePrior[skill] ?? 0);
      return clamp(p, o.minPrior, o.maxPrior);
    };
  }

  /** JSON-safe snapshot (options and items); restore replays the items. */
  snapshot(): PlacementSnapshot {
    return { version: 1, options: JSON.parse(JSON.stringify(this.options)) as PlacementOptions, items: this.items() };
  }

  /** Rebuild a tracker by replaying a snapshot's items. Throws on an unsupported snapshot. */
  static restore(snapshot: PlacementSnapshot): PlacementTracker {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.items)) {
      throw new Error('PlacementTracker.restore: unsupported snapshot');
    }
    const t = new PlacementTracker(snapshot.options);
    for (const it of snapshot.items) t.record(it.key, it.rank, it.success);
    return t;
  }

  /**
   * Prior for "I'm brand new" (placement skipped): cognates get cognatePrior per skill
   * (moderate meaning, lower sound and speaking); every other item gets brandNewPrior.
   * Pass lexeme keys; forms of a cognate get the cognate prior too.
   */
  static brandNew(cognateKeys: Iterable<string>, opts: Partial<PlacementOptions> = {}): PriorFn {
    const o = withDefaults(opts);
    const cognates = new Set([...cognateKeys].map(lexemeOf));
    return (key, skill) => (cognates.has(lexemeOf(key)) ? clamp(o.cognatePrior[skill] ?? 0, 0, 1) : o.brandNewPrior);
  }
}

/**
 * Rank lookup for PlacementTracker.prior from a language pack: strips the "lang:"
 * prefix of a lexeme key and asks pack.frequencyRank. Keys of another language
 * return undefined.
 */
export function rankOfFromPack(pack: Pick<LanguagePack, 'code' | 'frequencyRank'>): (lexemeKey: string) => number | undefined {
  const prefix = `${pack.code}:`;
  return (key) => (key.startsWith(prefix) ? pack.frequencyRank(lexemeOf(key).slice(prefix.length)) : undefined);
}

