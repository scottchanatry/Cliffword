import { describe, expect, it } from 'vitest';
import {
  EN_PHRASES_TO_ES,
  EN_TO_ES,
  englishBaseCandidates,
  ES_TO_EN,
  glossEs,
  normalizeEnglish,
  parseGlossLines,
  toTargetEs,
} from './glossary';
import { EN_IRREGULAR } from './glossaryEnEs';

describe('parseGlossLines', () => {
  it('parses key = value lines, skipping blanks', () => {
    const m = parseGlossLines('\n casa = house, home \n\nperro = dog\n');
    expect([...m]).toEqual([
      ['casa', 'house, home'],
      ['perro', 'dog'],
    ]);
  });
  it('composes decomposed accents', () => {
    expect([...parseGlossLines('está = is'.normalize('NFD'))]).toEqual([['está', 'is']]);
  });
  it('throws on malformed, empty or duplicate entries', () => {
    expect(() => parseGlossLines('casa house')).toThrow(/malformed/);
    expect(() => parseGlossLines(' = house')).toThrow();
    expect(() => parseGlossLines('casa = house\ncasa = home')).toThrow(/duplicate/);
  });
});

describe('ES_TO_EN', () => {
  it('glosses at least 1000 Spanish lemmas', () => {
    expect(ES_TO_EN.size).toBeGreaterThanOrEqual(1000);
  });
  it('keys are lowercase NFC lemmas and glosses are short', () => {
    for (const [es, en] of ES_TO_EN) {
      expect(es, es).toBe(es.normalize('NFC').toLowerCase());
      expect(es, es).not.toMatch(/\s/);
      expect(en.length, es).toBeLessThanOrEqual(70);
    }
  });
  it('covers the most common lemmas with correct glosses', () => {
    expect(ES_TO_EN.get('ser')).toMatch(/to be/);
    expect(ES_TO_EN.get('estar')).toMatch(/to be/);
    expect(ES_TO_EN.get('tener')).toBe('to have');
    expect(ES_TO_EN.get('casa')).toMatch(/house/);
    expect(ES_TO_EN.get('niño')).toMatch(/child/);
    expect(ES_TO_EN.get('mañana')).toMatch(/tomorrow/);
    expect(ES_TO_EN.get('actual')).toMatch(/current/);
  });
  it('verbs gloss as "to ..."', () => {
    for (const v of ['hablar', 'comer', 'vivir', 'ir', 'poder', 'decir', 'salir', 'janguear']) {
      const g = ES_TO_EN.get(v);
      if (g !== undefined) expect(g, v).toMatch(/^(can, )?to /);
    }
  });
});

describe('EN_TO_ES', () => {
  it('maps at least 600 English words', () => {
    expect(EN_TO_ES.size).toBeGreaterThanOrEqual(600);
  });
  it('keys are lowercase single words and every value is a non-empty list of lemmas', () => {
    for (const [en, es] of EN_TO_ES) {
      expect(en, en).toMatch(/^[a-z]+$/);
      expect(es.length, en).toBeGreaterThan(0);
      expect(new Set(es).size, en).toBe(es.length);
      for (const t of es) {
        expect(t, en).toBe(t.normalize('NFC').toLowerCase());
        expect(t, en).toMatch(/^[\p{L}]+$/u);
      }
    }
  });
  it('most candidates have a Spanish gloss (the two tables agree)', () => {
    const targets = new Set([...EN_TO_ES.values()].flat());
    const missing = [...targets].filter((t) => !ES_TO_EN.has(t));
    expect(missing).toEqual([]);
  });
  it('irregular forms point at existing keys', () => {
    for (const [form, base] of Object.entries(EN_IRREGULAR)) expect(EN_TO_ES.has(base), `${form} -> ${base}`).toBe(true);
  });
});

describe('normalizeEnglish', () => {
  it('lowercases and trims punctuation, keeping in-word apostrophes', () => {
    expect(normalizeEnglish('Beach!')).toBe('beach');
    expect(normalizeEnglish('“Hello,”')).toBe('hello');
    expect(normalizeEnglish('Don’t')).toBe("don't");
    expect(normalizeEnglish("'quoted'")).toBe('quoted');
  });
  it('returns "" for empty or punctuation-only input', () => {
    expect(normalizeEnglish('')).toBe('');
    expect(normalizeEnglish('  ')).toBe('');
    expect(normalizeEnglish('?!...')).toBe('');
  });
});

