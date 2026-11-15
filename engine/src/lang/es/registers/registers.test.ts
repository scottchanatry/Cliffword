import { describe, expect, it } from 'vitest';
import type { RegisterPack, SlangEntry } from '../../types';
import {
  CARIB,
  CARIB_REGISTER,
  CO_REGISTER,
  CU_REGISTER,
  DEFAULT_FIND_SLANG_OPTIONS,
  DO_REGISTER,
  expandRegions,
  findSlang,
  inRegions,
  looseSlangKey,
  PR_REGISTER,
  REGION_CODES,
  registerFor,
  slang,
  slangNorm,
  SPANISH_REGISTERS,
} from './index';
import { analyze } from '../analyze';
import { lexiconRows } from '../lexicon';

const MIN_ENTRIES: Record<string, number> = { PR: 35, DO: 35, CU: 25, CO: 25, CARIB: 20 };
const FORMALITIES = new Set(['street', 'casual', 'vulgar']);
const KINDS = new Set(['word', 'clipped', 'phrase']);

/** Slurs that must never appear in any pack (ethnic, homophobic). */
const SLURS = ['maricón', 'marica', 'pato', 'cuero', 'prieto', 'sudaca', 'mariquita', 'tortillera'];

const forms = (p: RegisterPack) => p.entries.map((e) => e.norm);
const first = (xs: SlangEntry[]): SlangEntry => {
  const x = xs[0];
  if (!x) throw new Error('no entry');
  return x;
};

