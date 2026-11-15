import { describe, expect, it } from 'vitest';
import type { InsertRule, SwapRule } from '../lang/types';
import { GENDER_RULE, PERSONAL_A_INSERT_RULE, SER_ESTAR_RULE, SPANISH_RULES } from '../lang/es/rules';
import { createMockModel } from '../model/mock';
import { TopNBoundedModel } from '../model/topN';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';
import { totalLogprob } from '../model/types';
import { DEFAULT_JUDGE_OPTIONS, decideVerdict, judgeSentence, sharedPrefixEnd } from './judge';
import type { Judgement } from './judge';
import { createTestPack, testSegment } from './testPack';

const mock = createMockModel();
const pack = createTestPack({ rules: SPANISH_RULES });

/** Records every scoreContinuation call. */
class RecordingModel implements LanguageModel {
  readonly id: string;
  readonly calls: Array<{ context: string; text: string }> = [];
  constructor(private readonly inner: LanguageModel) {
    this.id = `rec:${inner.id}`;
  }
  scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    this.calls.push({ context, text });
    return this.inner.scoreContinuation(context, text);
  }
  nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    return this.inner.nextTokens(context, k);
  }
  generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    return this.inner.generate(prompt, opts);
  }
}

/**
 * Context-free word model: one token per word (leading whitespace attached, punctuation
 * its own token), logprob from a table by lowercased word, `fallback` otherwise.
 */
