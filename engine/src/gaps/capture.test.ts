import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAP_OPTIONS,
  accentVariantsOf,
  findNativeGaps,
  gapEvents,
  isNativeWord,
  isTargetWord,
  mergeCandidates,
} from './capture';
import type { NativeGapWord } from './capture';
import { createStubPack, createStubPair } from '../story/testStubs';

const pack = createStubPack();
const pair = createStubPair();

describe('findNativeGaps', () => {
  it('groups consecutive native words into one gap', () => {
    const text = 'Fui al hardware store';
    const gaps = findNativeGaps(text, pack, pair);
    expect(gaps).toHaveLength(1);
    const g = gaps[0];
    expect(g?.text).toBe('hardware store');
    expect(g?.start).toBe(7);
    expect(g?.end).toBe(text.length);
    expect(text.slice(g?.start, g?.end)).toBe('hardware store');
    expect(g?.words.map((w) => w.norm)).toEqual(['hardware', 'store']);
    // Phrase translation first, then content words head-first (store, hardware).
    expect(g?.candidates).toEqual(['ferretería', 'tienda']);
  });

  it('finds a single native word', () => {
    const gaps = findNativeGaps('Tengo un dog.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['dog']);
    expect(gaps[0]?.candidates).toEqual(['perro']);
  });

  it('ignores words that are also Spanish', () => {
    expect(findNativeGaps('No me gusta el pan.', pack, pair)).toEqual([]);
    expect(findNativeGaps('Quiero la red, no a Marta.', pack, pair)).toEqual([]);
  });

  it('ignores Spanish words written without their accent', () => {
    expect(findNativeGaps('Quiero un cafe.', pack, pair)).toEqual([]);
  });

  it("ignores clipped forms written without their apostrophe ('tá and pa')", () => {
    expect(findNativeGaps('Vamos pa la playa, ta brutal.', pack, pair)).toEqual([]);
    expect(findNativeGaps("Vamos pa' la playa, 'tá brutal.", pack, pair)).toEqual([]);
  });

  it('splits gaps at punctuation and at Spanish words', () => {
    const gaps = findNativeGaps('Fui al store, y compré bread.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['store', 'bread']);
    const comma = findNativeGaps('Fui al hardware, store.', pack, pair);
    expect(comma.map((g) => g.text)).toEqual(['hardware', 'store']);
  });

  it('accepts a native sentence start and keeps English "I" mid-sentence', () => {
    const start = findNativeGaps('I bought pan.', pack, pair);
    expect(start.map((g) => g.text)).toEqual(['I bought']);
    const mid = findNativeGaps('Fui al store and I bought bread.', pack, pair);
    expect(mid.map((g) => g.text)).toEqual(['store and I bought bread']);
  });

  it('treats capitalized words mid-sentence as names', () => {
    expect(findNativeGaps('Fui a Home Depot.', pack, pair)).toEqual([]);
    const off = findNativeGaps('Fui a Home Depot.', pack, pair, { skipCapitalized: false });
    expect(off.map((g) => g.text)).toEqual(['Home Depot']);
  });

  it('accepts a capitalized native word at a sentence start', () => {
    const gaps = findNativeGaps('Compré pan. Hardware store, por favor.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['Hardware store']);
    expect(gaps[0]?.candidates[0]).toBe('ferretería');
  });

  it('joins native words across hyphens', () => {
    const gaps = findNativeGaps('Hice el check-in.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['check-in']);
    expect(gaps[0]?.words.map((w) => w.norm)).toEqual(['check', 'in']);
  });

  it('keeps inner apostrophes of native words', () => {
    const gaps = findNativeGaps("Yo don't know.", pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(["don't know"]);
    expect(gaps[0]?.candidates).toEqual(['saber', 'no']);
  });

  it('orders content words before function words', () => {
    const gaps = findNativeGaps('Fui a the store.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['the store']);
    expect(gaps[0]?.words.map((w) => w.functionWord)).toEqual([true, false]);
    expect(gaps[0]?.candidates).toEqual(['tienda', 'el', 'la']);
  });

  it('can order content words first to last for head-initial native languages', () => {
    const gaps = findNativeGaps('Fui al hardware store', pack, { ...pair, toTarget: (w) => pair.toTarget(w).filter(() => w !== 'hardware store') }, {
      contentOrder: 'first-last',
    });
    expect(gaps[0]?.candidates).toEqual(['ferretería', 'tienda']);
    const reversed = findNativeGaps('Fui al store hardware', pack, pair, { contentOrder: 'first-last' });
    expect(reversed[0]?.candidates).toEqual(['tienda', 'ferretería']);
  });

  it('keeps gaps without candidates', () => {
    const gaps = findNativeGaps('Fui al depot.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['depot']);
    expect(gaps[0]?.candidates).toEqual([]);
  });

  it('ends a gap at a number', () => {
    const gaps = findNativeGaps('Tengo the 3 dog.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['the', 'dog']);
  });

  it('returns [] for empty, punctuation-only, all-Spanish and unknown-word texts', () => {
    expect(findNativeGaps('', pack, pair)).toEqual([]);
    expect(findNativeGaps('¿...!', pack, pair)).toEqual([]);
    expect(findNativeGaps('Marta compró pan en el mercado.', pack, pair)).toEqual([]);
    expect(findNativeGaps('Marta asdfgh qwerty.', pack, pair)).toEqual([]);
  });

  it('finds several gaps in order with exact spans', () => {
    const text = '¡Fui al market con my dog!';
    const gaps = findNativeGaps(text, pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['market', 'my dog']);
    for (const g of gaps) expect(text.slice(g.start, g.end)).toBe(g.text);
    expect(gaps[1]?.candidates).toEqual(['perro', 'mi']);
  });
});

describe('gapEvents', () => {
  it('emits one native_gap event per gap for its best candidate', () => {
    const gaps = findNativeGaps('Fui al hardware store y compré bread.', pack, pair);
    expect(gapEvents(gaps, pack, 42)).toEqual([
      { type: 'native_gap', key: 'es:ferretería', at: 42 },
      { type: 'native_gap', key: 'es:pan', at: 42 },
    ]);
  });

  it('skips gaps without candidates and handles no gaps', () => {
    expect(gapEvents(findNativeGaps('Fui al depot.', pack, pair), pack, 1)).toEqual([]);
    expect(gapEvents([], pack, 1)).toEqual([]);
  });

  it('keeps one event per gap even when two gaps share a lexeme', () => {
    const gaps = findNativeGaps('El dog, el dog.', pack, pair);
    expect(gapEvents(gaps, pack, 7).map((e) => e.key)).toEqual(['es:perro', 'es:perro']);
  });
});

describe('native word checks', () => {
  it('accentVariantsOf adds one accent at one position', () => {
    expect(accentVariantsOf('cafe', DEFAULT_GAP_OPTIONS.accentVariants)).toEqual(['cáfe', 'café']);
    expect(accentVariantsOf('manana', { n: ['ñ'] })).toEqual(['mañana', 'manaña']);
    expect(accentVariantsOf('xyz', DEFAULT_GAP_OPTIONS.accentVariants)).toEqual([]);
    expect(accentVariantsOf('', DEFAULT_GAP_OPTIONS.accentVariants)).toEqual([]);
  });

  it('isTargetWord tries accent and apostrophe variants', () => {
    expect(isTargetWord('pan', pack)).toBe(true);
    expect(isTargetWord('cafe', pack)).toBe(true);
    expect(isTargetWord('cafe', pack, { accentVariants: {} })).toBe(false);
    expect(isTargetWord('pa', pack)).toBe(true);
    expect(isTargetWord('pa', pack, { apostropheVariants: false })).toBe(false);
    expect(isTargetWord('ta', pack)).toBe(true);
    expect(isTargetWord('ta', pack, { accentVariants: {} })).toBe(false);
    expect(isTargetWord('store', pack)).toBe(false);
    expect(isTargetWord('', pack)).toBe(false);
  });

  it('isNativeWord needs the native lexicon and no target analysis', () => {
    expect(isNativeWord('store', pack, pair)).toBe(true);
    expect(isNativeWord('Store', pack, pair)).toBe(true);
    expect(isNativeWord('pan', pack, pair)).toBe(false);
    expect(isNativeWord('marta', pack, pair)).toBe(false);
    expect(isNativeWord('asdf', pack, pair)).toBe(false);
    expect(isNativeWord('', pack, pair)).toBe(false);
  });

  it('mergeCandidates dedupes across phrase and words', () => {
    const w = (norm: string, candidates: string[], functionWord = false): NativeGapWord => ({
      text: norm, norm, start: 0, end: norm.length, candidates, functionWord,
    });
    expect(mergeCandidates(['tienda'], [w('the', ['el'], true), w('store', ['tienda', 'almacén'])], 'last-first')).toEqual([
      'tienda',
      'almacén',
      'el',
    ]);
  });
});
