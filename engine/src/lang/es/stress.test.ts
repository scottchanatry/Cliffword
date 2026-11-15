import { describe, expect, it } from 'vitest';
import {
  accentLastVowel, addAcute, isFinalStress, nuclei, prefixKeepingStress, removeAcute, respell,
  stressedVowelIndex, suffixKeepingStress, syllableCount,
} from './stress';

describe('syllable nuclei', () => {
  it('counts syllables with diphthongs and hiatus', () => {
    expect(syllableCount('casa')).toBe(2);
    expect(syllableCount('ciudad')).toBe(2);
    expect(syllableCount('poeta')).toBe(3);
    expect(syllableCount('país')).toBe(2);
    expect(syllableCount('paises')).toBe(2);
    expect(syllableCount('guerra')).toBe(2); // silent u
    expect(syllableCount('que')).toBe(1);
    expect(syllableCount('buey')).toBe(1);
    expect(syllableCount('')).toBe(0);
    expect(nuclei('rey')).toHaveLength(1);
  });
});

describe('stress', () => {
  it('finds the stressed vowel by the default rule or the written accent', () => {
    expect(stressedVowelIndex('casa')).toBe(1);
    expect(stressedVowelIndex('papel')).toBe(3);
    expect(stressedVowelIndex('joven')).toBe(1);
    expect(stressedVowelIndex('canción')).toBe(5);
    expect(stressedVowelIndex('xyz')).toBe(-1);
  });
  it('knows final stress', () => {
    expect(isFinalStress('autobús')).toBe(true);
    expect(isFinalStress('mes')).toBe(true);
    expect(isFinalStress('lunes')).toBe(false);
    expect(isFinalStress('crisis')).toBe(false);
  });
  it('respells to keep stress', () => {
    expect(respell('jovenes', 1)).toBe('jóvenes');
    expect(respell('canciones', 5)).toBe('canciones');
    expect(respell('ten', 1)).toBe('ten');
    expect(suffixKeepingStress('país', 'es')).toBe('países');
    expect(suffixKeepingStress('luz', 'ces', 1)).toBe('luces');
    expect(prefixKeepingStress('man', 'ten')).toBe('mantén');
    expect(prefixKeepingStress('pre', 'vio')).toBe('previó');
    expect(prefixKeepingStress('f', 'rio')).toBe('frio');
    expect(prefixKeepingStress('ob', 'tienes')).toBe('obtienes');
  });
  it('adds and removes accents', () => {
    expect(removeAcute('áéíóú ü ñ')).toBe('aeiou ü ñ');
    expect(addAcute('tuvie', 4)).toBe('tuvié');
    expect(addAcute('tuvie', 2)).toBe('tuvie');
    expect(addAcute('', 3)).toBe('');
    expect(accentLastVowel('hubie')).toBe('hubié');
    expect(accentLastVowel('fué')).toBe('fué');
  });
});
