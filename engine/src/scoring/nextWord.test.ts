import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import {
  DEFAULT_NEXT_WORD_OPTIONS,
  boundaryMass,
  classifySpacedToken,
  nextWords,
  nextWordsDetailed,
  splitWordRun,
  wordBoundaryMass,
  type ModelCallInfo,
} from './nextWord';
import { CountingModel, TableModel, createStubPack } from './testStubs';

const lm = createMockModel();
const pack = createStubPack();

describe('classifySpacedToken', () => {
  const cases: Array<[string, string, string]> = [
    ['Estoy', ' muy', 'start'],
    ['Estoy muy cans', 'ado', 'continue'],
    ['Estoy', '.', 'boundary'],
    ['Estoy', '', 'boundary'],
    ['Estoy', ' ', 'boundary'],
    ['Estoy', ' ¿', 'boundary'],
    ['Estoy', ' 3', 'boundary'],
    ['Estoy', '3', 'boundary'],
    ['', 'Hola', 'start'],
    ['¿', 'Qué', 'start'],
    ['dijo ', 'hola', 'start'],
    ['ya', " 'tá", 'start'],
    ['dijo ', "'tá", 'start'],
    ['dijo ', "'", 'boundary'],
    ['pa', "'", 'continue'],
    ["pa'", 'la', 'continue'],
    ['caf', '́', 'continue'],
    ['Estoy', '\n', 'boundary'],
    ['Estoy', '\nHola', 'start'],
  ];
  it.each(cases)('after %j, %j is %s', (prev, tok, role) => {
    expect(classifySpacedToken(prev, tok)).toBe(role);
  });
});

describe('splitWordRun', () => {
  it('separates the word characters from trailing punctuation', () => {
    expect(splitWordRun('hola')).toEqual({ run: 'hola', closed: false });
    expect(splitWordRun('hola,')).toEqual({ run: 'hola', closed: true });
    expect(splitWordRun("pa'")).toEqual({ run: "pa'", closed: false });
    expect(splitWordRun('ado.')).toEqual({ run: 'ado', closed: true });
    expect(splitWordRun('.')).toEqual({ run: '', closed: true });
    expect(splitWordRun('')).toEqual({ run: '', closed: false });
  });
});

describe('boundaryMass', () => {
  const cands = [
    { text: 'ado', logprob: Math.log(0.6) },
    { text: ' la', logprob: Math.log(0.2) },
    { text: '.', logprob: Math.log(0.1) },
    { text: ' x', logprob: -Infinity },
  ];
  it('sums the seen tokens that do not continue the word', () => {
    expect(boundaryMass(cands, 'Estoy cans')).toBeCloseTo(0.3, 12);
  });

  it('can use the complement of the continuation mass instead', () => {
    expect(boundaryMass(cands, 'Estoy cans', classifySpacedToken, 'complement')).toBeCloseTo(0.4, 12);
  });

  it('is 0 for no candidates (seen) and clamped to [0, 1]', () => {
    expect(boundaryMass([], 'a')).toBe(0);
    expect(boundaryMass([], 'a', classifySpacedToken, 'complement')).toBe(1);
    expect(boundaryMass([{ text: '.', logprob: 0 }, { text: ',', logprob: 0 }], 'a')).toBe(1);
  });

  it('wordBoundaryMass makes one call and agrees', async () => {
    const m = new CountingModel(lm);
    const mass = await wordBoundaryMass(m, 'Estoy muy cansado');
    expect(m.nextCalls).toBe(1);
    const cands2 = await lm.nextTokens('Estoy muy cansado', DEFAULT_NEXT_WORD_OPTIONS.topTokens);
    expect(mass).toBeCloseTo(boundaryMass(cands2, 'Estoy muy cansado'), 12);
    expect(await wordBoundaryMass(lm, 'Estoy muy cans')).toBe(0);
  });
});

