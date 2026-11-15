import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import {
  DEFAULT_CLIFF_OPTIONS,
  DEFAULT_CREDIT_OPTIONS,
  caseForPosition,
  cliffPositions,
  knownAsWritten,
  scoreCliffAnswer,
} from './cliff';
import type { Analysis, LanguagePack } from '../lang/types';
import type { ModelCallInfo } from './nextWord';
import { CountingModel, TableModel, createStubPack } from './testStubs';

const lm = createMockModel();
const pack = createStubPack();
const SENTENCE = 'Marta empezó a leer la nota.';

describe('cliffPositions', () => {
  it('analyses a requested position with one scoring call', async () => {
    const m = new CountingModel(lm);
    const [pos, ...rest] = await cliffPositions(m, pack, '', SENTENCE, { positions: [3] });
    expect(rest).toHaveLength(0);
    expect(pos!.wordIndex).toBe(3);
    expect(pos!.segment.text).toBe('leer');
    expect(pos!.alternatives.map((a) => a.norm)).toEqual(expect.arrayContaining(['leer', 'leerla', 'llorar', 'reír']));
    expect(pos!.plausibleCount).toBeGreaterThanOrEqual(4);
    expect(m.scoreCalls).toBe(1);
    // nextWords ran only at the cliff (plus the boundary call after the actual word).
    expect(m.nextContexts.every((c) => c.startsWith('Marta empezó a'))).toBe(true);
    expect(m.nextContexts[0]).toBe('Marta empezó a');
    expect(m.nextContexts).toContain('Marta empezó a leer');
  });

  it('puts the actual word on the same scale as the alternatives', async () => {
    const [pos] = await cliffPositions(lm, pack, '', SENTENCE, { positions: [3] });
    const alt = pos!.alternatives.find((a) => a.norm === 'leer')!;
    expect(pos!.actualLogprob).toBeCloseTo(alt.logprob, 9);
  });

  it('without actualBoundary uses the aligned token logprob only', async () => {
    const without = new CountingModel(lm);
    const [pos] = await cliffPositions(without, pack, '', SENTENCE, { positions: [3], actualBoundary: false });
    const tokens = await lm.scoreContinuation('', SENTENCE);
    expect(pos!.actualLogprob).toBeCloseTo(tokens.find((t) => t.text === ' leer')!.logprob, 12);
    const withB = new CountingModel(lm);
    await cliffPositions(withB, pack, '', SENTENCE, { positions: [3] });
    expect(withB.nextCalls).toBe(without.nextCalls + 1);
  });

  it('analyses every word when no positions are given', async () => {
    const all = await cliffPositions(lm, pack, '', SENTENCE);
    expect(all.map((p) => p.segment.text)).toEqual(['Marta', 'empezó', 'a', 'leer', 'la', 'nota']);
    expect(all.map((p) => p.wordIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    // "a" after "empezó" is nearly certain: one plausible option. "leer" has several.
    expect(all[2]!.plausibleCount).toBe(1);
    expect(all[3]!.plausibleCount).toBeGreaterThan(all[2]!.plausibleCount);
    for (const p of all) {
      expect(p.actualLogprob).toBeLessThanOrEqual(0);
      expect(p.alternatives.length).toBeLessThanOrEqual(DEFAULT_CLIFF_OPTIONS.k);
    }
  });

  it('ignores invalid and duplicate positions and sorts the rest', async () => {
    const r = await cliffPositions(lm, pack, '', SENTENCE, { positions: [5, -1, 3, 3, 99, 1.5] });
    expect(r.map((p) => p.wordIndex)).toEqual([3, 5]);
  });

  it('makes no model call when nothing is requested or there are no words', async () => {
    const m = new CountingModel(lm);
    expect(await cliffPositions(m, pack, '', SENTENCE, { positions: [] })).toEqual([]);
    expect(await cliffPositions(m, pack, '', ' ¿?...')).toEqual([]);
    expect(await cliffPositions(m, pack, '', '')).toEqual([]);
    expect(m.totalCalls).toBe(0);
  });

  it('continues a story context and strips the space before the cliff', async () => {
    const m = new CountingModel(lm);
    const ctx = 'Marta llegó tarde al mercado.';
    const r = await cliffPositions(m, pack, ctx, ' Marta compró manzanas y naranjas.', { positions: [1] });
    expect(r[0]!.segment.text).toBe('compró');
    expect(m.nextContexts[0]).toBe(`${ctx} Marta`);
    // The mock restarts at each sentence; "compró" is one of the verbs seen after Marta.
    expect(r[0]!.alternatives.map((a) => a.norm)).toContain('compró');
  });

  it('counts plausible alternatives against the floor', async () => {
    const loose = await cliffPositions(lm, pack, '', SENTENCE, { positions: [3], plausibleFloor: 0 });
    const strict = await cliffPositions(lm, pack, '', SENTENCE, { positions: [3], plausibleFloor: 0.1 });
    expect(loose[0]!.plausibleCount).toBe(loose[0]!.alternatives.length);
    expect(strict[0]!.plausibleCount).toBe(1);
  });

  it('reports every model call to onModelCall', async () => {
    const m = new CountingModel(lm);
    const calls: ModelCallInfo[] = [];
    await cliffPositions(m, pack, '', SENTENCE, { positions: [3, 5], onModelCall: (c) => calls.push(c) });
    expect(calls).toHaveLength(m.totalCalls);
    expect(calls.filter((c) => c.method === 'scoreContinuation')).toHaveLength(1);
  });

  it('handles accents and clipped forms in the sentence', async () => {
    const r = await cliffPositions(lm, pack, '', "El corillo ya 'tá listo pa' bailar.", { positions: [3, 5] });
    expect(r.map((p) => p.segment.text)).toEqual(["'tá", "pa'"]);
    expect(r[0]!.alternatives.map((a) => a.norm)).toContain("'tá");
    expect(r[1]!.alternatives.map((a) => a.norm)).toContain("pa'");
  });
});

describe('scoreCliffAnswer: single words', () => {
  const ctx = 'Marta empezó a';
  const score = (answer: string, actual = 'leer', opts = {}) => scoreCliffAnswer(lm, pack, ctx, answer, actual, opts);

  it('gives full credit to the actual word', async () => {
    const r = await score('leer');
    expect(r.credit).toBe('full');
    expect(r.reason).toBe('actual');
    expect(r.rank).not.toBeNull();
    expect(r.answer).toBe('leer');
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.prob).toBeCloseTo(Math.exp(r.logprob), 12);
  });

  it('gives full credit to another natural answer (leerla, llorar)', async () => {
    for (const a of ['leerla', 'llorar', 'reír']) {
      const r = await score(a);
      expect(r.credit, a).toBe('full');
      expect(r.reason, a).toBe('likely');
      expect(r.rank, a).not.toBeNull();
    }
  });

  it('gives form credit to a wrong form of the same verb', async () => {
    for (const a of ['lee', 'leyó', 'leo']) {
      const r = await score(a);
      expect(r.credit, a).toBe('partial');
      expect(r.reason, a).toBe('form');
      expect(r.rank, a).toBeNull();
    }
  });

  it('gives no credit to a nonsense word', async () => {
    const r = await score('xyzzy');
    expect(r.credit).toBe('none');
    expect(r.reason).toBe('unlikely');
    expect(r.rank).toBeNull();
    expect(r.prob).toBeLessThan(DEFAULT_CREDIT_OPTIONS.partialFloor);
  });

  it('gives partial credit to a possible but unusual answer', async () => {
    const r = await score('casa');
    expect(r.credit).toBe('partial');
    expect(r.reason).toBe('plausible');
  });

  it('ignores case, surrounding space and trailing punctuation for the actual word', async () => {
    for (const a of ['Leer.', '  leer!! ', 'LEER', 'leer…']) {
      const r = await score(a);
      expect(r.reason, a).toBe('actual');
      expect(r.answer).toBe(a);
    }
  });

  it('accepts the actual word with missing accents', async () => {
    const r = await score('reir', 'reír');
    expect(r.credit).toBe('full');
    expect(r.reason).toBe('actual');
    const capital = await score('Reir.', 'reír');
    expect(capital.reason).toBe('actual');
  });

  it('restores a missing accent on an unknown form from the alternatives', async () => {
    const restored = await score('reir', 'leer');
    expect(restored.reason).toBe('likely');
    expect(restored.rank).not.toBeNull();
    const asTyped = await score('reir', 'leer', { restoreAccents: false });
    expect(asTyped.credit).toBe('none');
    expect(asTyped.rank).toBeNull();
  });

  it('restores the accent when the pack found the form only by ignoring accents', async () => {
    // A pack like the real Spanish one: analyze("reir") returns the analysis of "reír",
    // whose inflection is spelled differently, so "reir" is not a form as written.
    const fuzzy: LanguagePack = {
      ...pack,
      analyze: (norm: string): Analysis[] =>
        norm === 'reir' ? [{ lemma: 'reír', pos: 'VERB', features: { form: 'inf' } }] : pack.analyze(norm),
      inflect: (lemma, features) => (lemma === 'reír' && features.form === 'inf' ? 'reír' : undefined),
    };
    expect(knownAsWritten(fuzzy, 'reir')).toBe(false);
    expect(knownAsWritten(fuzzy, 'reír')).toBe(true); // stub analysis, no inflection: known
    expect(knownAsWritten(fuzzy, 'xyz')).toBe(false);
    const r = await scoreCliffAnswer(lm, fuzzy, 'Marta empezó a', 'reir', 'leer');
    expect(r.reason).toBe('likely');
    expect(r.scored).toBe('reír');
    // alg-7: also when the accented form is not among the alternatives (k = 1 keeps
    // only the top one), the pack's own form is scored.
    const outside = await scoreCliffAnswer(lm, fuzzy, 'Marta empezó a', 'reir', 'leer', { k: 1 });
    expect(outside.alternatives.map((a) => a.norm)).not.toContain('reír');
    expect(outside.scored).toBe('reír');
    expect(outside.credit).not.toBe('none');
    const exact = await scoreCliffAnswer(lm, fuzzy, 'Marta empezó a', 'reír', 'leer', { k: 1 });
    expect(outside.logprob).toBeCloseTo(exact.logprob, 9);
  });

  it('reports the scored text', async () => {
    expect((await score('  Leer. ')).scored).toBe('leer');
    expect((await score('casa', 'leer')).scored).toBe('casa');
    expect((await score('...', 'leer')).scored).toBe('');
  });

  it('does not take a known form for an accented one (esta is not está)', async () => {
    // esta (this) is a known form, so it is scored as typed, not as está.
    const r = await scoreCliffAnswer(lm, pack, 'Ella', 'esta', 'está');
    expect(r.reason).toBe('actual'); // accent-insensitive actual check still applies
    const other = await scoreCliffAnswer(lm, pack, 'Ella', 'esta', 'es');
    const exact = await scoreCliffAnswer(lm, pack, 'Ella', 'está', 'es');
    expect(other.logprob).not.toBeCloseTo(exact.logprob, 3);
  });

  it('does not reward a word prefix, thanks to the boundary mass', async () => {
    const r = await score('cans');
    expect(r.credit).toBe('none');
    const noBoundary = await score('cans', 'leer', { includeBoundary: false });
    expect(noBoundary.credit).not.toBe('none');
  });

  it('treats a context with a trailing space like one without', async () => {
    const a = await scoreCliffAnswer(lm, pack, 'Marta empezó a ', 'casa', 'leer');
    const b = await scoreCliffAnswer(lm, pack, 'Marta empezó a', 'casa', 'leer');
    expect(a.logprob).toBeCloseTo(b.logprob, 12);
    expect(a.credit).toBe(b.credit);
  });

  it('scores an answer that is not among the alternatives with a leading space', async () => {
    const m = new CountingModel(lm);
    const r = await scoreCliffAnswer(m, pack, ctx, 'xyzzy', 'leer');
    const direct = await lm.scoreContinuation(ctx, ' xyzzy');
    expect(r.logprob).toBeLessThanOrEqual(direct[0]!.logprob);
    expect(m.scoreCalls).toBe(1);
  });

  it('takes the probability of a listed answer from the alternatives', async () => {
    const m = new CountingModel(lm);
    const r = await scoreCliffAnswer(m, pack, ctx, 'llorar', 'leer');
    const alt = r.alternatives.find((a) => a.norm === 'llorar')!;
    expect(r.logprob).toBe(alt.logprob);
    expect(r.rank).toBe(r.alternatives.indexOf(alt) + 1);
    expect(m.scoreCalls).toBe(0);
  });

  it('gives no credit to empty or punctuation-only answers', async () => {
    for (const a of ['', '   ', '¿?', '...']) {
      const r = await score(a);
      expect(r.credit, a).toBe('none');
      expect(r.reason, a).toBe('unlikely');
      expect(r.logprob).toBe(DEFAULT_CREDIT_OPTIONS.logprobFloor);
      expect(r.alternatives.length).toBeGreaterThan(0);
    }
  });

  it('is case-insensitive at a sentence start', async () => {
    const r = await scoreCliffAnswer(lm, pack, 'Marta llegó tarde al mercado.', 'buscó', 'Buscó');
    expect(r.reason).toBe('actual');
  });

  it("handles street forms with apostrophes ('tá, pa')", async () => {
    const ta = await scoreCliffAnswer(lm, pack, 'El corillo ya', "'tá", "'tá");
    expect(ta.reason).toBe('actual');
    const pa = await scoreCliffAnswer(lm, pack, "El corillo ya 'tá listo", "pa'", "pa'");
    expect(pa.reason).toBe('actual');
    expect(pa.rank).toBe(1);
  });

  it('respects the thresholds in the options', async () => {
    const strict = await score('casa', 'leer', { partialFloor: 0.5 });
    expect(strict.credit).toBe('none');
    const lenient = await score('casa', 'leer', { fullFloor: 0.01 });
    expect(lenient.credit).toBe('full');
    const ratio = await score('casa', 'leer', { fullRatio: 0.1 });
    expect(ratio.reason).toBe('likely');
  });

  it('reports every model call to onModelCall', async () => {
    const m = new CountingModel(lm);
    const calls: ModelCallInfo[] = [];
    await scoreCliffAnswer(m, pack, ctx, 'xyzzy', 'leer', { onModelCall: (c) => calls.push(c) });
    expect(calls).toHaveLength(m.totalCalls);
  });
});

describe('scoreCliffAnswer: several words', () => {
  const ctx = 'Marta empezó a';
  const actual = 'leer la nota';

  it('gives full credit to the actual words, ignoring case and punctuation', async () => {
    for (const a of ['leer la nota', 'Leer la nota.', 'leer  la  nota']) {
      const r = await scoreCliffAnswer(lm, pack, ctx, a, actual);
      expect(r.credit, a).toBe('full');
      expect(r.reason, a).toBe('actual');
      expect(r.rank).toBeNull();
    }
  });

  it('gives full credit to an equally natural continuation', async () => {
    const r = await scoreCliffAnswer(lm, pack, ctx, 'leerla en voz alta', actual);
    expect(r.credit).toBe('full');
    expect(r.reason).toBe('likely');
  });

  it('gives form credit when every word matches but a form is wrong', async () => {
    const r = await scoreCliffAnswer(lm, pack, ctx, 'lee la nota', actual);
    expect(r.credit).toBe('partial');
    expect(r.reason).toBe('form');
  });

  it('gives no credit to nonsense', async () => {
    const r = await scoreCliffAnswer(lm, pack, ctx, 'xyzzy blorp', actual);
    expect(r.credit).toBe('none');
    expect(r.reason).toBe('unlikely');
  });

  it('compares a one-word answer to a multi-word cliff per word and still ranks it', async () => {
    const r = await scoreCliffAnswer(lm, pack, ctx, 'llorar', actual);
    expect(r.credit).not.toBe('none');
    expect(r.rank).not.toBeNull();
  });

  it('never gives full credit to an answer shorter than the cliff (alg-1)', async () => {
    // "leer" alone is the most predictable word of "leer la nota"; per-word means would
    // rate it above the whole continuation.
    for (const a of ['leer', 'llorar', 'leer la']) {
      const r = await scoreCliffAnswer(lm, pack, ctx, a, actual);
      expect(r.credit, a).toBe('partial');
      expect(r.reason, a).toBe('plausible');
    }
    const junk = await scoreCliffAnswer(lm, pack, ctx, 'xyzzy', actual);
    expect(junk.credit).toBe('none');
  });

  it('compares a shorter answer with the same number of actual words, in at most two scoring calls', async () => {
    const m = new CountingModel(lm);
    await scoreCliffAnswer(m, pack, ctx, 'llorar', actual);
    expect(m.scoreCalls).toBe(2);
    const same = new CountingModel(lm);
    await scoreCliffAnswer(same, pack, ctx, 'leer', actual);
    expect(same.scoreCalls).toBe(1); // the answer is the first actual word: scored once
  });

  it('uses the margins in the options', async () => {
    const tight = await scoreCliffAnswer(lm, pack, ctx, 'leerla en voz alta', actual, {
      multiFullMargin: -10,
      multiPartialMargin: -10,
    });
    expect(tight.credit).toBe('none');
  });

  it('uses the top alternative as reference when the actual text is empty', async () => {
    const good = await scoreCliffAnswer(lm, pack, ctx, 'leer la nota', '');
    expect(good.credit).toBe('full');
    const bad = await scoreCliffAnswer(lm, pack, ctx, 'xyzzy blorp', '...');
    expect(bad.credit).toBe('none');
  });
});

describe('caseForPosition', () => {
  it('capitalizes at a sentence start', () => {
    expect(caseForPosition(pack, '', 'leer')).toBe('Leer');
    expect(caseForPosition(pack, 'Llegó tarde.', '¿qué')).toBe('¿Qué');
  });

  it('lowercases a capitalized known word mid-sentence', () => {
    expect(caseForPosition(pack, 'Marta empezó a', 'Llorar')).toBe('llorar');
    expect(caseForPosition(pack, 'Marta empezó a', 'Leer la nota')).toBe('leer la nota');
  });

  it('keeps proper nouns, ambiguous names and unknown words', () => {
    expect(caseForPosition(pack, 'Vio a', 'Marta')).toBe('Marta');
    expect(caseForPosition(pack, 'Vio a', 'Rosa')).toBe('Rosa');
    expect(caseForPosition(pack, 'Vio a', 'Xyzzy')).toBe('Xyzzy');
    expect(caseForPosition(pack, 'Vio a', 'leer')).toBe('leer');
    expect(caseForPosition(pack, 'Vio a', '...')).toBe('...');
  });
});

describe('scoreCliffAnswer with a scripted model', () => {
  it('uses the accent-restored form for the form check (leia -> leía)', async () => {
    const m = new TableModel({ X: [[' leer', 0.9], [' leía', 0.002], ['.', 0.098]] }, [['.', 1]]);
    const r = await scoreCliffAnswer(m, pack, 'X', 'leia', 'leer');
    expect(r.rank).toBe(2);
    expect(r.credit).toBe('partial');
    expect(r.reason).toBe('form');
  });

  it('uses only the floors when there are no alternatives', async () => {
    const m = new TableModel({}, []);
    const r = await scoreCliffAnswer(m, pack, 'X', 'buenas', 'adiós', { includeBoundary: false });
    expect(r.alternatives).toEqual([]);
    // Six letters at -1 each (scripted fallback) plus the leading space: e^-7 < partialFloor.
    expect(r.logprob).toBeCloseTo(-7, 12);
    expect(r.credit).toBe('none');
    const short = await scoreCliffAnswer(m, pack, 'X', 'sí', 'adiós', { includeBoundary: false });
    // e^-3 = 0.0498, just under fullFloor 0.05 but above partialFloor.
    expect(short.reason).toBe('plausible');
  });

  it('scores with a leading space after a word and none after opening punctuation', async () => {
    const seen: string[] = [];
    const m = new TableModel({}, [['.', 1]]);
    const spy = {
      id: 'spy',
      scoreContinuation: (c: string, t: string) => {
        seen.push(`${c}|${t}`);
        return m.scoreContinuation(c, t);
      },
      nextTokens: (c: string, k: number) => m.nextTokens(c, k),
      generate: () => m.generate(),
    };
    await scoreCliffAnswer(spy, pack, 'Ella dijo', 'hola', 'adiós');
    await scoreCliffAnswer(spy, pack, 'Ella dijo: ¿', 'qué', 'cómo');
    await scoreCliffAnswer(spy, pack, 'Ella dijo: ', 'Hola', 'adiós');
    // "Hola" is unknown to the stub pack, so its capital is kept mid-sentence.
    expect(seen).toEqual(['Ella dijo| hola', 'Ella dijo: ¿|qué', 'Ella dijo:| Hola']);
  });
});
