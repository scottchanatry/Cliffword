/**
 * Session helpers: settings, rates, priors, hints, answer location, canned credit, landing
 * data and sentence views. Real Spanish and en-es packs; no model.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { LearnerModel } from '../learner/model';
import { PlacementTracker } from '../learner/placement';
import { lexemeKey } from '../learner/types';
import type { CliffResult, NextWord } from '../scoring/types';
import { DEFAULT_SESSION_SETTINGS, buildPrior, effectiveRate, hintFor, looseText, resolveSessionSettings, sameWords, seedFor, shuffled, rng } from './common';
import { arrangeOptions, buildOutcome, cannedResult, chooseDistractors, cliffUi, locateAnswer, optionResult } from './cliff';
import { buildSentenceView, sentenceWords } from './view';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);

const alt = (word: string, prob: number): NextWord => ({ word, norm: word, prob, logprob: Math.log(prob) });

describe('settings', () => {
  it('defaults follow the brief: neutral, explicit on, text per word, native answers allowed', () => {
    expect(DEFAULT_SESSION_SETTINGS).toEqual({
      register: 'neutral',
      regions: [],
      showExplicit: true,
      textMode: 'auto',
      speechRateBias: 1,
      nativeAnswersAllowed: true,
    });
  });

  it('merges valid values and ignores invalid ones', () => {
    const s = resolveSessionSettings({ register: 'street', regions: ['PR', ''], textMode: 'all_tiles', speechRateBias: 0.9, showExplicit: false });
    expect(s).toEqual({ register: 'street', regions: ['PR'], showExplicit: false, textMode: 'all_tiles', speechRateBias: 0.9, nativeAnswersAllowed: true });
    const bad = resolveSessionSettings({ register: 'loud' as never, textMode: 'some' as never, speechRateBias: -1 }, s);
    expect(bad).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('keeps the rate inside the difficulty limits, and lets "slower" go down to the floor', () => {
    expect(effectiveRate(0.7, 1, 1, 0.5)).toBeCloseTo(0.7);
    expect(effectiveRate(0.7, 2, 1, 0.5)).toBeCloseTo(1.1); // capped at 110%
    expect(effectiveRate(0.7, 0.5, 1, 0.5)).toBeCloseTo(0.6); // never below 60% from the bias
    expect(effectiveRate(0.7, 1, 0.8, 0.5)).toBeCloseTo(0.56);
    expect(effectiveRate(0.7, 1, 0.8 ** 4, 0.5)).toBeCloseTo(0.5);
    expect(effectiveRate(Number.NaN, Number.NaN, 1, 0.5)).toBeCloseTo(1);
  });
});

describe('priors', () => {
  it('builds the brandNew and placement priors from their specs', () => {
    const brand = buildPrior({ kind: 'brandNew' }, pack, pair);
    expect(brand?.('es:hospital', 'meaning')).toBeCloseTo(0.5);
    expect(brand?.('es:mesa', 'meaning')).toBeCloseTo(0.002);
    expect(buildPrior({ kind: 'default' }, pack, pair)).toBeUndefined();
    const t = new PlacementTracker();
    for (const [rank, ok] of [[50, true], [100, true], [400, true], [800, false], [1500, false], [900, false]] as const) t.record(`r${rank}`, rank, ok);
    const placed = buildPrior({ kind: 'placement', placement: t.snapshot() }, pack, pair);
    expect(placed?.('es:ser', 'meaning')).toBeGreaterThan(0.9);
    expect(placed?.('es:sombrero', 'meaning')).toBeLessThan(placed?.('es:casa', 'meaning') ?? 0);
  });
});

describe('seeded helpers', () => {
  it('are deterministic and spread', () => {
    expect(seedFor(7, 0)).toBe(seedFor(7, 0));
    expect(seedFor(7, 0)).not.toBe(seedFor(7, 1));
    expect(seedFor(7, 0)).not.toBe(seedFor(8, 0));
    expect(shuffled([1, 2, 3, 4, 5], rng(3))).toEqual(shuffled([1, 2, 3, 4, 5], rng(3)));
    expect([...shuffled([1, 2, 3, 4, 5], rng(3))].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('text helpers', () => {
  it('compares words loosely through the segmenter', () => {
    expect(looseText(pack, "¡Pa' la PLAYA!")).toBe('pa la playa');
    expect(sameWords(pack, 'reir', 'reír.')).toBe(true);
    expect(sameWords(pack, '', '')).toBe(false);
  });

  it('gives the first sound of a word as a hint', () => {
    expect(hintFor('puesto')).toBe('pu');
    expect(hintFor('chico')).toBe('ch');
    expect(hintFor('sol')).toBe('s');
    expect(hintFor('猫')).toBe('猫');
  });
});

describe('answer location and canned credit', () => {
  it('finds the answer, never at the first word, the last occurrence first', () => {
    expect(locateAnswer(pack, 'Marta es una artista.', 'artista')).toEqual({ wordIndex: 3, length: 1, start: 13, end: 20 });
    expect(locateAnswer(pack, 'Marta es una artista.', 'Marta')).toBeNull();
    expect(locateAnswer(pack, 'El gato y el gato.', 'el gato')?.wordIndex).toBe(3);
    expect(locateAnswer(pack, 'Ella toca el piano.', 'nada')).toBeNull();
  });

  it('credits the actual words, listed answers and the same lemma without a model', () => {
    expect(cannedResult(pack, 'Artista', 'artista')).toMatchObject({ credit: 'full', reason: 'actual' });
    expect(cannedResult(pack, 'especial', 'importante', ['especial'])).toMatchObject({ credit: 'full', reason: 'likely' });
    expect(cannedResult(pack, 'fantástico', 'fantástica')).toMatchObject({ credit: 'partial', reason: 'form' });
    expect(cannedResult(pack, 'elefante', 'parque')).toMatchObject({ credit: 'none', reason: 'unlikely' });
    expect(cannedResult(pack, '...', 'parque')).toMatchObject({ credit: 'none', scored: '' });
  });

  it('turns a picked option into a result', () => {
    expect(optionResult('casa', true, 0.3, [])).toMatchObject({ credit: 'full', reason: 'actual', prob: 0.3 });
    expect(optionResult('mesa', false, 0.001, [])).toMatchObject({ credit: 'none', reason: 'unlikely' });
    expect(optionResult('mesa', false, null, []).prob).toBe(0);
  });

  it('arranges options in a seeded order and names the prompt per rung', () => {
    const a = arrangeOptions('casa', ['mesa', 'azul'], rng(1));
    expect(a.options.map((o) => o.text).sort()).toEqual(['azul', 'casa', 'mesa']);
    expect(a.options[a.naturalIndex]?.text).toBe('casa');
    expect(cliffUi('options', undefined)).toEqual({ key: 'cliff.pickOne' });
    expect(cliffUi('hint', 'pu')).toEqual({ key: 'cliff.hint', params: { sound: 'pu' } });
    expect(cliffUi('free', 'pu')).toEqual({ key: 'cliff.prompt' });
  });

  it('chooses distractors without a model from the pool, never the answer or its lemma', async () => {
    const ds = await chooseDistractors(null, pack, {
      context: 'x',
      actual: 'casa',
      alternatives: [alt('mesa', 0.2)],
      pool: ['casas', 'mesa', 'perro', 'azul', 'gato'],
      random: rng(1),
    });
    expect(ds.map((d) => d.text)).toEqual(['perro', 'azul']);
  });
});

describe('landing data', () => {
  const result = (over: Partial<CliffResult>): CliffResult => ({
    answer: 'llorar',
    scored: 'llorar',
    logprob: Math.log(0.31),
    prob: 0.31,
    rank: 2,
    credit: 'full',
    reason: 'likely',
    alternatives: [alt('leer', 0.4), alt('llorar', 0.31), alt('reír', 0.1), alt('comer', 0.01)],
    ...over,
  });

  it('places the answer, the actual words and the alternatives on a log line, with the notes of B2', () => {
    const o = buildOutcome(result({}), { pack, expected: 'leer', rung: 'free', scoredBy: 'model', actualProb: 0.4 });
    expect(o.headline).toEqual({ key: 'landing.likely' });
    expect(o.timesIn100).toBe(31);
    expect(o.notes).toEqual([
      { key: 'landing.timesIn100', params: { n: 31 } },
      { key: 'landing.justAsNatural', params: { word: 'leer' } },
    ]);
    expect(o.points.map((p) => p.text)).toEqual(['comer', 'reír', 'llorar', 'leer']);
    expect(o.points.find((p) => p.answer)?.text).toBe('llorar');
    expect(o.points.find((p) => p.actual)?.text).toBe('leer');
    expect(o.points[o.points.length - 1]?.x).toBe(1);
    for (const p of o.points) expect(p.x).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });

  it('names another natural word when the answer was the actual one, and nothing for a miss', () => {
    const actual = buildOutcome(result({ answer: 'leer', scored: 'leer', prob: 0.4, reason: 'actual' }), { pack, expected: 'leer', rung: 'free', scoredBy: 'model', actualProb: 0.4 });
    expect(actual.notes[1]).toEqual({ key: 'landing.justAsNatural', params: { word: 'llorar' } });
    const miss = buildOutcome(result({ answer: 'mesa', scored: 'mesa', prob: 0.0001, credit: 'none', reason: 'unlikely' }), { pack, expected: 'leer', rung: 'free', scoredBy: 'model', actualProb: 0.4 });
    expect(miss.headline).toEqual({ key: 'landing.unlikely' });
    expect(miss.notes).toEqual([]);
    expect(miss.points[0]).toMatchObject({ text: 'mesa', x: 0 });
  });

  it('has no probabilities in canned mode', () => {
    const o = buildOutcome(cannedResult(pack, 'artista', 'artista'), { pack, expected: 'artista', rung: 'options', scoredBy: 'canned', actualProb: null });
    expect(o).toMatchObject({ credit: 'full', reason: 'actual', prob: null, timesIn100: null, points: [], notes: [], scoredBy: 'canned' });
  });
});

describe('sentence views', () => {
  it('attaches punctuation to its word and keys words like story selection', () => {
    const ws = sentenceWords(pack, '¿Y tú? Buscó al señor, pero su puesto estaba cerrado.', { register: 'neutral', regions: [] });
    expect(ws.map((w) => `${w.lead}${w.text}${w.trail}${w.spaceAfter ? '_' : ''}`).join('')).toBe('¿Y_tú?_Buscó_al_señor,_pero_su_puesto_estaba_cerrado.');
    expect(ws.find((w) => w.text === 'puesto')?.key).toBe('es:puesto');
    expect(ws.find((w) => w.text === 'Buscó')?.key).toBe('es:buscar');
  });

  it('flags slang (also-standard forms only in street register) and explicit slang', () => {
    const street = sentenceWords(pack, "Dale, el corillo 'tá listo y el pana es un pendejo.", { register: 'street', regions: [] });
    expect(street.filter((w) => w.slang).map((w) => w.text)).toEqual(['Dale', 'corillo', "'tá", 'pana', 'pendejo']);
    expect(street.filter((w) => w.explicit).map((w) => w.text)).toEqual(['pendejo']);
    const neutral = sentenceWords(pack, 'Dale, el corillo está listo.', { register: 'neutral', regions: [] });
    expect(neutral.filter((w) => w.slang).map((w) => w.text)).toEqual(['corillo']);
  });

  it('shows text or tiles per word, gaps and future words around a cliff, and glosses new words', () => {
    const learner = new LearnerModel({ prior: (key, skill) => (key === 'es:marta' ? (skill === 'sound' ? 0.5 : 0.9) : key === 'es:ser' ? (skill === 'sound' ? 0.95 : 0.9) : 0.02) });
    const text = 'Marta es una artista muy importante.';
    const ws = sentenceWords(pack, text, { register: 'neutral', regions: [] });
    const ctx = { pack, pair, learner, now: T0, params: { tileThreshold: 0.8 }, settings: { textMode: 'auto' as const, showExplicit: true }, rate: 0.8 };
    const v = buildSentenceView(text, ws, { cliff: { wordIndex: 3, length: 1, answered: false }, revealed: [] }, ctx);
    expect(v.words.map((w) => w.display)).toEqual(['text', 'tile', 'text', 'gap', 'future', 'future']);
    expect(v.words[2]).toMatchObject({ text: 'una', isNew: true, gloss: 'a, an' });
    expect(v.glosses.map((g) => g.word)).toEqual(['una']);
    expect(v.words[0]?.isNew).toBe(false); // a name is never a new word
    expect(v.durationMs).toBeCloseTo(v.words.reduce((s, w) => s + w.durationMs, 0));
    const faster = buildSentenceView(text, ws, { cliff: null, revealed: [] }, { ...ctx, rate: 1.6 });
    expect(faster.words[3]?.durationMs).toBeCloseTo((v.words[3]?.durationMs ?? 0) / 2);
    const answered = buildSentenceView(text, ws, { cliff: { wordIndex: 3, length: 1, answered: true }, revealed: [1] }, ctx);
    expect(answered.words.map((w) => w.display)).toEqual(['text', 'text', 'text', 'text', 'text', 'text']);
    const tiles = buildSentenceView(text, ws, { cliff: null, revealed: [] }, { ...ctx, settings: { textMode: 'all_tiles', showExplicit: true } });
    expect(tiles.words.every((w) => w.display === 'tile')).toBe(true);
    const all = buildSentenceView(text, ws, { cliff: null, revealed: [] }, { ...ctx, settings: { textMode: 'all_text', showExplicit: true } });
    expect(all.words.every((w) => w.display === 'text')).toBe(true);
    expect(lexemeKey('es', 'ser')).toBe(ws[1]?.key);
  });

  it('masks explicit slang when explicit is off', () => {
    const text = 'Ese señor es un pendejo.';
    const ws = sentenceWords(pack, text, { register: 'street', regions: [] });
    const learner = new LearnerModel();
    const v = buildSentenceView(text, ws, { cliff: null, revealed: [] }, { pack, pair, learner, now: T0, params: { tileThreshold: 0.8 }, settings: { textMode: 'auto', showExplicit: false }, rate: 1 });
    expect(v.words.find((w) => w.text === 'pendejo')?.display).toBe('masked');
    expect(v.glosses.some((g) => g.word === 'pendejo')).toBe(false);
  });
});
