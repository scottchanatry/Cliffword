import { describe, expect, it } from 'vitest';
import { createMockModel, mockTokenize } from './mock';
import { totalLogprob } from './types';

describe('mockTokenize', () => {
  it('covers the text exactly and splits long words', () => {
    const text = '¿Estoy cansado? Sí, muy cansado.';
    const pieces = mockTokenize(text);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(pieces.map((p) => p.text)).toContain(' cans');
    expect(pieces.map((p) => p.text)).toContain('ado');
  });

  it('keeps apostrophes inside clipped forms', () => {
    const pieces = mockTokenize("ya 'tá listo pa' bailar");
    expect(pieces.map((p) => p.text)).toEqual(['ya', " 'tá", ' listo', " pa'", ' bailar']);
  });
});

describe('MockLanguageModel', () => {
  const lm = createMockModel();

  it('returns tokens that concatenate to the scored text', async () => {
    const text = ' muy cansado.';
    const toks = await lm.scoreContinuation('Estoy', text);
    expect(toks.map((t) => t.text).join('')).toBe(text);
    for (const t of toks) {
      expect(text.slice(t.start, t.end)).toBe(t.text);
      expect(t.logprob).toBeLessThanOrEqual(0);
    }
  });

  it('prefers estar over ser with cansado', async () => {
    const good = totalLogprob(await lm.scoreContinuation('', 'Estoy cansado.'));
    const bad = totalLogprob(await lm.scoreContinuation('', 'Soy cansado.'));
    expect(good).toBeGreaterThan(bad);
  });

  it('gives a normalized next-token distribution', async () => {
    const all = await lm.nextTokens('Marta empezó a', 10_000);
    const mass = all.reduce((s, t) => s + Math.exp(t.logprob), 0);
    expect(mass).toBeGreaterThan(0.99);
    expect(mass).toBeLessThan(1.01);
  });

  it('agrees between nextTokens and scoreContinuation', async () => {
    const ctx = 'Marta empezó a';
    const next = await lm.nextTokens(ctx, 5);
    const top = next[0]!;
    const scored = await lm.scoreContinuation(ctx, top.text);
    expect(scored[0]!.logprob).toBeCloseTo(top.logprob, 6);
  });

  it('handles a context that ends inside a word', async () => {
    const next = await lm.nextTokens('Estoy muy cans', 3);
    expect(next[0]!.text).toBe('ado');
  });

  it('generates reproducibly with a seed', async () => {
    const a = await lm.generate('Marta', { n: 2, maxTokens: 12, temperature: 0.8, stop: ['.'], seed: 7 });
    const b = await lm.generate('Marta', { n: 2, maxTokens: 12, temperature: 0.8, stop: ['.'], seed: 7 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });
});
