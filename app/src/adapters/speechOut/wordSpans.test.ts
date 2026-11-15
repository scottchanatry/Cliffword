import { estimateWordTimings, spanIndexAt, wordSpans } from './wordSpans';
import { filterVoices, langMatches, normalizeLang } from './voices';
import type { Voice } from './types';

describe('wordSpans', () => {
  it('finds words with their offsets, skipping punctuation', () => {
    expect(wordSpans('¿Marta llegó tarde?')).toEqual([
      { text: 'Marta', start: 1, end: 6 },
      { text: 'llegó', start: 7, end: 12 },
      { text: 'tarde', start: 13, end: 18 },
    ]);
  });

  it('keeps clipped forms and numbers whole', () => {
    expect(wordSpans("'Tá bien, vamo' pa' la 2")).toEqual([
      { text: "'Tá", start: 0, end: 3 },
      { text: 'bien', start: 4, end: 8 },
      { text: "vamo'", start: 10, end: 15 },
      { text: "pa'", start: 16, end: 19 },
      { text: 'la', start: 20, end: 22 },
      { text: '2', start: 23, end: 24 },
    ]);
  });

  it('maps a boundary offset to the word at or after it', () => {
    const spans = wordSpans('Hola mi amor');
    expect(spanIndexAt(spans, 0)).toBe(0);
    expect(spanIndexAt(spans, 4)).toBe(1);
    expect(spanIndexAt(spans, 6)).toBe(1);
    expect(spanIndexAt(spans, 8)).toBe(2);
    expect(spanIndexAt(spans, 99)).toBe(-1);
  });
});

describe('estimateWordTimings', () => {
  it('gives longer words more time and slows down at lower rates', () => {
    const spans = wordSpans('sí mercado');
    const normal = estimateWordTimings(spans);
    expect(normal.map((t) => t.index)).toEqual([0, 1]);
    expect(normal[0]?.startMs).toBe(0);
    const d = (t: { startMs: number; endMs: number } | undefined) => (t ? t.endMs - t.startMs : 0);
    expect(d(normal[1])).toBeGreaterThan(d(normal[0]));
    expect(normal[1]?.startMs).toBeGreaterThan(normal[0]?.endMs ?? 0);

    const slow = estimateWordTimings(spans, { rate: 0.5 });
    expect(d(slow[1])).toBeCloseTo(2 * d(normal[1]), -1);
  });
});

describe('voices', () => {
  const voices: Voice[] = [
    { id: 'b', name: 'B', lang: 'es_MX', quality: 'default' },
    { id: 'a', name: 'A', lang: 'es-ES', quality: 'enhanced' },
    { id: 'c', name: 'C', lang: 'en-US', quality: 'default' },
    { id: 'd', name: 'D', lang: 'est', quality: 'default' },
  ];

  it('normalizes language tags and matches regional variants', () => {
    expect(normalizeLang(' es_MX ')).toBe('es-mx');
    expect(langMatches('es_MX', 'es')).toBe(true);
    expect(langMatches('es-MX', 'es-mx')).toBe(true);
    expect(langMatches('est', 'es')).toBe(false);
    expect(langMatches('es', 'es-MX')).toBe(false);
  });

  it('filters by language and puts enhanced voices first', () => {
    expect(filterVoices(voices, 'es').map((v) => v.id)).toEqual(['a', 'b']);
    expect(filterVoices(voices).map((v) => v.id)).toEqual(['a', 'c', 'b', 'd']);
  });
});
