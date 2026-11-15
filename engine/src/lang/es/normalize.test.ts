import { describe, expect, it } from 'vitest';
import { canonicalApostrophes, isApostrophe, normalize, stripAccents } from './normalize';

describe('normalize', () => {
  it('lowercases and trims edge punctuation', () => {
    expect(normalize('¡Hola!')).toBe('hola');
    expect(normalize('¿Cómo')).toBe('cómo');
    expect(normalize('casa,')).toBe('casa');
    expect(normalize('"Ella"')).toBe('ella');
    expect(normalize('«no»…')).toBe('no');
    expect(normalize('  Árbol  ')).toBe('árbol');
  });
  it('keeps accents and ñ', () => {
    expect(normalize('ESTÁ')).toBe('está');
    expect(normalize('Niño')).toBe('niño');
    expect(normalize('pingüino')).toBe('pingüino');
  });
  it('composes decomposed accents (NFC)', () => {
    expect(normalize('está')).toBe('está');
    expect(normalize('niño')).toBe('niño');
  });
  it('keeps the apostrophes of clipped forms', () => {
    expect(normalize("'tá")).toBe("'tá");
    expect(normalize("pa'")).toBe("pa'");
    expect(normalize("Pa'lante")).toBe("pa'lante");
    expect(normalize("¿'Tá?")).toBe("'tá");
    expect(normalize("pa',")).toBe("pa'");
    expect(normalize("to'")).toBe("to'");
  });
  it('maps typographic apostrophes to ASCII', () => {
    expect(normalize('’tá')).toBe("'tá");
    expect(normalize('pa’')).toBe("pa'");
    expect(normalize('‘tá')).toBe("'tá");
  });
  it('strips a pair of quote apostrophes around a word', () => {
    expect(normalize("'hola'")).toBe('hola');
  });
  it('returns "" for empty or punctuation-only input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('¿?')).toBe('');
    expect(normalize('...')).toBe('');
    expect(normalize("'")).toBe('');
    expect(normalize('   ')).toBe('');
  });
  it('keeps inner punctuation of numbers', () => {
    expect(normalize('3,5')).toBe('3,5');
    expect(normalize('1.000.')).toBe('1.000');
  });
});

describe('stripAccents', () => {
  it('removes acute accents and diaeresis', () => {
    expect(stripAccents('está')).toBe('esta');
    expect(stripAccents('canción')).toBe('cancion');
    expect(stripAccents('pingüino')).toBe('pinguino');
    expect(stripAccents('ÁRBOL')).toBe('ARBOL');
  });
  it('keeps ñ distinct from n', () => {
    expect(stripAccents('niño')).toBe('niño');
    expect(stripAccents('AÑO')).toBe('AÑO');
    expect(stripAccents('niño')).toBe('niño');
    expect(stripAccents('año')).not.toBe(stripAccents('ano'));
  });
  it('leaves plain text and apostrophes alone', () => {
    expect(stripAccents("pa'lante")).toBe("pa'lante");
    expect(stripAccents('')).toBe('');
  });
});

describe('apostrophe helpers', () => {
  it('recognizes all apostrophe characters', () => {
    expect(isApostrophe("'")).toBe(true);
    expect(isApostrophe('’')).toBe(true);
    expect(isApostrophe('a')).toBe(false);
    expect(isApostrophe(undefined)).toBe(false);
    expect(canonicalApostrophes('pa’ ‘tá')).toBe("pa' 'tá");
  });
});
