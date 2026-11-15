import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import { syllableCount } from '../lang/es/stress';
import type { LanguagePack } from '../lang/types';
import { DEFAULT_DURATION_OPTIONS, estimateDurationMs, estimateDurations, fallbackSyllables } from './duration';

const pack = createDefaultSpanishPack();
const MS = DEFAULT_DURATION_OPTIONS.msPerSyllable;

describe('fallbackSyllables', () => {
  it('counts vowel groups after folding accents', () => {
    expect(fallbackSyllables('puesto', pack)).toBe(2);
    expect(fallbackSyllables('mercado', pack)).toBe(3);
    expect(fallbackSyllables('Él', pack)).toBe(1);
    expect(fallbackSyllables('muy', pack)).toBe(1);
    expect(fallbackSyllables('y', pack)).toBe(1);
    expect(fallbackSyllables('pingüino', pack)).toBe(3); // pin-güi-no
    expect(fallbackSyllables("'tá", pack)).toBe(1);
    // Hiatus is undercounted by vowel groups; a pack counter fixes it.
    expect(fallbackSyllables('día', pack)).toBe(1);
  });

  it('spells out words without vowels and counts digits of numbers', () => {
    expect(fallbackSyllables('klk', pack)).toBe(3);
    expect(fallbackSyllables('25', pack)).toBe(4);
    expect(fallbackSyllables('ありがとう', pack)).toBe(5);
    expect(fallbackSyllables('', pack)).toBe(0);
  });
});

describe('estimateDurationMs', () => {
  it('scales with syllables and with the speech rate', () => {
    expect(estimateDurationMs('puesto', pack, 1)).toBe(2 * MS);
    expect(estimateDurationMs('puesto', pack, 0.75)).toBeCloseTo((2 * MS) / 0.75, 10);
    expect(estimateDurationMs('y', pack, 1)).toBe(MS);
    expect(estimateDurationMs('', pack, 1)).toBe(MS); // at least one syllable
    // A bad rate counts as natural speed.
    expect(estimateDurationMs('puesto', pack, 0)).toBe(2 * MS);
    expect(estimateDurationMs('puesto', pack, Number.NaN)).toBe(2 * MS);
  });

  it('uses the syllable counter given in the options instead of the fallback', () => {
    expect(estimateDurationMs('día', pack, 1)).toBe(MS);
    expect(estimateDurationMs('día', pack, 1, { syllables: syllableCount })).toBe(2 * MS);
    expect(estimateDurationMs('leer', pack, 1, { syllables: syllableCount, msPerSyllable: 100 })).toBe(200);
  });

  it('orders tiles like the design: short function words, longer content words', () => {
    const ds = estimateDurations('Compró pan y una fruta muy dulce en un puesto del mercado.', pack, 1);
    expect(ds.map((d) => d.segment.text)).toEqual(['Compró', 'pan', 'y', 'una', 'fruta', 'muy', 'dulce', 'en', 'un', 'puesto', 'del', 'mercado']);
    const of = (w: string) => ds.find((d) => d.segment.text === w)?.durationMs ?? 0;
    expect(of('y')).toBeLessThan(of('puesto'));
    expect(of('puesto')).toBeLessThan(of('mercado'));
    expect(ds.map((d) => d.index)).toEqual(ds.map((_, i) => i));
  });

  it('works without a pack accent folder (combining marks) and in scripts without spaces', () => {
    const bare = { foldAccents: undefined } as Pick<LanguagePack, 'foldAccents'>;
    expect(fallbackSyllables('café', bare)).toBe(2);
    expect(estimateDurationMs('こんにちは', bare, 1)).toBe(5 * MS);
  });
});
