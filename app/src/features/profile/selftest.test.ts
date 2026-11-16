import type { TokenScore } from '@cliffword/engine';
import type { ModelInfo } from '../../adapters/model/types';
import { runSelfTest, selfTestVerdict, type SelfTestModel } from './selftest';
import { SELF_TEST_CONTEXT, SELF_TEST_PAIRS, SELF_TEST_TOLERANCE, type SelfTestPair } from './selftestData';

/** A model that gives each sentence a chosen total, split over two tokens that concatenate to the text. */
function fakeModel(info: ModelInfo, totalFor: (text: string) => number | Error, upperBound = false): SelfTestModel & { calls: [string, string][] } {
  const calls: [string, string][] = [];
  return {
    info,
    calls,
    async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
      calls.push([context, text]);
      const total = totalFor(text);
      if (total instanceof Error) throw total;
      const cut = Math.max(1, Math.floor(text.length / 2));
      return [
        { text: text.slice(0, cut), start: 0, end: cut, logprob: total / 2 },
        { text: text.slice(cut), start: cut, end: text.length, logprob: total / 2, ...(upperBound ? { upperBound: true } : {}) },
      ];
    },
  };
}

const LLAMA: ModelInfo = { id: 'qwen3-1.7b-q4_k_m', contextSize: 2048, backend: 'llama.rn', scoring: 'native' };
const expected = new Map(SELF_TEST_PAIRS.flatMap((p) => [[p.good, p.goodTotal] as const, [p.bad, p.badTotal] as const]));
const proofTotal = (text: string) => expected.get(text) ?? 0;
let tick = 0;
const now = () => (tick += 7);

describe('model self-test', () => {
  it('scores every proof sentence after "Frase en español:\\n" and passes when the totals match', async () => {
    const model = fakeModel(LLAMA, (text) => proofTotal(text) + 0.1);
    const report = await runSelfTest(model, { now });
    expect(model.calls).toHaveLength(SELF_TEST_PAIRS.length * 2);
    expect(model.calls.every(([context]) => context === SELF_TEST_CONTEXT)).toBe(true);
    expect(SELF_TEST_CONTEXT).toBe('Frase en español:\n');
    expect(report).toMatchObject({
      verdict: 'pass',
      backend: 'llama.rn',
      scoring: 'native',
      sentences: SELF_TEST_PAIRS.length * 2,
      within: SELF_TEST_PAIRS.length * 2,
      preferred: SELF_TEST_PAIRS.length,
      scoredPairs: SELF_TEST_PAIRS.length,
      failedCalls: 0,
      tolerance: 0.15,
    });
    expect(report.maxDiff).toBeCloseTo(0.1, 6);
    expect(report.totalMs).toBe(7 * SELF_TEST_PAIRS.length * 2);
  });

  it('fails when one total is further off than the tolerance', async () => {
    const off = SELF_TEST_PAIRS[2] as SelfTestPair;
    const report = await runSelfTest(fakeModel(LLAMA, (text) => (text === off.bad ? off.badTotal - 0.2 : proofTotal(text))), { now });
    expect(report.verdict).toBe('fail');
    expect(report.within).toBe(report.sentences - 1);
    expect(report.maxDiff).toBeCloseTo(0.2, 6);
    // Exactly at the tolerance still passes.
    expect(selfTestVerdict('llama.rn', [{ diff: SELF_TEST_TOLERANCE }])).toBe('pass');
    expect(selfTestVerdict('llama.rn', [{ diff: SELF_TEST_TOLERANCE + 1e-9 }])).toBe('fail');
  });

  it('fails when a call fails, and keeps going', async () => {
    const broken = SELF_TEST_PAIRS[0] as SelfTestPair;
    const report = await runSelfTest(fakeModel(LLAMA, (text) => (text === broken.good ? new Error('context full') : proofTotal(text))), { now });
    expect(report.verdict).toBe('fail');
    expect(report.failedCalls).toBe(1);
    expect(report.pairs[0]?.good).toMatchObject({ actual: null, diff: null, error: 'context full' });
    expect(report.pairs[0]?.prefersGood).toBeNull();
    expect(report.scoredPairs).toBe(SELF_TEST_PAIRS.length - 1);
  });

  it('counts the pairs where the model prefers the correct sentence', async () => {
    const swapped = SELF_TEST_PAIRS[1] as SelfTestPair;
    const report = await runSelfTest(
      fakeModel(LLAMA, (text) => (text === swapped.good ? swapped.badTotal - 1 : proofTotal(text))),
      { now },
    );
    expect(report.preferred).toBe(SELF_TEST_PAIRS.length - 1);
    expect(report.pairs[1]?.prefersGood).toBe(false);
  });

  it('reports forced decoding and its upper-bound tokens', async () => {
    const report = await runSelfTest(fakeModel({ ...LLAMA, scoring: 'forced-decoding' }, proofTotal, true), { now });
    expect(report.scoring).toBe('forced-decoding');
    expect(report.pairs[0]?.good.upperBound).toBe(1);
    expect(report.pairs[0]?.good.tokens).toBe(2);
  });

  it('says "mock" for the mock model, whatever its numbers', async () => {
    const report = await runSelfTest(fakeModel({ id: 'mock-ngram-es', contextSize: 4096, backend: 'mock' }, () => -3), { now });
    expect(report.verdict).toBe('mock');
    expect(report.scoring).toBe('exact');
    expect(selfTestVerdict('mock', [])).toBe('mock');
    expect(selfTestVerdict('llama.rn', [])).toBe('fail');
  });

  it('reports progress after each sentence', async () => {
    const seen: string[] = [];
    await runSelfTest(fakeModel(LLAMA, proofTotal), { now, pairs: SELF_TEST_PAIRS.slice(0, 2), onProgress: (d, t) => seen.push(`${d}/${t}`) });
    expect(seen).toEqual(['1/4', '2/4', '3/4', '4/4']);
  });

  it('carries proof data whose correct sentences score higher, with ids from the proof run', () => {
    expect(SELF_TEST_PAIRS.length).toBeGreaterThanOrEqual(5);
    for (const pair of SELF_TEST_PAIRS) {
      expect(pair.id).toMatch(/^(pairs|slang)#\d+$/);
      expect(pair.goodTotal).toBeGreaterThan(pair.badTotal);
    }
  });
});