describe('englishBaseCandidates', () => {
  it('undoes regular inflection', () => {
    expect(englishBaseCandidates('stories')).toContain('story');
    expect(englishBaseCandidates('tried')).toContain('try');
    expect(englishBaseCandidates('watches')).toContain('watch');
    expect(englishBaseCandidates('makes')).toContain('make');
    expect(englishBaseCandidates('walked')).toContain('walk');
    expect(englishBaseCandidates('danced')).toContain('dance');
    expect(englishBaseCandidates('stopped')).toContain('stop');
    expect(englishBaseCandidates('running')).toContain('run');
    expect(englishBaseCandidates('dancing')).toContain('dance');
    expect(englishBaseCandidates('bigger')).toContain('big');
    expect(englishBaseCandidates('nicest')).toContain('nice');
    expect(englishBaseCandidates('happier')).toContain('happy');
    expect(englishBaseCandidates('quickly')).toContain('quick');
    expect(englishBaseCandidates("mom's")).toContain('mom');
  });
  it('never returns the word itself or one-letter stems', () => {
    expect(englishBaseCandidates('is')).toEqual([]);
    expect(englishBaseCandidates('house')).not.toContain('house');
    for (const c of englishBaseCandidates('as')) expect(c.length).toBeGreaterThanOrEqual(2);
  });
});

describe('toTargetEs', () => {
  it('returns Spanish lemmas, best first', () => {
    expect(toTargetEs('house')).toEqual(['casa']);
    expect(toTargetEs('be')).toEqual(['ser', 'estar']);
    expect(toTargetEs('beach')[0]).toBe('playa');
    expect(toTargetEs('know')).toEqual(['saber', 'conocer']);
  });
  it('handles capitalized sentence starts and punctuation', () => {
    expect(toTargetEs('Beach')).toEqual(['playa']);
    expect(toTargetEs('BEACH!')).toEqual(['playa']);
    expect(toTargetEs('¿beach?')).toEqual(['playa']);
  });
  it('handles inflected and irregular forms', () => {
    expect(toTargetEs('houses')).toEqual(['casa']);
    expect(toTargetEs('walked')).toEqual(['caminar', 'andar']);
    expect(toTargetEs('dancing')[0]).toBe('bailar');
    expect(toTargetEs('went')).toEqual(['ir']);
    expect(toTargetEs('children')).toEqual(['niño', 'hijo']);
    expect(toTargetEs('Was')).toEqual(['ser', 'estar']);
    expect(toTargetEs('bigger')).toEqual(['grande']);
  });
  it('merges a word with its irregular base', () => {
    expect(toTargetEs('left')).toEqual(['izquierda', 'salir', 'dejar', 'partir']);
    expect(toTargetEs('lost')).toEqual(['perdido', 'perder']);
  });
  it('does not merge unrelated stems when the word itself is known', () => {
    expect(toTargetEs('news')).toEqual(['noticia']);
  });
  it('translates listed multi-word phrases as a unit', () => {
    expect(toTargetEs('hardware store')).toEqual(['ferretería']);
    expect(toTargetEs('  Ice   Cream! ')).toEqual(['helado']);
    expect(toTargetEs('red store')).toEqual([]);
    for (const [phrase, lemmas] of EN_PHRASES_TO_ES) {
      expect(phrase).toMatch(/^[a-z]+( [a-z]+)+$/);
      for (const l of lemmas) expect(ES_TO_EN.has(l), `${phrase} -> ${l}`).toBe(true);
    }
  });
  it('returns [] for unknown, empty, punctuation-only or Spanish input', () => {
    expect(toTargetEs('xyzzy')).toEqual([]);
    expect(toTargetEs('')).toEqual([]);
    expect(toTargetEs('...')).toEqual([]);
    expect(toTargetEs("'tá")).toEqual([]);
    expect(toTargetEs('playa')).toEqual([]);
  });
});

describe('glossEs', () => {
  it('glosses a lemma', () => {
    expect(glossEs('perro')).toBe('dog');
    expect(glossEs('estar')).toMatch(/to be/);
  });
  it('accepts capitals, stray spaces and decomposed accents', () => {
    expect(glossEs('Perro')).toBe('dog');
    expect(glossEs(' perro ')).toBe('dog');
    expect(glossEs('teléfono'.normalize('NFD'))).toBe('telephone');
    expect(glossEs('ÁRBOL')).toBe('tree');
  });
  it('keeps accented and unaccented words apart', () => {
    expect(glossEs('sí')).toMatch(/yes/);
    expect(glossEs('si')).toBe('if');
    expect(glossEs('él')).toMatch(/he/);
    expect(glossEs('el')).toBe('the');
  });
  it('returns undefined for unknown, empty and punctuation-only input', () => {
    expect(glossEs('xyzzy')).toBeUndefined();
    expect(glossEs('')).toBeUndefined();
    expect(glossEs('¿?')).toBeUndefined();
    // A missing accent is not guessed: "telefono" is not a lemma.
    expect(glossEs('telefono')).toBeUndefined();
  });
});
