import { describe, expect, it } from 'vitest';
import type { RegisterPack } from '../lang/types';
import { createSpanishPack } from '../lang/es';
import { slang } from '../lang/es/registers';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { slangExemption, slangIn } from '../scoring/context';
import { parseLyrics } from './parse';
import { findSlangMatches, registerEquivalents, registerPairs, slangNotes, songSlangNotes } from './slang';
import { cjkPack } from './testPacks';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const LINE = "Esta noche salimos a janguear, el corillo ya 'tá listo pa' bailar";

describe('slangNotes', () => {
  it('notes every slang word of the janguear line with meaning, neutral form, region, formality and span', () => {
    const notes = slangNotes(LINE, pack, pair);
    expect(notes.map((n) => n.form)).toEqual(['janguear', 'corillo', "'tá", "pa'"]);
    const [janguear, corillo, ta, pa] = notes;
    expect(janguear).toMatchObject({
      neutral: 'salir',
      gloss: 'to hang out, go out',
      regions: ['PR'],
      formality: 'casual',
      explicit: false,
      kind: 'word',
      key: 'es:janguear',
      loose: false,
      alsoStandard: false,
    });
    expect(corillo?.neutral).toBe('grupo');
    expect(ta).toMatchObject({ neutral: 'está', kind: 'clipped', regions: ['CARIB'] });
    expect(pa).toMatchObject({ neutral: 'para', kind: 'clipped' });
    for (const n of notes) {
      expect(LINE.slice(n.span.start, n.span.end)).toBe(n.text);
      expect(n.span.wordCount).toBe(1);
    }
    expect(notes.map((n) => n.span.wordIndex)).toEqual([4, 6, 8, 10]);
  });

  it('gives label keys that exist in the pair pack interface strings', () => {
    const notes = slangNotes("Ese cabrón 'tá bellaco", pack, pair);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(pair.ui[n.labels.formality]).toBeDefined();
      for (const r of n.labels.regions) expect(pair.ui[r]).toBeDefined();
      if (n.labels.explicit) expect(pair.ui[n.labels.explicit]).toBeDefined();
    }
    expect(pair.ui['slang.region']).toContain('{region}');
  });

  it('shows explicit slang by default and hides it when asked', () => {
    const line = "Ese cabrón 'tá bellaco";
    const shown = slangNotes(line, pack, pair);
    expect(shown.map((n) => n.form)).toEqual(['cabrón', "'tá", 'bellaco']);
    const cabron = shown[0];
    expect(cabron).toMatchObject({ explicit: true, formality: 'vulgar' });
    expect(cabron?.labels.explicit).toBe('slang.explicit');
    expect(cabron?.regions).toEqual(['PR', 'DO', 'CU']);
    const hidden = slangNotes(line, pack, pair, { showExplicit: false });
    expect(hidden.map((n) => n.form)).toEqual(["'tá"]);
  });

  it('filters by register-pack region exactly like scoring/context (slangIn, slangExemption)', () => {
    const line = "Asere, 'tá brutal";
    expect(slangNotes(line, pack, pair, { regions: ['PR'] }).map((n) => n.form)).toEqual(['brutal']);
    expect(slangNotes(line, pack, pair, { regions: ['CU'] }).map((n) => n.form)).toEqual(['asere']);
    expect(slangNotes(line, pack, pair, { regions: ['CU', 'CARIB'] }).map((n) => n.form)).toEqual(['asere', "'tá"]);
    // A pack built for PR holds PR and the shared Caribbean pack, so [] is all it needs.
    const prPack = createDefaultSpanishPack({ regions: ['PR'] });
    expect(slangNotes(line, prPack, pair).map((n) => n.form)).toEqual(["'tá", 'brutal']);
    // Every noted word is a word street scoring exempts from shading.
    const exempt = slangExemption(pack, ['CU', 'CARIB']);
    for (const n of slangNotes(line, pack, pair, { regions: ['CU', 'CARIB'] })) {
      const seg = pack.segment(line).find((s) => s.start === n.span.start);
      expect(seg && exempt(seg)).toBe(true);
    }
  });

  it('finds clipped forms written without their marks, but not standard words', () => {
    const notes = slangNotes('El corillo ta listo pa bailar, tan bonito', pack, pair);
    expect(notes.map((n) => [n.form, n.text, n.loose])).toEqual([
      ['corillo', 'corillo', false],
      ["'tá", 'ta', true],
      ["pa'", 'pa', true],
    ]);
    expect(slangNotes('ta listo pa bailar', pack, pair, { loose: false })).toEqual([]);
    // "mano" is a standard word (hand), even though "'mano" is clipped "hermano".
    expect(slangNotes('Dame la mano', pack, pair).map((n) => n.form)).toEqual([]);
    expect(slangNotes("Dale, 'mano", pack, pair).map((n) => n.form)).toContain("'mano");
  });

  it('notes forms that are also standard words, flagged', () => {
    const notes = slangNotes('Pon la música', pack, pair);
    expect(notes.map((n) => [n.form, n.alsoStandard])).toEqual([['pon', true]]);
    expect(slangNotes('Pon la música', pack, pair, { alsoStandard: false })).toEqual([]);
  });

  it('matches phrases before single words', () => {
    const custom: RegisterPack = {
      id: 'es-TEST',
      region: 'TEST',
      entries: [
        slang('TEST', 'vaina', 'cosa', 'thing'),
        slang('TEST', 'qué vaina', 'qué fastidio', 'what a drag', { kind: 'phrase' }),
      ],
    };
    const p = createSpanishPack({ rules: [], registers: [custom] });
    const notes = slangNotes('¡Ay, qué vaina! Esa vaina', p, pair);
    expect(notes.map((n) => [n.form, n.text, n.span.wordCount])).toEqual([
      ['qué vaina', 'qué vaina', 2],
      ['vaina', 'vaina', 1],
    ]);
    // Phrase notes use the pair gloss when there is one, else the entry's own gloss.
    expect(notes[0]?.gloss).toBe('what a drag');
  });

  it('agrees with slangIn on which forms occur', () => {
    const found = new Set(slangIn(pack, LINE));
    for (const n of slangNotes(LINE, pack, pair)) expect(found.has(n.form)).toBe(true);
  });

  it('returns nothing for a pack without registers or a line without words', () => {
    expect(slangNotes('我爱你', cjkPack, pair)).toEqual([]);
    expect(slangNotes('¡¿...?!', pack, pair)).toEqual([]);
  });
});