describe('SPANISH_REGISTERS', () => {
  it('has one pack per region in a fixed order', () => {
    expect(SPANISH_REGISTERS.map((p) => p.region)).toEqual(['CARIB', 'PR', 'DO', 'CU', 'CO']);
    expect(SPANISH_REGISTERS.map((p) => p.id)).toEqual(['es-CARIB', 'es-PR', 'es-DO', 'es-CU', 'es-CO']);
    expect(registerFor('PR')).toBe(PR_REGISTER);
    expect(registerFor('DO')).toBe(DO_REGISTER);
    expect(registerFor('CU')).toBe(CU_REGISTER);
    expect(registerFor('CO')).toBe(CO_REGISTER);
    expect(registerFor('CARIB')).toBe(CARIB_REGISTER);
    expect(registerFor('MX')).toBeUndefined();
  });

  for (const pack of SPANISH_REGISTERS) {
    describe(pack.id, () => {
      it(`has at least ${MIN_ENTRIES[pack.region]} entries`, () => {
        expect(pack.entries.length).toBeGreaterThanOrEqual(MIN_ENTRIES[pack.region] ?? 1);
      });

      it('has no duplicate norms', () => {
        const seen = new Set<string>();
        const dupes = forms(pack).filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
        expect(dupes).toEqual([]);
      });

      it('norm is the lowercase NFC form, accents and apostrophes kept', () => {
        for (const e of pack.entries) {
          expect(e.norm, e.form).toBe(e.form.normalize('NFC').toLowerCase());
          expect(e.norm, e.form).toBe(slangNorm(e.form));
          expect(e.norm).not.toMatch(/[’‘ʼ]/);
          expect(e.norm).not.toMatch(/[¡!¿?.,;:]/);
        }
      });

      it('every entry has gloss.en, neutral, lemma and valid regions', () => {
        for (const e of pack.entries) {
          expect(e.gloss.en?.trim(), e.form).toBeTruthy();
          expect(e.neutral.trim(), e.form).toBeTruthy();
          expect(e.lemma.trim(), e.form).toBeTruthy();
          expect(e.regions.length, e.form).toBeGreaterThan(0);
          for (const r of e.regions) expect(REGION_CODES, `${e.form} ${r}`).toContain(r);
          expect(e.regions, e.form).toContain(pack.region);
          expect(new Set(e.regions).size, e.form).toBe(e.regions.length);
        }
      });

      it('uses valid formality and kind; vulgar implies explicit', () => {
        for (const e of pack.entries) {
          expect(FORMALITIES.has(e.formality), e.form).toBe(true);
          expect(KINDS.has(e.kind), e.form).toBe(true);
          if (e.formality === 'vulgar') expect(e.explicit, e.form).toBe(true);
        }
      });

      it('multi-word entries are phrases and phrases have several words', () => {
        for (const e of pack.entries) {
          expect(e.kind === 'phrase', e.form).toBe(e.norm.includes(' '));
        }
      });

      it('slang differs from its neutral equivalent', () => {
        for (const e of pack.entries) expect(slangNorm(e.neutral), e.form).not.toBe(e.norm);
      });

      it('a slang lexeme is its own lemma (region-suffixed when the word is also a standard lemma)', () => {
        for (const e of pack.entries) {
          const suffixed = `${e.norm}@${pack.region}`;
          expect([e.norm, suffixed], e.form).toContain(e.lemma);
          // lng-8: a slang sense of a standard lemma gets its own lexeme.
          expect(lexiconRows(e.lemma), e.form).toEqual([]);
        }
      });

      it('marks exactly the forms that are also standard Spanish as alsoStandard (lng-3)', () => {
        for (const e of pack.entries) {
          const words = e.norm.split(' ');
          const standard = words.every((w) => analyze(w).length > 0);
          expect(e.alsoStandard === true, e.form).toBe(standard);
        }
      });

      it('contains no slurs', () => {
        for (const s of SLURS) expect(forms(pack)).not.toContain(s);
      });
    });
  }

  it('flags common explicit reggaeton terms', () => {
    const explicit = SPANISH_REGISTERS.flatMap((p) => p.entries.filter((e) => e.explicit).map((e) => e.norm));
    for (const w of ['bellaca', 'bicho', 'puñeta', 'pinga', 'singar', 'coño', 'chimba']) expect(explicit).toContain(w);
    // Not explicit: everyday slang.
    for (const w of ['janguear', 'corillo', 'pana', 'chévere', "pa'", 'perreo']) expect(explicit).not.toContain(w);
  });

  it('covers the clipped forms named in the brief', () => {
    const carib = forms(CARIB_REGISTER);
    for (const w of ["'tá", "pa'", "to'", "na'", "pa'lante", 'ná']) expect(carib).toContain(w);
    for (const e of CARIB_REGISTER.entries) expect(e.regions).toEqual([CARIB]);
  });

  it('maps clipped forms to their neutral equivalents', () => {
    const byNorm = new Map(CARIB_REGISTER.entries.map((e) => [e.norm, e]));
    expect(byNorm.get("'tá")?.neutral).toBe('está');
    expect(byNorm.get("pa'")?.neutral).toBe('para');
    expect(byNorm.get("to'")?.neutral).toBe('todo');
    expect(byNorm.get("na'")?.neutral).toBe('nada');
    expect(byNorm.get("pa'lante")?.neutral).toBe('adelante');
    expect(byNorm.get("'tá")?.kind).toBe('clipped');
  });
});

describe('slangNorm', () => {
  it('lowercases and keeps accents', () => {
    expect(slangNorm('Nítido')).toBe('nítido');
    expect(slangNorm('ZAFACÓN')).toBe('zafacón');
  });
  it('keeps clipped apostrophes and canonicalizes typographic ones', () => {
    expect(slangNorm("'tá")).toBe("'tá");
    expect(slangNorm('’Tá')).toBe("'tá");
    expect(slangNorm('pa’')).toBe("pa'");
    expect(slangNorm("Pa'lante")).toBe("pa'lante");
  });
  it('trims edge punctuation, unwraps quotes, collapses spaces', () => {
    expect(slangNorm("¿'tá?")).toBe("'tá");
    expect(slangNorm('¡Wepa!')).toBe('wepa');
    expect(slangNorm("'hola'")).toBe('hola');
    expect(slangNorm('  ¿Qué   lo  que?  ')).toBe('qué lo que');
  });
  it('composes decomposed accents', () => {
    expect(slangNorm('nítido'.normalize('NFD'))).toBe('nítido');
    expect(slangNorm('chévere'.normalize('NFD'))).toBe('chévere');
  });
  it('returns "" for empty or punctuation-only input', () => {
    expect(slangNorm('')).toBe('');
    expect(slangNorm('   ')).toBe('');
    expect(slangNorm('¡¿...?!')).toBe('');
    expect(slangNorm("'")).toBe('');
  });
});