class WordTableModel implements LanguageModel {
  readonly id = 'word-table';
  constructor(
    private readonly table: Record<string, number>,
    private readonly fallback = -5,
  ) {}
  async scoreContinuation(_context: string, text: string): Promise<TokenScore[]> {
    const out: TokenScore[] = [];
    const re = /\s*(?:[\p{L}\p{M}'’]+|\S)|\s+$/gu;
    for (const m of text.matchAll(re)) {
      const t = m[0];
      const start = m.index ?? 0;
      const key = t.trim().toLowerCase();
      out.push({ text: t, start, end: start + t.length, logprob: key ? (this.table[key] ?? this.fallback) : 0 });
    }
    return out;
  }
  async nextTokens(): Promise<TokenCandidate[]> {
    return [];
  }
  async generate(): Promise<string[]> {
    return [];
  }
}

/** Returns the whole text as a single token, so no token boundary falls inside it. */
class OneTokenModel implements LanguageModel {
  readonly id = 'one-token';
  calls = 0;
  async scoreContinuation(_context: string, text: string): Promise<TokenScore[]> {
    this.calls++;
    if (!text) return [];
    const words = text.split(/\s+/u).filter(Boolean);
    const lp = -words.reduce((s, w) => s + (w.toLowerCase().startsWith('est') ? 1 : 3), 0);
    return [{ text, start: 0, end: text.length, logprob: lp }];
  }
  async nextTokens(): Promise<TokenCandidate[]> {
    return [];
  }
  async generate(): Promise<string[]> {
    return [];
  }
}

/** Gives every token -Infinity. */
class ZeroProbModel implements LanguageModel {
  readonly id = 'zero';
  async scoreContinuation(_context: string, text: string): Promise<TokenScore[]> {
    return text ? [{ text, start: 0, end: text.length, logprob: -Infinity }] : [];
  }
  async nextTokens(): Promise<TokenCandidate[]> {
    return [];
  }
  async generate(): Promise<string[]> {
    return [];
  }
}

async function fullScore(model: LanguageModel, context: string, text: string): Promise<number> {
  return totalLogprob(await model.scoreContinuation(context, text));
}

describe('judgeSentence with the mock model', () => {
  it('flags "Soy cansado." with ser/estar and suggests "Estoy cansado."', async () => {
    const j = await judgeSentence(mock, pack, '', 'Soy cansado.');
    expect(j.verdict).not.toBe('ok');
    expect(j.verdict).toBe('assert');
    expect(j.explainKey).toBe('es.ser_estar');
    expect(j.best?.text).toBe('Estoy cansado.');
    expect(j.best?.ruleId).toBe('es.ser_estar');
    expect(j.wordIndex).toBe(0);
    expect(j.margin).toBe(j.best?.margin);
    expect(j.margin as number).toBeGreaterThanOrEqual(DEFAULT_JUDGE_OPTIONS.assertMargin);
  });

  it('leaves "Estoy cansado." alone', async () => {
    const j = await judgeSentence(mock, pack, '', 'Estoy cansado.');
    expect(j.verdict).toBe('ok');
    expect(j.explainKey).toBeNull();
    expect(j.wordIndex).toBeNull();
    expect(j.best).not.toBeNull();
    expect(j.margin as number).toBeLessThan(DEFAULT_JUDGE_OPTIONS.hintMargin);
    expect(j.variants.map((v) => v.text)).toContain('Soy cansado.');
  });

  it('preserves capitalization in the suggestion, at the start and mid-sentence', async () => {
    const start = await judgeSentence(mock, pack, '', 'Soy cansado.');
    expect(start.best?.text).toBe('Estoy cansado.');
    expect(start.best?.replacement).toBe('Estoy');
    const mid = await judgeSentence(mock, pack, '', 'Hoy soy contento.');
    expect(mid.verdict).toBe('assert');
    expect(mid.best?.text).toBe('Hoy estoy contento.');
    expect(mid.wordIndex).toBe(1);
  });

  it('flags other rule families the mock knows (por/para, aspect, mood, gender)', async () => {
    const cases: Array<[string, string, string]> = [
      ['Gracias para la comida.', 'es.por_para', 'Gracias por la comida.'],
      ['Ayer comía en casa.', 'es.aspect', 'Ayer comí en casa.'],
      ['Quiero que vienes.', 'es.mood', 'Quiero que vengas.'],
      ['La casa blanco es bonita.', 'es.gender', 'La casa blanca es bonita.'],
    ];
    for (const [text, key, fix] of cases) {
      const j = await judgeSentence(mock, pack, '', text);
      expect(j.verdict, text).toBe('assert');
      expect(j.explainKey, text).toBe(key);
      expect(j.best?.text, text).toBe(fix);
    }
    for (const text of ['Gracias por la comida.', 'Quiero que vengas.']) {
      expect((await judgeSentence(mock, pack, '', text)).verdict, text).toBe('ok');
    }
  });

  it('never edits slang words and accepts a correct street line', async () => {
    const text = "El corillo ya 'tá listo pa' bailar.";
    for (const register of ['neutral', 'street'] as const) {
      const j = await judgeSentence(mock, pack, '', text, { register, maxVariants: 100 });
      expect(j.verdict, register).toBe('ok');
      const slang = testSegment(text).filter((s) => ["'tá", "pa'", 'corillo'].includes(s.norm));
      for (const v of j.variants) {
        for (const s of slang) expect(v.start < s.end && s.start < v.end, `${v.text}`).toBe(false);
      }
    }
  });

  it('skips streetTolerant rules (number) in street register', async () => {
    const text = 'Los libro nuevos.';
    // The trigram mock charges each extra token far more than a real model, so its
    // insert/delete margins need the length bias the real-model default (0) leaves out.
    const mockLength = { lengthAdjustPerToken: 1 };
    const neutral = await judgeSentence(mock, pack, '', text, mockLength);
    expect(neutral.verdict).toBe('assert');
    expect(neutral.explainKey).toBe('es.number');
    expect(neutral.best?.text).toBe('Los libros nuevos.');
    const street = await judgeSentence(mock, pack, '', text, { ...mockLength, register: 'street' });
    expect(street.variants.some((v) => v.explainKey === 'es.number')).toBe(false);
    expect(street.explainKey).not.toBe('es.number');
    expect(street.verdict).not.toBe('assert');
  });

  it('reports variants dropped by the cap and scores only the kept ones', async () => {
    const rec = new RecordingModel(mock);
    const j = await judgeSentence(rec, pack, '', 'La casa blanco es bonita.', { maxVariants: 2 });
    expect(j.variants).toHaveLength(2);
    expect(j.droppedVariants).toBeGreaterThan(0);
    // One full scoring of the original plus one call per variant (original rests come from the full scoring).
    expect(rec.calls).toHaveLength(1 + 2);
  });

  it('handles empty, whitespace and punctuation-only input', async () => {
    const rec = new RecordingModel(mock);
    const empty = await judgeSentence(rec, pack, '', '');
    expect(empty).toEqual<Judgement>({
      verdict: 'ok',
      originalLogprob: 0,
      best: null,
      margin: null,
      variants: [],
      explainKey: null,
      wordIndex: null,
      droppedVariants: 0,
    });
    expect(rec.calls).toHaveLength(0);
    for (const t of ['...', '¡¿?!', '   ']) {
      const j = await judgeSentence(mock, pack, '', t);
      expect(j.verdict).toBe('ok');
      expect(j.variants).toEqual([]);
      expect(Number.isFinite(j.originalLogprob)).toBe(true);
    }
  });

  it('copes with unknown words and missing accents', async () => {
    const unknown = await judgeSentence(mock, pack, '', 'Soy zorblax.');
    expect(Number.isFinite(unknown.originalLogprob)).toBe(true);
    for (const v of unknown.variants) expect(v.wordIndex).toBe(0);
    const accentless = await judgeSentence(mock, pack, '', 'Ella esta cansada.');
    expect(accentless.variants.some((v) => v.ruleId === 'es.ser_estar')).toBe(false);
  });
});

describe('judgeSentence: prefix sharing', () => {
  const sentences = ['Soy cansado.', 'Hoy soy contento.', 'La casa blanco es bonita.', 'Gracias para la comida.', 'Veo Marta.'];
  const contexts = ['', 'Marta llegó tarde al mercado.', 'Marta llegó tarde al mercado. '];

  it('gives margins equal to full-sentence score differences', async () => {
    for (const context of contexts) {
      for (const text of sentences) {
        const j = await judgeSentence(mock, pack, context, text, { maxVariants: 100 });
        const join = context && !/\s$/u.test(context) ? ' ' : '';
        const orig = await fullScore(mock, context, join + text);
        expect(j.originalLogprob).toBeCloseTo(orig, 9);
        expect(j.variants.length).toBeGreaterThan(0);
        for (const v of j.variants) {
          const whole = await fullScore(mock, context, join + v.text);
          expect(v.rawMargin, `${JSON.stringify(context)} ${v.text}`).toBeCloseTo(whole - orig, 9);
          expect(v.logprob).toBeCloseTo(whole, 9);
        }
      }
    }
  });

  it('never re-scores tokens before the edit', async () => {
    const rec = new RecordingModel(mock);
    const context = 'Marta llegó tarde al mercado.';
    const text = 'La casa blanco es bonita.';
    const j = await judgeSentence(rec, pack, context, text, { maxVariants: 100 });
    const [first, ...rest] = rec.calls;
    expect(first).toEqual({ context, text: ' ' + text });
    expect(rest).toHaveLength(j.variants.length);
    const segs = testSegment(text);
    for (const v of j.variants) {
      // The scored text starts at the cut: after the last word that ends before the edit.
      const cut = sharedPrefixEnd(segs, v.start);
      const expected =
        cut === 0
          ? { context, text: ' ' + v.text }
          : { context: `${context} ${text.slice(0, cut)}`, text: v.text.slice(cut) };
      expect(rest, v.text).toContainEqual(expected);
      if (cut > 0) expect(v.text.slice(cut).startsWith(text.slice(0, cut))).toBe(false);
    }
    // At least one variant has a non-empty shared prefix, so the sharing is exercised.
    expect(j.variants.some((v) => sharedPrefixEnd(segs, v.start) > 0)).toBe(true);
  });

  it('matches literal scoreContinuation of both rests at the cut', async () => {
    const text = 'Gracias para la comida.';
    const j = await judgeSentence(mock, pack, '', text, { maxVariants: 100 });
    const segs = testSegment(text);
    for (const v of j.variants) {
      const cut = sharedPrefixEnd(segs, v.start);
      const ctx = text.slice(0, cut);
      const literal = (await fullScore(mock, ctx, v.text.slice(cut))) - (await fullScore(mock, ctx, text.slice(cut)));
      expect(v.rawMargin).toBeCloseTo(literal, 9);
    }
  });

  it('scores the original rest separately (once per cut) when no token boundary falls at the cut', async () => {
    const m = new OneTokenModel();
    const p = createTestPack({ rules: [SER_ESTAR_RULE, GENDER_RULE] });
    const j = await judgeSentence(m, p, '', 'Hoy soy cansado y es alto.', { maxVariants: 100 });
    const cuts = new Set(j.variants.map((v) => sharedPrefixEnd(testSegment('Hoy soy cansado y es alto.'), v.start)));
    expect(m.calls).toBe(1 + cuts.size + j.variants.length);
    const best = j.best;
    expect(best?.ruleId).toBe('es.ser_estar');
    expect(best?.rawMargin).toBeCloseTo(2, 9);
  });
});

describe('judgeSentence: verdicts and options', () => {
  it('turns an assert into a hint or ok as thresholds rise', async () => {
    const base = await judgeSentence(mock, pack, '', 'Soy cansado.');
    const m = base.margin as number;
    const hint = await judgeSentence(mock, pack, '', 'Soy cansado.', { assertMargin: m + 1, hintMargin: m - 1 });
    expect(hint.verdict).toBe('hint');
    expect(hint.explainKey).toBe('es.ser_estar');
    expect(hint.wordIndex).toBe(0);
    const ok = await judgeSentence(mock, pack, '', 'Soy cansado.', { assertMargin: m + 2, hintMargin: m + 1 });
    expect(ok.verdict).toBe('ok');
    expect(ok.explainKey).toBeNull();
    expect(ok.best?.text).toBe('Estoy cansado.');
  });

  it('downgrades an assert to a hint when two different rules nearly tie', async () => {
    const model = new WordTableModel({ soy: -10, estoy: -4, cansado: -10, cansada: -4.5, '.': -1 });
    const p = createTestPack({ rules: [SER_ESTAR_RULE, GENDER_RULE] });
    const opts = { assertMargin: 3, hintMargin: 1, tieMargin: 1 };
    const tied = await judgeSentence(model, p, '', 'Soy cansado.', opts);
    expect(tied.variants.map((v) => [v.text, v.margin])).toEqual([
      ['Estoy cansado.', 6],
      ['Soy cansada.', 5.5],
    ]);
    expect(tied.verdict).toBe('hint');
    expect(tied.explainKey).toBe('es.ser_estar');
    const clear = await judgeSentence(model, p, '', 'Soy cansado.', { ...opts, tieMargin: 0.25 });
    expect(clear.verdict).toBe('assert');
  });

  it('does not downgrade when the runner-up has the same explanation', async () => {
    const twoSwaps: SwapRule[] = [
      { id: 't.one', kind: 'swap', explainKey: 'es.ser_estar', groups: [['soy', 'estoy']] },
      { id: 't.two', kind: 'swap', explainKey: 'es.ser_estar', groups: [['soy', 'estaba']] },
    ];
    const model = new WordTableModel({ soy: -10, estoy: -4, estaba: -4.2 });
    const j = await judgeSentence(model, createTestPack({ rules: twoSwaps }), '', 'Soy cansado.', {
      assertMargin: 3,
      tieMargin: 1,
    });
    expect(j.verdict).toBe('assert');
  });

  it('applies the per-token length adjustment to inserts and deletes only', async () => {
    const model = new WordTableModel({ veo: -2, marta: -3, a: -1.5, '.': -1 });
    const p = createTestPack({ rules: [PERSONAL_A_INSERT_RULE, SER_ESTAR_RULE] });
    const none = await judgeSentence(model, p, '', 'Veo Marta.', { lengthAdjustPerToken: 0 });
    const v0 = none.variants[0];
    expect(v0?.kind).toBe('insert');
    expect(v0?.rawMargin).toBeCloseTo(-1.5, 9);
    expect(v0?.tokenDelta).toBe(1);
    expect(v0?.margin).toBeCloseTo(-1.5, 9);
    const adj = await judgeSentence(model, p, '', 'Veo Marta.', { lengthAdjustPerToken: 2, hintMargin: 0.4, assertMargin: 3 });
    expect(adj.variants[0]?.margin).toBeCloseTo(0.5, 9);
    expect(adj.verdict).toBe('hint');
    expect(adj.explainKey).toBe('es.personal_a');
    expect(adj.wordIndex).toBe(1);

    // A swap of different token length is not adjusted.
    const twoTok: SwapRule = { id: 't.split', kind: 'swap', explainKey: 'es.ser_estar', groups: [['veo', 'yo veo']] };
    const sw = await judgeSentence(model, createTestPack({ rules: [twoTok] }), '', 'Veo Marta.', { lengthAdjustPerToken: 2 });
    expect(sw.variants[0]?.tokenDelta).toBe(1);
    expect(sw.variants[0]?.margin).toBe(sw.variants[0]?.rawMargin);
  });

  it('penalizes deletes by the same per-token amount', async () => {
    const delA = SPANISH_RULES.filter((r) => r.id === 'es.personal_a.delete');
    const model = new WordTableModel({ veo: -2, marta: -3, a: -1.5, '.': -1 });
    const j = await judgeSentence(model, createTestPack({ rules: delA }), '', 'Veo a Marta.', { lengthAdjustPerToken: 1 });
    expect(j.variants[0]?.rawMargin).toBeCloseTo(1.5, 9);
    expect(j.variants[0]?.tokenDelta).toBe(-1);
    expect(j.variants[0]?.margin).toBeCloseTo(0.5, 9);
  });

  it('sorts variants by margin, keeping generation order on ties', async () => {
    const ins: InsertRule[] = ['el', 'un'].map((w) => ({
      id: `t.${w}`,
      kind: 'insert',
      explainKey: 'es.article',
      word: w,
      beforePos: ['NOUN'],
      afterPos: ['VERB'],
    }));
    const model = new WordTableModel({}, -2);
    const j = await judgeSentence(model, createTestPack({ rules: ins }), '', 'Compro pan.');
    expect(j.variants.map((v) => v.ruleId)).toEqual(['t.el', 't.un']);
    expect(j.variants[0]?.margin).toBe(j.variants[1]?.margin);
  });

  it('never produces NaN margins when the model gives zero probability', async () => {
    const j = await judgeSentence(new ZeroProbModel(), pack, '', 'Soy cansado.');
    expect(j.originalLogprob).toBe(DEFAULT_JUDGE_OPTIONS.logprobFloor); // clamped
    for (const v of j.variants) expect(Number.isNaN(v.margin)).toBe(false);
    expect(j.verdict).toBe('ok');
  });

  it('clamps token logprobs, so one impossible token after the edit cannot hide an error (alg-5)', async () => {
    /** The mock, except that the token " pronto" is impossible. */
    class ImpossibleWord extends RecordingModel {
      override async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
        const toks = await super.scoreContinuation(context, text);
        return toks.map((t) => (t.text === ' pronto' ? { ...t, logprob: -Infinity } : t));
      }
    }
    const plain = await judgeSentence(mock, pack, '', 'Ella es cansada pronto.');
    expect(plain.verdict).toBe('assert');
    const j = await judgeSentence(new ImpossibleWord(mock), pack, '', 'Ella es cansada pronto.');
    expect(Number.isFinite(j.originalLogprob)).toBe(true);
    expect(j.verdict).toBe('assert');
    expect(j.best?.text).toBe('Ella está cansada pronto.');
    expect(j.margin).toBeGreaterThanOrEqual(DEFAULT_JUDGE_OPTIONS.assertMargin);
    for (const v of j.variants) expect(Number.isFinite(v.margin), v.text).toBe(true);
  });

  it('joins context and sentence with contextSeparator only when needed', async () => {
    const rec = new RecordingModel(mock);
    await judgeSentence(rec, pack, 'Marta llegó.', 'Soy cansado.', { maxVariants: 0 });
    await judgeSentence(rec, pack, 'Marta llegó. ', 'Soy cansado.', { maxVariants: 0 });
    await judgeSentence(rec, pack, 'Marta llegó.', 'Soy cansado.', { maxVariants: 0, contextSeparator: '' });
    await judgeSentence(rec, pack, '', 'Soy cansado.', { maxVariants: 0 });
    expect(rec.calls.map((c) => c.text)).toEqual([' Soy cansado.', 'Soy cansado.', 'Soy cansado.', 'Soy cansado.']);
  });
});

describe('decideVerdict', () => {
  const o = { assertMargin: 3, hintMargin: 1, tieMargin: 1 };
  const v = (margin: number, explainKey = 'a') => ({ margin, explainKey });

  it('maps the best margin onto ok, hint and assert', () => {
    expect(decideVerdict([], o)).toBe('ok');
    expect(decideVerdict([v(0.99)], o)).toBe('ok');
    expect(decideVerdict([v(1)], o)).toBe('hint');
    expect(decideVerdict([v(2.99)], o)).toBe('hint');
    expect(decideVerdict([v(3)], o)).toBe('assert');
    expect(decideVerdict([v(-Infinity)], o)).toBe('ok');
  });

  it('downgrades a near tie between different explanations', () => {
    expect(decideVerdict([v(5, 'a'), v(4, 'b')], o)).toBe('hint');
    expect(decideVerdict([v(5, 'a'), v(3.9, 'b')], o)).toBe('assert');
    expect(decideVerdict([v(5, 'a'), v(4.5, 'a')], o)).toBe('assert');
    // The nearest rival with a different explanation decides, even behind a same-key runner-up.
    expect(decideVerdict([v(5, 'a'), v(4.8, 'a'), v(4.2, 'b')], o)).toBe('hint');
  });
});

describe('sharedPrefixEnd', () => {
  it('cuts after the last word that ends before the edit', () => {
    const segs = testSegment('¿Hoy soy contento?');
    expect(sharedPrefixEnd(segs, 0)).toBe(0);
    expect(sharedPrefixEnd(segs, 1)).toBe(0);
    expect(sharedPrefixEnd(segs, 5)).toBe(4);
    expect(sharedPrefixEnd(segs, 4)).toBe(4);
    expect(sharedPrefixEnd(segs, 9)).toBe(8);
    expect(sharedPrefixEnd([], 3)).toBe(0);
  });
});

/**
 * Marks the tokens of some words (trimmed, lowercased) as upper bounds, the way a top-N
 * runtime reports a token outside its list. The logprob itself is left unchanged, so a
 * test can tell the verdict cap apart from a change of margin.
 */
class BoundMarkingModel implements LanguageModel {
  readonly id: string;
  constructor(
    private readonly inner: LanguageModel,
    private readonly words: readonly string[],
  ) {
    this.id = `bound:${inner.id}`;
  }
  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    const toks = await this.inner.scoreContinuation(context, text);
    return toks.map((t) => (this.words.includes(t.text.trim().toLowerCase()) ? { ...t, upperBound: true } : t));
  }
  nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    return this.inner.nextTokens(context, k);
  }
  generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    return this.inner.generate(prompt, opts);
  }
}

