/**
 * Word alignment: Levenshtein over word keys, for comparing what the learner said or
 * sang with what was expected ("6 of 7 landed", "understood N of M words").
 *
 * The aligner is language-neutral and works on whatever keys the caller passes: words
 * from LanguagePack.segment(), normalized and folded as the caller sees fit (echoLine
 * uses looseKey). It never splits text itself.
 */

/**
 * match: same word (cost 0, or an equivalence); substitute: a different word in its
 * place; delete: an expected word with nothing heard for it; insert: a heard word with
 * no expected word.
 */
export type AlignOp = 'match' | 'substitute' | 'delete' | 'insert';

export interface AlignStep {
  op: AlignOp;
  /** Indices into `expected` covered by this step ([] for insert). */
  expected: number[];
  /** Indices into `heard` covered by this step ([] for delete). */
  heard: number[];
  /** Cost the step added. */
  cost: number;
  /** The step matched through one of AlignOptions.equivalents. */
  equivalent?: boolean;
}

/** Word sequences that count as the same thing, one on each side ("pa'l" = "para el"). */
export type WordEquivalent = readonly [readonly string[], readonly string[]];

export interface AlignOptions {
  /**
   * Cost of putting heard word `b` in the place of expected word `a`. 0 makes the pair a
   * match. Default: 0 when the keys are equal, else 1. Return values between 0 and 2
   * (the cost of a delete plus an insert); anything higher is never chosen.
   */
  substituteCost: (a: string, b: string) => number;
  /** Cost of an expected word that was not heard. */
  deleteCost: number;
  /** Cost of a heard word that was not expected. */
  insertCost: number;
  /**
   * Word sequences that match each other at cost 0, in either direction: an expected run
   * equal to one side and a heard run equal to the other match as one step.
   */
  equivalents: readonly WordEquivalent[];
}

export const DEFAULT_ALIGN_OPTIONS: Readonly<AlignOptions> = {
  substituteCost: (a, b) => (a === b ? 0 : 1),
  // Plain Levenshtein: every edit costs one word.
  deleteCost: 1,
  insertCost: 1,
  equivalents: [],
};

function runEquals(words: readonly string[], at: number, run: readonly string[]): boolean {
  if (run.length === 0 || at + run.length > words.length) return false;
  for (let k = 0; k < run.length; k++) if (words[at + k] !== run[k]) return false;
  return true;
}

/**
 * Align `heard` to `expected` with the smallest total cost (Levenshtein with a custom
 * substitution cost and multi-word equivalences).
 *
 * Method: dynamic programming over prefixes. From each state (i expected words, j heard
 * words) the moves are: pair expected[i] with heard[j] (substituteCost; a match when it
 * is 0), skip expected[i] (deleteCost), skip heard[j] (insertCost), or match a run
 * through an equivalence (cost 0). States are relaxed in order, so every predecessor is
 * final before a state is used. Among alignments of equal cost the one that matches
 * more expected words wins ("a b c d" against "a x d e" matches d rather than
 * substituting three words); remaining ties keep the first move found, in the order
 * equivalence, pair, delete, insert, so the result is deterministic and prefers pairing
 * words over leaving them out. Returns the steps in order; every expected and heard
 * index appears in exactly one step.
 */
export function alignWords(
  expected: readonly string[],
  heard: readonly string[],
  opts: Partial<AlignOptions> = {},
): AlignStep[] {
  const o: AlignOptions = { ...DEFAULT_ALIGN_OPTIONS, ...opts };
  const n = expected.length;
  const m = heard.length;
  const W = m + 1;
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  const from = new Int32Array((n + 1) * W).fill(-1);
  const matched = new Int32Array((n + 1) * W);
  const stepOf: (AlignStep | undefined)[] = new Array((n + 1) * W);
  cost[0] = 0;

  // Equivalence runs starting at each expected / heard position, both directions.
  const pairs: { e: readonly string[]; h: readonly string[] }[] = [];
  for (const [a, b] of o.equivalents) {
    pairs.push({ e: a, h: b });
    pairs.push({ e: b, h: a });
  }

  const relax = (i: number, j: number, ni: number, nj: number, step: AlignStep) => {
    const here = i * W + j;
    const c = (cost[here] as number) + step.cost;
    const k = (matched[here] as number) + (step.op === 'match' ? step.expected.length : 0);
    const at = ni * W + nj;
    const best = cost[at] as number;
    if (c < best - 1e-12 || (Math.abs(c - best) <= 1e-12 && k > (matched[at] as number))) {
      cost[at] = c;
      matched[at] = k;
      from[at] = here;
      stepOf[at] = step;
    }
  };

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (!Number.isFinite(cost[i * W + j] as number)) continue;
      for (const p of pairs) {
        if (runEquals(expected, i, p.e) && runEquals(heard, j, p.h)) {
          const e = Array.from({ length: p.e.length }, (_, k) => i + k);
          const h = Array.from({ length: p.h.length }, (_, k) => j + k);
          relax(i, j, i + p.e.length, j + p.h.length, { op: 'match', expected: e, heard: h, cost: 0, equivalent: true });
        }
      }
      if (i < n && j < m) {
        const c = Math.max(0, o.substituteCost(expected[i] as string, heard[j] as string));
        relax(i, j, i + 1, j + 1, { op: c === 0 ? 'match' : 'substitute', expected: [i], heard: [j], cost: c });
      }
      if (i < n) relax(i, j, i + 1, j, { op: 'delete', expected: [i], heard: [], cost: o.deleteCost });
      if (j < m) relax(i, j, i, j + 1, { op: 'insert', expected: [], heard: [j], cost: o.insertCost });
    }
  }

  const steps: AlignStep[] = [];
  let at = n * W + m;
  while (at > 0) {
    const step = stepOf[at];
    if (!step) break;
    steps.push(step);
    at = from[at] as number;
  }
  return steps.reverse();
}

/** Total cost of an alignment. */
export function alignmentCost(steps: readonly AlignStep[]): number {
  let s = 0;
  for (const st of steps) s += st.cost;
  return s;
}