describe('findSlangMatches', () => {
  it('finds every occurrence, in text order', () => {
    const m = findSlangMatches(pack, "Pa' la playa y pa' la casa");
    expect(m.map((x) => [x.text, x.wordIndex])).toEqual([
      ["Pa'", 0],
      ["pa'", 4],
    ]);
  });

  it('limits entries by kind', () => {
    expect(findSlangMatches(pack, LINE, { kinds: ['clipped'] }).map((x) => x.entry.form)).toEqual(["'tá", "pa'"]);
  });
});

describe('registerPairs', () => {
  it('builds the neutral paraphrase from the entries and lists the substitutions with spans', () => {
    const rp = registerPairs(LINE, pack);
    expect(rp.street).toBe(LINE);
    expect(rp.neutral).toBe('Esta noche salimos a salir, el grupo ya está listo para bailar');
    expect(rp.substitutions.map((s) => [s.street, s.neutral, s.kind])).toEqual([
      ['janguear', 'salir', 'word'],
      ['corillo', 'grupo', 'word'],
      ["'tá", 'está', 'clipped'],
      ["pa'", 'para', 'clipped'],
    ]);
    for (const s of rp.substitutions) {
      expect(rp.street.slice(s.start, s.end)).toBe(s.street);
      expect(rp.neutral.slice(s.neutralStart, s.neutralEnd)).toBe(s.neutral);
    }
  });

  it('keeps the case of the street form and expands multi-word neutrals', () => {
    expect(registerPairs("'Tá bueno", pack).neutral).toBe('Está bueno');
    expect(registerPairs("TODO 'TÁ BIEN", pack).neutral).toBe('TODO ESTÁ BIEN');
    expect(registerPairs("Vamos pa'l party", pack).neutral).toBe('Vamos para el party');
    expect(registerPairs("Pa'lante", pack).neutral).toBe('Adelante');
  });

  it('replaces phrases whole', () => {
    expect(registerPairs('Ese tema está a fuego', pack, [], { alsoStandard: true }).neutral).toBe('Ese tema está excelente');
  });

  it('leaves forms that are also standard words alone by default', () => {
    expect(registerPairs('Pon la música', pack).neutral).toBe('Pon la música');
    expect(registerPairs('Pon la música', pack, [], { alsoStandard: true }).neutral).toBe('Aventón la música');
  });

  it('honours the region selection', () => {
    expect(registerPairs("Asere, 'tá brutal", pack, ['CU']).neutral).toBe("Amigo, 'tá brutal");
  });

  it('returns a line without slang unchanged', () => {
    expect(registerPairs('Marta llegó tarde.', pack)).toEqual({ street: 'Marta llegó tarde.', neutral: 'Marta llegó tarde.', substitutions: [] });
  });
});

describe('songSlangNotes', () => {
  it('lists each slang lexeme once, in order of first occurrence, with counts', () => {
    const ly = parseLyrics("Esta noche salimos a janguear (x2)\nEl corillo ya 'tá listo\nEl corillo 'tá aquí", pack);
    const song = songSlangNotes(ly, pack, pair);
    expect(song.map((s) => [s.note.form, s.lineId, s.count])).toEqual([
      ['janguear', 'l0', 2],
      ['corillo', 'l1', 2],
      ["'tá", 'l1', 2],
    ]);
  });
});

describe('registerEquivalents', () => {
  it('gives clipped forms and their full forms as word sequences', () => {
    const eq = registerEquivalents(pack, [], ['clipped']);
    const find = (form: string) => eq.find((e) => e.entry.form === form);
    expect(find("pa'l")).toMatchObject({ street: ["pa'l"], neutral: ['para', 'el'] });
    expect(find("'tá")).toMatchObject({ street: ["'tá"], neutral: ['está'] });
    expect(find('janguear')).toBeUndefined();
    expect(registerEquivalents(pack).some((e) => e.entry.form === 'janguear')).toBe(true);
  });
});
