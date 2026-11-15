import { describe, expect, it } from 'vitest';
import { createMockModel } from './mock';
import { boundedCount, DEFAULT_TOP_N_OPTIONS, TopNBoundedModel } from './topN';
import { totalLogprob, type GenerateOptions, type LanguageModel, type TokenCandidate, type TokenScore } from './types';

/** A model with fixed tokens and fixed candidate lists, keyed by the context they follow. */
class StubModel implements LanguageModel {
  readonly id = 'stub';
  readonly asked: { context: string; k: number }[] = [];
  constructor(
    private readonly tokens: Record<string, [string, number][]>,
    private readonly lists: Record<string, TokenCandidate[]>,
  ) {}
  async scoreContinuation(_context: string, text: string): Promise<TokenScore[]> {
    let pos = 0;
    return (this.tokens[text] ?? []).map(([t, logprob]) => {
      const s = { text: t, start: pos, end: pos + t.length, logprob };
      pos += t.length;
      return s;
    });
  }
  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    this.asked.push({ context, k });
    return (this.lists[context] ?? []).slice(0, k);
  }
  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    return Array.from({ length: opts.n }, (_, i) => `${prompt}#${i}`);
  }
}

const cands = (...lps: [string, number][]): TokenCandidate[] => lps.map(([text, logprob]) => ({ text, logprob }));

describe('TopNBoundedModel', () => {
  const stub = () =>
    new StubModel(
      { ' ab cd': [[' ab', -1], [' cd', -9]] },
      {
        'X:': cands([' ab', -1], [' zz', -2], [' yy', -3]),
        'X: ab': cands([' ee', -0.5], [' ff', -1.5], [' gg', -2.5]),
      },
    );

  it('defaults to the top 10', () => {
    expect(DEFAULT_TOP_N_OPTIONS.n).toBe(10);
    expect(new TopNBoundedModel(stub()).id).toBe('stub+top10');
  });

  it('keeps a token inside the top N exact and bounds one outside it by the N-th candidate', async () => {
    const inner = stub();
    const m = new TopNBoundedModel(inner, { n: 3 });
    const toks = await m.scoreContinuation('X:', ' ab cd');
    expect(toks[0]).toEqual({ text: ' ab', start: 0, end: 3, logprob: -1 });
    expect(toks[1]).toEqual({ text: ' cd', start: 3, end: 6, logprob: -2.5, upperBound: true });
    // One list per token, after context + the text before the token, of size N.
    expect(inner.asked).toEqual([{ context: 'X:', k: 3 }, { context: 'X: ab', k: 3 }]);
    expect(boundedCount(toks)).toBe(1);
  });

  it('treats a list shorter than N as the whole distribution', async () => {
    const m = new TopNBoundedModel(stub(), { n: 5 });
    const toks = await m.scoreContinuation('X:', ' ab cd');
    expect(toks.map((t) => t.logprob)).toEqual([-1, -9]);
    expect(boundedCount(toks)).toBe(0);
  });

  it('counts a token as inside the list by probability when its text differs', async () => {
    // A merged multi-byte token never appears as a candidate text; it is exact if it is
    // at least as likely as the N-th candidate.
    const inner = new StubModel({ ' ñ': [[' ñ', -2]] }, { 'Y': cands([' a', -1], [' b', -2], [' c', -3]) });
    const toks = await new TopNBoundedModel(inner, { n: 3 }).scoreContinuation('Y', ' ñ');
    expect(toks[0]).toEqual({ text: ' ñ', start: 0, end: 2, logprob: -2 });
  });

  it('rejects a non-positive or fractional n', () => {
    expect(() => new TopNBoundedModel(stub(), { n: 0 })).toThrow(/positive integer/);
    expect(() => new TopNBoundedModel(stub(), { n: 2.5 })).toThrow(/positive integer/);
  });

  it('passes nextTokens and generate through', async () => {
    const m = new TopNBoundedModel(stub(), { n: 1 });
    expect(await m.nextTokens('X:', 3)).toHaveLength(3);
    expect(await m.generate('p', { n: 2, maxTokens: 1, temperature: 0 })).toEqual(['p#0', 'p#1']);
  });

  describe('over the mock model', () => {
    const lm = createMockModel();
    const context = 'Marta llegó tarde al';
    const text = ' mercado y compró una camisa amarilla.';

    it('only ever raises a logprob, and only for tokens outside the top N', async () => {
      const exact = await lm.scoreContinuation(context, text);
      for (const n of [1, 3, 10]) {
        const bounded = await new TopNBoundedModel(lm, { n }).scoreContinuation(context, text);
        expect(bounded.map((t) => t.text)).toEqual(exact.map((t) => t.text));
        bounded.forEach((t, i) => {
          const e = exact[i]!;
          if (t.upperBound) expect(t.logprob).toBeGreaterThan(e.logprob);
          else expect(t.logprob).toBe(e.logprob);
        });
        expect(totalLogprob(bounded)).toBeGreaterThanOrEqual(totalLogprob(exact));
      }
    });

    it('bounds fewer tokens as N grows, and none when N covers the vocabulary', async () => {
      const count = async (n: number) => boundedCount(await new TopNBoundedModel(lm, { n }).scoreContinuation(context, text));
      const c1 = await count(1);
      const c10 = await count(10);
      expect(c1).toBeGreaterThan(0);
      expect(c10).toBeLessThanOrEqual(c1);
      expect(await count(100_000)).toBe(0);
    });
  });
});