describe('judgeSentence: bounded scores (top-N runtime)', () => {
  const table = new WordTableModel({ hoy: -3, soy: -10, estoy: -2, contento: -2, contenta: -6, cansado: -2, cansada: -6, '.': -1 });
  const serEstar = createTestPack({ rules: [SER_ESTAR_RULE] });

  it('never asserts when the variant side of the margin is bounded, and says so', async () => {
    const exact = await judgeSentence(table, serEstar, '', 'Soy cansado.');
    expect(exact.verdict).toBe('assert');
    expect('bounded' in exact).toBe(false);
    expect(exact.variants.every((v) => !('bounded' in v))).toBe(true);
    const j = await judgeSentence(new BoundMarkingModel(table, ['estoy']), serEstar, '', 'Soy cansado.');
    // Same margin, same suggestion and explanation; only the verdict is capped.
    expect(j.margin).toBe(exact.margin);
    expect(j.verdict).toBe('hint');
    expect(j.bounded).toBe(true);
    expect(j.best?.bounded).toBe(true);
    expect(j.best?.text).toBe('Estoy cansado.');
    expect(j.explainKey).toBe('es.ser_estar');
    expect(j.wordIndex).toBe(0);
  });

  it('never asserts when the original side of the margin is bounded', async () => {
    const j = await judgeSentence(new BoundMarkingModel(table, ['soy']), serEstar, '', 'Soy cansado.');
    expect(j.margin as number).toBeGreaterThanOrEqual(DEFAULT_JUDGE_OPTIONS.assertMargin);
    expect(j.verdict).toBe('hint');
    expect(j.bounded).toBe(true);
  });

  it('counts a bound after the edit (both rests) but not one in the shared prefix', async () => {
    const after = await judgeSentence(new BoundMarkingModel(table, ['cansado']), serEstar, '', 'Soy cansado.');
    expect(after.verdict).toBe('hint');
    expect(after.bounded).toBe(true);
    // "Hoy" comes before the cut, so neither compared rest contains it.
    const exact = await judgeSentence(table, serEstar, '', 'Hoy soy contento.');
    const prefix = await judgeSentence(new BoundMarkingModel(table, ['hoy']), serEstar, '', 'Hoy soy contento.');
    expect(exact.verdict).toBe('assert');
    expect(prefix).toEqual(exact);
    expect('bounded' in prefix).toBe(false);
  });

  it('keeps hints and oks as they are, and reports the bound on an ok', async () => {
    const hintOpts = { assertMargin: 100, hintMargin: 1 };
    const hint = await judgeSentence(new BoundMarkingModel(table, ['estoy']), serEstar, '', 'Soy cansado.', hintOpts);
    expect(hint.verdict).toBe('hint');
    const ok = await judgeSentence(new BoundMarkingModel(table, ['soy']), serEstar, '', 'Estoy cansado.');
    expect(ok.verdict).toBe('ok');
    expect(ok.bounded).toBe(true);
    expect(ok.explainKey).toBeNull();
  });

  it('lets an exact best variant assert past a bounded variant far behind it', async () => {
    const both = createTestPack({ rules: [SER_ESTAR_RULE, GENDER_RULE] });
    const j = await judgeSentence(new BoundMarkingModel(table, ['cansada']), both, '', 'Soy cansado.');
    expect(j.best?.text).toBe('Estoy cansado.');
    expect(j.best?.bounded).toBeUndefined();
    expect(j.variants.find((v) => v.text === 'Soy cansada.')?.bounded).toBe(true);
    expect(j.verdict).toBe('assert');
    expect('bounded' in j).toBe(false);
  });

  it('over the mock through TopNBoundedModel: no assert rests on a bound, and a huge N changes nothing', async () => {
    const sentences = ['Soy cansado.', 'Estoy cansado.', 'Hoy soy contento.', 'Gracias para la comida.', 'La casa blanco es bonita.', 'Quiero que vienes.'];
    let capped = 0;
    for (const n of [1, 3, 10]) {
      const device = new TopNBoundedModel(mock, { n });
      for (const text of sentences) {
        const exact = await judgeSentence(mock, pack, '', text);
        const j = await judgeSentence(device, pack, '', text);
        expect(j.variants.map((v) => v.text).sort(), text).toEqual(exact.variants.map((v) => v.text).sort());
        if (j.best?.bounded) {
          expect(j.verdict, `${n} ${text}`).not.toBe('assert');
          expect(j.bounded).toBe(true);
          if (exact.verdict === 'assert') capped++;
        } else {
          expect(j.bounded).toBeUndefined();
        }
        if (j.verdict === 'assert') {
          // Asserted margins are measured: identical to the exact ones.
          expect(j.margin as number).toBeCloseTo(exact.variants.find((v) => v.text === j.best?.text)!.margin, 9);
        }
      }
    }
    // The mock's error words are surprising, so top-N bounds cap most asserts.
    expect(capped).toBeGreaterThan(0);
    const huge = new TopNBoundedModel(mock, { n: 100_000 });
    for (const text of sentences) expect(await judgeSentence(huge, pack, '', text)).toEqual(await judgeSentence(mock, pack, '', text));
  });
});

describe('decideVerdict: bounded margins', () => {
  const o = { assertMargin: 3, hintMargin: 1, tieMargin: 1 };
  const v = (margin: number, explainKey = 'a', bounded?: boolean) => (bounded ? { margin, explainKey, bounded } : { margin, explainKey });

  it('caps a bounded best variant at hint', () => {
    expect(decideVerdict([v(50, 'a', true)], o)).toBe('hint');
    expect(decideVerdict([v(3, 'a', true)], o)).toBe('hint');
    expect(decideVerdict([v(1, 'a', true)], o)).toBe('hint');
    expect(decideVerdict([v(0.99, 'a', true)], o)).toBe('ok');
  });

  it('counts a bounded runner-up in the tie rule, and ignores one far behind', () => {
    expect(decideVerdict([v(5, 'a'), v(4.5, 'b', true)], o)).toBe('hint');
    expect(decideVerdict([v(5, 'a'), v(1, 'b', true)], o)).toBe('assert');
    expect(decideVerdict([v(5, 'a'), v(4.5, 'a', true)], o)).toBe('assert');
  });
});
