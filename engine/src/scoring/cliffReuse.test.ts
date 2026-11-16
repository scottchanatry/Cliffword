/**
 * scoreCliffAnswer with precomputed alternatives (CreditOptions.alternatives /
 * actualLogprob: what cliffPositions already found at the cliff) and lemma credit
 * (CreditOptions.lemmaWeight / lemmaFloor), with the mock model, scripted models and
 * the stub and real Spanish packs.
 */
import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import { TopNBoundedModel } from '../model/topN';
import type { Analysis, LanguagePack } from '../lang/types';
import type { TokenScore } from '../model/types';
import { createDefaultSpanishPack } from '../packs';
import {
  DEFAULT_CLIFF_OPTIONS,
  DEFAULT_CREDIT_OPTIONS,
  alternativesReusable,
  cliffPositions,
  sameLexemeForm,
  scoreCliffAnswer,
  type CreditOptions,
} from './cliff';
import { CountingModel, TableModel, createStubPack } from './testStubs';
import * as engine from '../index';

const lm = createMockModel();
const stub = createStubPack();
const es = createDefaultSpanishPack();

describe('scoreCliffAnswer with precomputed alternatives', () => {
  const cases: { pack: LanguagePack; context: string; sentence: string; word: number; answers: string[] }[] = [
    { pack: stub, context: '', sentence: 'Marta empezó a leer la nota.', word: 3, answers: ['leer', 'Leer.', 'leerla', 'llorar', 'reír', 'reir', 'lee', 'leyó', 'casa', 'xyzzy', '', '...', 'leer la', 'leer la nota', 'mesa verde'] },
    { pack: es, context: 'Frase en español:\n', sentence: 'Marta llegó tarde al mercado y compró pan.', word: 4, answers: ['mercado', 'mercados', 'cine', 'parque', 'mesa', 'mercado y', 'casa grande', 'Mercado!'] },
    { pack: es, context: 'Frase en español:\nEl perro corrió hacia la', sentence: ' casa de su amigo.', word: 0, answers: ['casa', 'calle', 'puerta', 'verde', 'casas', 'comer'] },
  ];

  it('gives exactly the same results as the search, with no next-word search', async () => {
    for (const c of cases) {
      const [pos] = await cliffPositions(lm, c.pack, c.context, c.sentence, { positions: [c.word] });
      if (!pos) throw new Error('no position');
      const before = c.context + c.sentence.slice(0, pos.segment.start);
      const actual = pos.segment.text;
      for (const answer of c.answers) {
        const searched = await scoreCliffAnswer(lm, c.pack, before, answer, actual);
        const counting = new CountingModel(lm);
        const reused = await scoreCliffAnswer(counting, c.pack, before, answer, actual, { alternatives: pos.alternatives });
        expect(reused, `${c.sentence} | ${answer}`).toEqual(searched);
        // Two calls for a single word outside the list (a score and a boundary), four for several words.
        expect(counting.totalCalls, answer).toBeLessThanOrEqual(4);
        if (searched.rank !== null && !answer.includes(' ')) expect(counting.totalCalls, answer).toBe(0);
      }
    }
  });

  it('cuts the list to k and never shares the caller objects', async () => {
    const [pos] = await cliffPositions(lm, stub, '', 'Marta empezó a leer la nota.', { positions: [3] });
    const alts = pos?.alternatives ?? [];
    expect(alts.length).toBeGreaterThan(3);
    const r = await scoreCliffAnswer(lm, stub, 'Marta empezó a', 'leer', 'leer', { alternatives: alts, k: 3 });
    expect(r.alternatives).toEqual(alts.slice(0, 3));
    expect(r.alternatives[0]).not.toBe(alts[0]);
    expect((await scoreCliffAnswer(lm, stub, 'Marta empezó a', 'leer', 'leer', { alternatives: alts, k: 0 })).alternatives).toEqual([]);
  });

  it('takes the actual words from actualLogprob instead of scoring them again', async () => {
    // The scripted model does not list the actual word, so it would be scored (2 calls).
    const m = new TableModel({ X: [[' llorar', 0.6], [' leer', 0.3], ['.', 0.1]] }, [['.', 1]]);
    const counting = new CountingModel(m);
    const alts = (await scoreCliffAnswer(m, stub, 'X', 'llorar', 'reír')).alternatives;
    const searched = await scoreCliffAnswer(m, stub, 'X', 'reír', 'reír');
    const given = await scoreCliffAnswer(counting, stub, 'X', 'reír', 'reír', { alternatives: alts, actualLogprob: -4.2 });
    expect(counting.totalCalls).toBe(0);
    expect(given).toEqual({ ...searched, logprob: -4.2, prob: Math.exp(-4.2) });
    // Multi-word: the reference comes from actualLogprob (one score and one boundary call for the answer only).
    const multi = new CountingModel(m);
    const ref = await scoreCliffAnswer(m, stub, 'X', 'leer la', 'leer la nota');
    const r = await scoreCliffAnswer(multi, stub, 'X', 'llorar mucho hoy', 'leer la nota', { alternatives: alts, actualLogprob: -9 });
    expect(multi.totalCalls).toBe(2);
    // "llorar mucho hoy": three letters-at--1 tokens per char; mean per word compared with -9 / 3.
    expect(r.credit).toBe('none');
    expect(ref.credit).toBe('partial');
    // A non-finite actualLogprob is ignored (the words are scored).
    const nf = new CountingModel(m);
    await scoreCliffAnswer(nf, stub, 'X', 'reír', 'reír', { alternatives: alts, actualLogprob: Number.NEGATIVE_INFINITY });
    expect(nf.totalCalls).toBe(2);
  });

  it('alternativesReusable: the same k and next-word search', () => {
    expect(alternativesReusable()).toBe(true);
    expect(DEFAULT_CLIFF_OPTIONS.k).toBe(DEFAULT_CREDIT_OPTIONS.k);
    expect(alternativesReusable({ k: 5 }, {})).toBe(false);
    expect(alternativesReusable({ k: 5 }, { k: 5 })).toBe(true);
    expect(alternativesReusable({ nextWord: { beamWidth: 4 } }, {})).toBe(false);
    expect(alternativesReusable({ nextWord: { beamWidth: 4 } }, { nextWord: { beamWidth: 4 } })).toBe(true);
    expect(alternativesReusable({ nextWord: { onModelCall: () => undefined } }, {})).toBe(true);
  });
});

