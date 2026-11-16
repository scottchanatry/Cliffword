/**
 * The model self-test (app/profile/selftest.tsx, hidden behind seven taps on the version):
 * scores the proof sentences of selftestData.ts with the model adapter's scoreContinuation after
 * "Frase en español:\n", and compares each total with the one Qwen3-1.7B gave on the Linux proof
 * run. On a device this checks the llama.rn scoring path end to end: tokenizer, start token,
 * context handling and the native patch (or the forced-decoding fallback, whose tokens outside
 * the top N are only upper bounds, so its totals run high).
 *
 * Verdicts:
 * - 'pass': every total within the tolerance (0.15 nats) of the proof's;
 * - 'fail': at least one total is further off, or a call failed;
 * - 'mock': the mock model (web, tests): its numbers have nothing to compare with, so only
 *   the totals and the timings are shown.
 */
import { totalLogprob } from '@cliffword/engine';
import type { ModelAdapter, ModelBackend, ModelScoringPath } from '../../adapters/model/types';
import { SELF_TEST_CONTEXT, SELF_TEST_PAIRS, SELF_TEST_TOLERANCE, type SelfTestPair } from './selftestData';

export type SelfTestVerdict = 'pass' | 'fail' | 'mock';

export interface SentenceResult {
  text: string;
  /** The proof run's total, in nats. */
  expected: number;
  /** This model's total, or null when the call failed. */
  actual: number | null;
  /** |actual - expected|, or null when the call failed. */
  diff: number | null;
  /** How long scoreContinuation took. */
  ms: number;
  tokens: number;
  /** Tokens whose logprob is an upper bound (forced decoding). */
  upperBound: number;
  /** The call's error message, when it failed. */
  error?: string;
}

export interface PairResult {
  pair: SelfTestPair;
  good: SentenceResult;
  bad: SentenceResult;
  /** The model prefers the good sentence (null when a call failed). */
  prefersGood: boolean | null;
}

export interface SelfTestReport {
  verdict: SelfTestVerdict;
  modelId: string;
  backend: ModelBackend;
  scoring: ModelScoringPath;
  tolerance: number;
  pairs: PairResult[];
  /** Sentences scored, and how many are within the tolerance. */
  sentences: number;
  within: number;
  /** Largest difference among the scored sentences (0 when none was scored). */
  maxDiff: number;
  /** Pairs where the good sentence scored higher, of the pairs scored. */
  preferred: number;
  scoredPairs: number;
  failedCalls: number;
  totalMs: number;
}

export type SelfTestModel = Pick<ModelAdapter, 'scoreContinuation' | 'info'>;

export interface RunSelfTestOptions {
  /** A monotonic time in ms for the timings (performance.now on a device). */
  now: () => number;
  pairs?: readonly SelfTestPair[];
  context?: string;
  tolerance?: number;
  /** Called after each sentence with the number done and the number to do. */
  onProgress?: (done: number, total: number) => void;
}

/** The verdict for scored sentences (see the module comment). */
export function selfTestVerdict(
  backend: ModelBackend,
  results: readonly Pick<SentenceResult, 'diff'>[],
  tolerance: number = SELF_TEST_TOLERANCE,
): SelfTestVerdict {
  if (backend === 'mock') return 'mock';
  if (results.length === 0) return 'fail';
  return results.every((r) => r.diff !== null && r.diff <= tolerance) ? 'pass' : 'fail';
}

async function scoreOne(model: SelfTestModel, context: string, text: string, expected: number, now: () => number): Promise<SentenceResult> {
  const started = now();
  try {
    const tokens = await model.scoreContinuation(context, text);
    const actual = totalLogprob(tokens);
    return {
      text,
      expected,
      actual,
      diff: Math.abs(actual - expected),
      ms: Math.max(0, now() - started),
      tokens: tokens.length,
      upperBound: tokens.filter((t) => t.upperBound).length,
    };
  } catch (e) {
    return {
      text,
      expected,
      actual: null,
      diff: null,
      ms: Math.max(0, now() - started),
      tokens: 0,
      upperBound: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Scores every proof sentence in order (one model call at a time) and builds the report. */
export async function runSelfTest(model: SelfTestModel, opts: RunSelfTestOptions): Promise<SelfTestReport> {
  const pairs = opts.pairs ?? SELF_TEST_PAIRS;
  const context = opts.context ?? SELF_TEST_CONTEXT;
  const tolerance = opts.tolerance ?? SELF_TEST_TOLERANCE;
  const info = model.info;
  const total = pairs.length * 2;
  const results: PairResult[] = [];
  let done = 0;
  for (const pair of pairs) {
    const good = await scoreOne(model, context, pair.good, pair.goodTotal, opts.now);
    opts.onProgress?.(++done, total);
    const bad = await scoreOne(model, context, pair.bad, pair.badTotal, opts.now);
    opts.onProgress?.(++done, total);
    const prefersGood = good.actual !== null && bad.actual !== null ? good.actual > bad.actual : null;
    results.push({ pair, good, bad, prefersGood });
  }
  const sentences = results.flatMap((r) => [r.good, r.bad]);
  const scored = sentences.filter((s) => s.diff !== null);
  return {
    verdict: selfTestVerdict(info.backend, sentences, tolerance),
    modelId: info.id,
    backend: info.backend,
    scoring: info.scoring ?? 'exact',
    tolerance,
    pairs: results,
    sentences: sentences.length,
    within: scored.filter((s) => (s.diff ?? Infinity) <= tolerance).length,
    maxDiff: scored.reduce((m, s) => Math.max(m, s.diff ?? 0), 0),
    preferred: results.filter((r) => r.prefersGood === true).length,
    scoredPairs: results.filter((r) => r.prefersGood !== null).length,
    failedCalls: sentences.length - scored.length,
    totalMs: sentences.reduce((sum, s) => sum + s.ms, 0),
  };
}