describe('nextWords with the mock model', () => {
  it('ranks cansado first after "Estoy muy" and merges its pieces', async () => {
    const words = await nextWords(lm, 'Estoy muy');
    expect(words[0]!.word).toBe('cansado');
    expect(words[0]!.norm).toBe('cansado');
    expect(words.some((w) => w.word === 'cans')).toBe(false);
    expect(words.map((w) => w.word)).toEqual(expect.arrayContaining(['inteligente', 'simpático']));
  });

  it('computes P(word) as product of piece probabilities times boundary mass', async () => {
    const words = await nextWords(lm, 'Estoy muy');
    const first = (await lm.nextTokens('Estoy muy', 20)).find((t) => t.text === ' cans')!;
    const second = (await lm.nextTokens('Estoy muy cans', 20)).find((t) => t.text === 'ado')!;
    const b = boundaryMass(await lm.nextTokens('Estoy muy cansado', 20), 'Estoy muy cansado');
    const expected = Math.exp(first.logprob + second.logprob) * b;
    expect(words[0]!.prob).toBeCloseTo(expected, 10);
    expect(words[0]!.logprob).toBeCloseTo(Math.log(expected), 10);
    // Truncation: the boundary mass only sees the top tokens, so it is below 1 here.
    expect(b).toBeLessThan(1);
    expect(b).toBeGreaterThan(0.8);
  });

  it('offers the story verbs after "Marta empezó a"', async () => {
    const words = await nextWords(lm, 'Marta empezó a', { normalize: pack.normalize });
    const norms = words.map((w) => w.norm);
    expect(norms).toEqual(expect.arrayContaining(['leer', 'leerla', 'llorar', 'reír']));
    for (const w of ['leer', 'leerla', 'llorar', 'reír']) {
      expect(words.find((x) => x.norm === w)!.prob).toBeGreaterThan(0.03);
    }
    // janguear is two pieces (" jang" + "uear") and must come back whole.
    expect(norms).toContain('janguear');
    expect(norms).not.toContain('jang');
  });

  it('returns sorted, normalized, valid probabilities', async () => {
    const words = await nextWords(lm, 'Ella está');
    expect(words.length).toBe(DEFAULT_NEXT_WORD_OPTIONS.k);
    for (let i = 1; i < words.length; i++) expect(words[i - 1]!.prob).toBeGreaterThanOrEqual(words[i]!.prob);
    for (const w of words) {
      expect(w.prob).toBeGreaterThan(0);
      expect(w.prob).toBeLessThanOrEqual(1);
      expect(w.logprob).toBeCloseTo(Math.log(w.prob), 12);
      expect(w.norm).toBe(w.word.toLowerCase());
      expect(w.word).not.toMatch(/^\s/u);
    }
    const total = words.reduce((s, w) => s + w.prob, 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it('works at the start of a text', async () => {
    const words = await nextWords(lm, '');
    expect(words.map((w) => w.norm)).toEqual(expect.arrayContaining(['marta', 'estoy']));
  });

  it('ignores pieces that would continue a word left open in the context', async () => {
    expect(await nextWords(lm, 'Estoy muy cans')).toEqual([]);
  });

  it('is deterministic', async () => {
    expect(await nextWords(lm, 'Marta empezó a')).toEqual(await nextWords(lm, 'Marta empezó a'));
  });

  it('honours k and minProb', async () => {
    expect(await nextWords(lm, 'Estoy muy', { k: 2 })).toHaveLength(2);
    const strict = await nextWords(lm, 'Estoy muy', { minProb: 0.1 });
    expect(strict.map((w) => w.word)).toEqual(['cansado']);
    expect(await nextWords(lm, 'Estoy muy', { k: 0 })).toEqual([]);
  });

  it('cannot complete long words when maxPieces is 1', async () => {
    const words = await nextWords(lm, 'Estoy muy', { maxPieces: 1 });
    expect(words.map((w) => w.word)).not.toContain('cansado');
    expect(words.map((w) => w.word)).not.toContain('cans');
  });

  it('gives higher (upper-bound) probabilities with the complement estimate', async () => {
    const seen = await nextWords(lm, 'Estoy muy');
    const comp = await nextWords(lm, 'Estoy muy', { boundaryEstimate: 'complement' });
    expect(comp[0]!.word).toBe('cansado');
    expect(comp[0]!.prob).toBeGreaterThan(seen[0]!.prob);
  });
});

describe('model call accounting', () => {
  it('reports every call in modelCalls and to onModelCall', async () => {
    const m = new CountingModel(lm);
    const seen: ModelCallInfo[] = [];
    const r = await nextWordsDetailed(m, 'Estoy muy', { onModelCall: (c) => seen.push(c) });
    expect(r.modelCalls).toBe(m.nextCalls);
    expect(seen).toHaveLength(m.nextCalls);
    expect(seen.every((c) => c.method === 'nextTokens')).toBe(true);
    expect(seen[0]!.context).toBe('Estoy muy');
    expect(m.scoreCalls).toBe(0);
    expect(r.budgetExhausted).toBe(false);
    expect(r.firstStepMass).toBeGreaterThan(0.5);
    expect(r.firstStepMass).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('stays within 1 + beamWidth * maxPieces calls', async () => {
    const o = { beamWidth: 3, maxPieces: 2 };
    const r = await nextWordsDetailed(lm, 'Marta empezó a', o);
    expect(r.modelCalls).toBeLessThanOrEqual(1 + o.beamWidth * o.maxPieces);
  });

  it('stops at maxModelCalls and says so', async () => {
    const m = new CountingModel(lm);
    const r = await nextWordsDetailed(m, 'Marta empezó a', { maxModelCalls: 3 });
    expect(m.nextCalls).toBe(3);
    expect(r.modelCalls).toBe(3);
    expect(r.budgetExhausted).toBe(true);
    expect(r.words.length).toBeLessThanOrEqual(2);
  });

  it('makes no call with a zero budget', async () => {
    const m = new CountingModel(lm);
    const r = await nextWordsDetailed(m, 'Marta empezó a', { maxModelCalls: 0 });
    expect(r).toEqual({ words: [], modelCalls: 0, budgetExhausted: true, firstStepMass: 0 });
    expect(m.totalCalls).toBe(0);
  });
});

describe('nextWords with scripted tokens', () => {
  it('merges entries with the same normalized form and keeps the most likely surface', async () => {
    const m = new TableModel({ X: [[' Leer', 0.2], [' leer', 0.3], ['.', 0.5]] });
    const words = await nextWords(m, 'X');
    expect(words).toHaveLength(1);
    expect(words[0]!.word).toBe('leer');
    expect(words[0]!.norm).toBe('leer');
    expect(words[0]!.prob).toBeCloseTo(0.5, 12);
  });

  it('uses the given normalize function as the merge key', async () => {
    const m = new TableModel({ X: [[' reír', 0.3], [' reir', 0.1], ['.', 0.6]] });
    const plain = await nextWords(m, 'X');
    expect(plain).toHaveLength(2);
    const folded = await nextWords(m, 'X', { normalize: (w) => w.normalize('NFD').replace(/\p{M}/gu, '') });
    expect(folded).toHaveLength(1);
    expect(folded[0]!.word).toBe('reír');
    expect(folded[0]!.prob).toBeCloseTo(0.4, 12);
  });

  it('adds up different tokenizations of the same word', async () => {
    const m = new TableModel({
      X: [[' cans', 0.3], [' cansado', 0.2], ['.', 0.5]],
      'X cans': [['ado', 0.5], ['ada', 0.5]],
    });
    const words = await nextWords(m, 'X');
    const cansado = words.find((w) => w.word === 'cansado')!;
    expect(cansado.prob).toBeCloseTo(0.2 + 0.3 * 0.5, 12);
    expect(words.find((w) => w.word === 'cansada')!.prob).toBeCloseTo(0.15, 12);
  });

  it('completes a word inside a token that ends in punctuation without a boundary call', async () => {
    const m = new CountingModel(new TableModel({ X: [[' hola,', 0.4], ['.', 0.6]] }));
    const r = await nextWordsDetailed(m, 'X');
    expect(r.words.map((w) => [w.word, w.prob])).toEqual([['hola', 0.4]]);
    expect(r.modelCalls).toBe(1);
  });

  it('expands a separate whitespace token into the word after it', async () => {
    const m = new TableModel({
      X: [[' ', 0.5], ['.', 0.5]],
      'X ': [['hola', 0.6], ['adiós', 0.4]],
    });
    const words = await nextWords(m, 'X');
    expect(words.map((w) => w.word)).toEqual(['hola', 'adiós']);
    expect(words[0]!.prob).toBeCloseTo(0.3, 12);
    expect(words[1]!.prob).toBeCloseTo(0.2, 12);
  });

  it("treats a following apostrophe as part of the word (pa vs pa')", async () => {
    const m = new TableModel({
      Vamos: [[' pa', 0.5], ['.', 0.5]],
      'Vamos pa': [["'", 0.6], [' la', 0.4]],
      "Vamos pa'": [[' la', 1]],
    });
    const words = await nextWords(m, 'Vamos', { normalize: pack.normalize });
    expect(words.map((w) => [w.word, Number(w.prob.toFixed(6))])).toEqual([
      ["pa'", 0.3],
      ['pa', 0.2],
    ]);
  });

  it("starts words with a leading apostrophe ('tá)", async () => {
    const m = new TableModel({ ya: [[" 'tá", 0.7], [' listo', 0.3]] });
    const words = await nextWords(m, 'ya');
    expect(words.map((w) => w.word)).toEqual(["'tá", 'listo']);
  });

  it('skips punctuation, numbers and zero-probability tokens', async () => {
    const m = new TableModel({ X: [[' ¿', 0.3], [' 3', 0.3], [' a', 0], [' sí', 0.4]] });
    const words = await nextWords(m, 'X');
    expect(words.map((w) => w.word)).toEqual(['sí']);
  });

  it('keeps only beamWidth partial words per depth', async () => {
    const m = new CountingModel(
      new TableModel({ X: [[' a', 0.4], [' b', 0.3], [' c', 0.2], [' d', 0.1]] }),
    );
    const r = await nextWordsDetailed(m, 'X', { beamWidth: 2 });
    expect(r.words.map((w) => w.word)).toEqual(['a', 'b']);
    expect(r.modelCalls).toBe(3);
  });

  it('accepts a custom token classifier (e.g. for scripts without spaces)', async () => {
    // Every token is its own word: classifier says every non-empty token starts a word.
    const m = new TableModel({ 私は: [['学生', 0.6], ['先生', 0.4]] }, [['です', 1]]);
    const words = await nextWords(m, '私は', { classify: (_p, t) => (t ? 'start' : 'boundary') });
    expect(words.map((w) => w.word)).toEqual(['学生', '先生']);
    expect(words[0]!.prob).toBeCloseTo(0.6, 12);
  });
});