describe('looseSlangKey', () => {
  it('drops accents and apostrophes but keeps ñ', () => {
    expect(looseSlangKey("'tá")).toBe('ta');
    expect(looseSlangKey("pa'")).toBe('pa');
    expect(looseSlangKey("pa'lante")).toBe('palante');
    expect(looseSlangKey('ñangotarse')).toBe('ñangotarse');
    expect(looseSlangKey('Ñangotarse'.normalize('NFD'))).toBe('ñangotarse');
    expect(looseSlangKey('revolú')).toBe('revolu');
  });
});

describe('expandRegions / inRegions', () => {
  it('no filter admits everything', () => {
    expect(expandRegions()).toBeUndefined();
    expect(expandRegions([])).toBeUndefined();
    expect(inRegions(first(findSlang('asere')), undefined)).toBe(true);
  });
  it('a Caribbean member admits CARIB entries', () => {
    expect([...(expandRegions(['PR']) ?? [])].sort()).toEqual(['CARIB', 'PR']);
    expect([...(expandRegions(['CARIB']) ?? [])]).toEqual(['CARIB']);
    expect([...(expandRegions(['MX']) ?? [])]).toEqual(['MX']);
  });
});

describe('findSlang', () => {
  it('finds exact norms', () => {
    expect(first(findSlang('janguear')).gloss.en).toMatch(/hang out/);
    expect(first(findSlang("'tá")).neutral).toBe('está');
    expect(first(findSlang("pa'")).neutral).toBe('para');
    expect(first(findSlang("pa'lante")).neutral).toBe('adelante');
  });

  it('accepts surface forms: capitals, typographic apostrophes, edge punctuation', () => {
    expect(first(findSlang("'Tá")).norm).toBe("'tá");
    expect(first(findSlang('’tá')).norm).toBe("'tá");
    expect(first(findSlang("¿'tá?")).norm).toBe("'tá");
    expect(first(findSlang('¡Wepa!')).norm).toBe('wepa');
    expect(first(findSlang("Pa'")).norm).toBe("pa'");
    expect(first(findSlang('Corillo,')).norm).toBe('corillo');
  });

  it('finds phrases', () => {
    expect(first(findSlang('qué lo que')).regions).toEqual(['DO']);
    expect(first(findSlang('¿Qué lo que?')).norm).toBe('qué lo que');
    expect(first(findSlang('qué bolá')).regions).toEqual(['CU']);
    expect(first(findSlang('ay bendito')).regions).toEqual(['PR']);
  });

  it('falls back to accent- and apostrophe-free matches', () => {
    expect(first(findSlang('ta')).norm).toBe("'tá");
    expect(first(findSlang('tá')).norm).toBe("'tá");
    expect(first(findSlang('pa')).norm).toBe("pa'");
    expect(first(findSlang('palante')).norm).toBe("pa'lante");
    expect(first(findSlang('nitido')).norm).toBe('nítido');
    expect(first(findSlang('zafacon')).norm).toBe('zafacón');
    expect(first(findSlang('que lo que')).norm).toBe('qué lo que');
  });

  it('returns exact matches before loose ones', () => {
    // "ná" is an exact norm; "na'" shares its loose key "na".
    const r = findSlang('ná');
    expect(r.map((e) => e.norm)).toEqual(['ná', "na'"]);
    const r2 = findSlang("na'");
    expect(r2.map((e) => e.norm)).toEqual(["na'", 'ná']);
    // "to'" and "tó" both mean todo.
    expect(findSlang('to').map((e) => e.neutral)).toEqual(['todo', 'todo']);
  });

  it('loose matching can be turned off', () => {
    expect(findSlang('ta', undefined, { loose: false })).toEqual([]);
    expect(findSlang('nitido', undefined, { loose: false })).toEqual([]);
    expect(findSlang("'tá", undefined, { loose: false })).toHaveLength(1);
    expect(DEFAULT_FIND_SLANG_OPTIONS.loose).toBe(true);
  });

  it('filters by region, admitting CARIB entries for member regions', () => {
    expect(findSlang('asere', ['PR'])).toEqual([]);
    expect(first(findSlang('asere', ['CU'])).norm).toBe('asere');
    expect(first(findSlang("'tá", ['PR'])).norm).toBe("'tá");
    expect(first(findSlang("'tá", ['CO'])).norm).toBe("'tá");
    expect(first(findSlang("'tá", ['CARIB'])).norm).toBe("'tá");
    expect(findSlang("'tá", ['MX'])).toEqual([]);
    expect(first(findSlang('guagua', ['DO'])).neutral).toBe('autobús');
    expect(first(findSlang('vaina', ['CO'])).neutral).toBe('cosa');
  });

  it('never defines one lemma in two packs (lng-8)', () => {
    const seen = new Map<string, string>();
    for (const p of SPANISH_REGISTERS) {
      for (const e of p.entries) {
        const other = seen.get(e.lemma);
        expect(other === undefined || other === p.id, `${e.lemma}: ${other} and ${p.id}`).toBe(true);
        seen.set(e.lemma, p.id);
      }
    }
    expect(CU_REGISTER.entries.find((e) => e.norm === 'fajarse')?.lemma).toBe('fajarse@CU');
  });

  it('keeps distinct regional meanings apart', () => {
    const all = findSlang('fajarse');
    expect(all.map((e) => e.regions[0]).sort()).toEqual(['CU', 'PR']);
    expect(first(findSlang('fajarse', ['PR'])).neutral).toBe('esforzarse');
    expect(first(findSlang('fajarse', ['CU'])).neutral).toBe('pelear');
    // "guapo" means angry in the Dominican Republic only.
    expect(first(findSlang('guapo')).neutral).toBe('enojado');
    expect(findSlang('guapo', ['PR'])).toEqual([]);
  });

  it('returns [] for unknown, empty or punctuation-only input', () => {
    expect(findSlang('mesa')).toEqual([]);
    expect(findSlang('xyzzy')).toEqual([]);
    expect(findSlang('')).toEqual([]);
    expect(findSlang('  ')).toEqual([]);
    expect(findSlang('¡¿?!')).toEqual([]);
    expect(findSlang("'")).toEqual([]);
  });

  it('searches the packs it is given', () => {
    const mini: RegisterPack[] = [{ id: 'x', region: 'PR', entries: [slang('PR', 'Wepa', 'bravo', 'yay')] }];
    expect(first(findSlang('wepa', undefined, { packs: mini })).form).toBe('Wepa');
    expect(findSlang('asere', undefined, { packs: mini })).toEqual([]);
  });
});

describe('slang builder', () => {
  it('derives norm and lemma and defaults explicit from formality', () => {
    const e = slang('PR', "Pa'", 'para', 'for', { formality: 'casual', kind: 'clipped' });
    expect(e).toMatchObject({ norm: "pa'", lemma: "pa'", regions: ['PR'], explicit: false, kind: 'clipped' });
    expect(slang('PR', 'x', 'y', 'z', { formality: 'vulgar' }).explicit).toBe(true);
    expect(slang('PR', 'x', 'y', 'z').formality).toBe('street');
    expect(slang('PR', 'x', 'y', 'z', { lemma: 'w', regions: ['PR', 'DO'] })).toMatchObject({ lemma: 'w', regions: ['PR', 'DO'] });
  });
  it('carries a part of speech only when given', () => {
    expect(slang('PR', 'gufear', 'bromear', 'to goof around', { pos: 'VERB' }).pos).toBe('VERB');
    expect('pos' in slang('PR', 'janguear', 'salir', 'to hang out')).toBe(false);
  });
});