/** The stub pack plus pronominal and clitic forms analysed like the real Spanish pack does. */
const V = (lemma: string, features: Analysis['features']): Analysis => ({ lemma, pos: 'VERB', features });
const EXTRA: Record<string, Analysis[]> = {
  reírse: [V('reír', { form: 'inf' })],
  reía: [V('reír', { form: 'fin', mood: 'ind', tense: 'impf', person: '3', number: 's' })],
  acostarse: [V('acostar', { form: 'inf' })],
  acostar: [V('acostar', { form: 'inf' })],
};
const lemmaPack: LanguagePack = { ...stub, analyze: (n) => EXTRA[n] ?? stub.analyze(n) };

/** nextTokens from a table; scoreContinuation gives the whole text one token with a set logprob. */
function scripted(next: Record<string, Array<[string, number]>>, scores: Record<string, number>, bounded = false): TableModel {
  const tokens: Record<string, TokenScore[]> = {};
  for (const [k, lp] of Object.entries(scores)) {
    const text = k.split('|')[1] as string;
    tokens[k] = [{ text, start: 0, end: text.length, logprob: lp, ...(bounded ? { upperBound: true } : {}) }];
  }
  return new TableModel(next, [['.', 1]], tokens);
}

describe('lemma credit (the same inflection of the same lexeme as a likely alternative)', () => {
  const next = { X: [[' llorar', 0.4], [' reírse', 0.3], [' gritar', 0.1], ['.', 0.2]] as Array<[string, number]> };
  const run = (answer: string, lp: number, opts: Partial<CreditOptions> = {}, bounded = false) =>
    scoreCliffAnswer(scripted(next, { [`X| ${answer}`]: lp }, bounded), lemmaPack, 'X', answer, 'llorar', opts);

  it('sameLexemeForm: same lemma, part of speech and features; not another inflection', () => {
    expect(sameLexemeForm(lemmaPack, 'reír', 'reírse')).toBe(true);
    expect(sameLexemeForm(lemmaPack, 'leer', 'leerla')).toBe(true);
    expect(sameLexemeForm(lemmaPack, 'reía', 'reírse')).toBe(false);
    expect(sameLexemeForm(lemmaPack, 'lee', 'leer')).toBe(false);
    expect(sameLexemeForm(lemmaPack, 'xyzzy', 'reírse')).toBe(false);
    expect(sameLexemeForm(es, 'reír', 'reírse')).toBe(true);
    expect(sameLexemeForm(es, 'leía', 'leerla')).toBe(false);
    expect(sameLexemeForm(es, 'cansada', 'cansado')).toBe(false);
  });

  it('credits reír through reírse at lemmaWeight x P(reírse), naming the alternative', async () => {
    // P(reír) = 1e-3: plausible on its own; 0.5 x 0.3 = 0.15 reaches fullFloor.
    const r = await run('reír', Math.log(1e-3), { lemmaWeight: 0.5, lemmaFloor: 1e-5 });
    expect(r).toMatchObject({ credit: 'full', reason: 'likely', lemmaMatch: { word: 'reírse' } });
    expect(r.lemmaMatch?.prob).toBeCloseTo(0.3, 12);
    expect(r.prob).toBeCloseTo(1e-3, 12);
    // Below every floor on its own, it is still lifted (to plausible at weight 0.001).
    const low = await run('reír', Math.log(2e-5), { lemmaWeight: 0.001, lemmaFloor: 1e-5 });
    expect(low).toMatchObject({ credit: 'partial', reason: 'plausible', lemmaMatch: { word: 'reírse' } });
  });

  it('needs the answer itself at or above lemmaFloor: a verb without the pronoun it needs is not credited', async () => {
    const n2 = { X: [[' acostarse', 0.6], ['.', 0.4]] as Array<[string, number]> };
    const m = scripted(n2, { 'X| acostar': Math.log(1e-7) });
    const res = await scoreCliffAnswer(m, lemmaPack, 'X', 'acostar', 'dormir', { lemmaWeight: 1, lemmaFloor: 1e-5 });
    expect(res).toMatchObject({ credit: 'none', reason: 'unlikely' });
    expect(res.lemmaMatch).toBeUndefined();
  });

  it('never applies to another inflection (keeps form credit), to a bounded answer, or at weight 0', async () => {
    const form = await scoreCliffAnswer(scripted(next, { 'X| reía': Math.log(1e-6) }), lemmaPack, 'X', 'reía', 'reírse', { lemmaWeight: 1, lemmaFloor: 1e-7 });
    expect(form).toMatchObject({ credit: 'partial', reason: 'form' });
    expect(form.lemmaMatch).toBeUndefined();
    const bounded = await run('reír', Math.log(1e-3), { lemmaWeight: 1, lemmaFloor: 1e-5 }, true);
    expect(bounded.bounded).toBe(true);
    expect(bounded.lemmaMatch).toBeUndefined();
    expect(bounded.credit).toBe('none');
    const off = await run('reír', Math.log(1e-3), { lemmaWeight: 0 });
    expect(off).toMatchObject({ credit: 'partial', reason: 'plausible' });
    expect(off.lemmaMatch).toBeUndefined();
  });

  it('never lowers credit and leaves likely answers alone', async () => {
    const likely = await run('gritar', Math.log(0.1), { lemmaWeight: 1 });
    expect(likely).toMatchObject({ credit: 'full', reason: 'likely' });
    expect(likely.lemmaMatch).toBeUndefined();
    // A tiny weight that would give less than the answer's own credit is ignored.
    const own = await run('reír', Math.log(0.06), { lemmaWeight: 1e-9 });
    expect(own).toMatchObject({ credit: 'full', reason: 'likely' });
    expect(own.lemmaMatch).toBeUndefined();
  });

  it('through TopNBoundedModel over the mock, lemma credit never rests on a bound', async () => {
    const device = new TopNBoundedModel(lm, { n: 3 });
    for (const a of ['reír', 'leer', 'lee', 'xyzzy']) {
      const r = await scoreCliffAnswer(device, lemmaPack, 'Marta empezó a', a, 'leer', { lemmaWeight: 1, lemmaFloor: 1e-9 });
      if (r.bounded) expect(r.lemmaMatch, a).toBeUndefined();
    }
  });
});

describe('public API', () => {
  it('exports boundedWords, anchorFormOf and the new scoring helpers from src/index.ts', () => {
    for (const f of [engine.boundedWords, engine.anchorFormOf, engine.alternativesReusable, engine.sameLexemeForm]) expect(typeof f).toBe('function');
    expect(engine.DEFAULT_CREDIT_OPTIONS.lemmaWeight).toBeGreaterThan(0);
    expect(engine.DEFAULT_CREDIT_OPTIONS.lemmaFloor).toBeGreaterThan(0);
  });
});
