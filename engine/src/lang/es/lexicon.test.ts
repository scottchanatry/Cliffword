import { describe, expect, it } from 'vitest';
import { LEMMAS_BY_FREQUENCY, LEXICON, frequencyRank, lexiconRows, parseLexicon } from './lexicon';
import { LEXICON_DATA_1 } from './lexiconData1';
import { LEXICON_DATA_2 } from './lexiconData2';
import { LEXICON_DATA_3 } from './lexiconData3';
import { LEXICON_DATA_4 } from './lexiconData4';

describe('lexicon', () => {
  it('has at least 1500 distinct lemmas', () => {
    expect(LEMMAS_BY_FREQUENCY.length).toBeGreaterThanOrEqual(1500);
    expect(new Set(LEMMAS_BY_FREQUENCY).size).toBe(LEMMAS_BY_FREQUENCY.length);
  });

  it('lists each lemma in one data item (no duplicates across chunks)', () => {
    const items = [LEXICON_DATA_1, LEXICON_DATA_2, LEXICON_DATA_3, LEXICON_DATA_4]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((i) => i.slice(0, i.lastIndexOf('/')));
    const dups = items.filter((x, i) => items.indexOf(x) !== i);
    expect(dups).toEqual([]);
  });

  it('starts with the most frequent function words', () => {
    expect(LEMMAS_BY_FREQUENCY.slice(0, 6)).toEqual(['el', 'de', 'que', 'y', 'a', 'en']);
    expect(frequencyRank('el')).toBe(1);
    expect(frequencyRank('de')).toBe(2);
    expect(frequencyRank('ser')).toBeLessThan(frequencyRank('ir') as number);
    expect(frequencyRank('casa')).toBeLessThan(frequencyRank('vaina') as number);
  });

  it('frequencyRank is the 1-based position among distinct lemmas', () => {
    LEMMAS_BY_FREQUENCY.forEach((l, i) => expect(frequencyRank(l)).toBe(i + 1));
    expect(frequencyRank('zzzz')).toBeUndefined();
    expect(frequencyRank('')).toBeUndefined();
  });

  it('every noun has a gender and nothing else does', () => {
    for (const [lemma, pos, gender] of LEXICON) {
      if (pos === 'NOUN') expect(gender, lemma).toMatch(/^[mfc]$/);
      else expect(gender, lemma).toBeUndefined();
    }
  });

  it('lemmas are lowercase, NFC, single words', () => {
    for (const [lemma] of LEXICON) {
      expect(lemma).toBe(lemma.toLowerCase());
      expect(lemma).toBe(lemma.normalize('NFC'));
      expect(lemma).toMatch(/^[a-záéíóúüñ]+$/);
    }
  });

  it('verbs are infinitives', () => {
    for (const [lemma, pos] of LEXICON) if (pos === 'VERB' || pos === 'AUX') expect(lemma).toMatch(/(ar|er|ir|ír)$/);
  });

  it('has accurate genders for tricky nouns', () => {
    const g = (l: string) => lexiconRows(l).find((r) => r[1] === 'NOUN')?.[2];
    expect(g('problema')).toBe('m');
    expect(g('día')).toBe('m');
    expect(g('mano')).toBe('f');
    expect(g('agua')).toBe('f');
    expect(g('foto')).toBe('f');
    expect(g('mapa')).toBe('m');
    expect(g('sistema')).toBe('m');
    expect(g('imagen')).toBe('f');
    expect(g('amigo')).toBe('c');
  });

  it('keeps several parts of speech for one lemma', () => {
    expect(lexiconRows('que').map((r) => r[1])).toEqual(['CONJ', 'PRON']);
    expect(lexiconRows('nadaesto')).toEqual([]);
  });

  it('parseLexicon rejects malformed data', () => {
    expect(() => parseLexicon('casa')).toThrow();
    expect(() => parseLexicon('casa/n')).toThrow();
    expect(() => parseLexicon('casa/q')).toThrow();
    expect(() => parseLexicon('casa/vv')).toThrow();
    expect(parseLexicon('  casa/nf   ir/v ')).toEqual([['casa', 'NOUN', 'f'], ['ir', 'VERB']]);
    expect(parseLexicon('')).toEqual([]);
  });
});
