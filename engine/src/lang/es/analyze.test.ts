import { describe, expect, it } from 'vitest';
import type { Analysis, Features, RegisterPack, SlangEntry } from '../types';
import { analyze, cliticSplits, createAnalyzer } from './analyze';
import { inflect, paradigm } from './inflect';
import { LEMMAS_BY_FREQUENCY, lexiconRows } from './lexicon';

const has = (list: Analysis[], lemma: string, features?: Features) =>
  list.some((a) => a.lemma === lemma && (!features || sameFeatures(a.features, features)));

function sameFeatures(a: Features, b: Features): boolean {
  const ka = Object.entries(a).filter(([, v]) => v).sort();
  const kb = Object.entries(b).filter(([, v]) => v).sort();
  return JSON.stringify(ka) === JSON.stringify(kb);
}

const fin = (mood: string, tense: string, person: string, number: string): Features => ({ form: 'fin', mood, tense, person, number });
const IMP_2S: Features = { form: 'fin', mood: 'imp', person: '2', number: 's' };

describe('analyze: verbs', () => {
  it('estoy', () => {
    expect(analyze('estoy')).toEqual([{ lemma: 'estar', pos: 'VERB', features: fin('ind', 'pres', '1', 's') }]);
  });
  it('fui is ser and ir, ser first (more frequent)', () => {
    const a = analyze('fui');
    expect(a.map((x) => x.lemma)).toEqual(['ser', 'ir']);
    expect(has(a, 'ir', fin('ind', 'pret', '1', 's'))).toBe(true);
  });
  it('ambiguous person gives several analyses of one lemma', () => {
    const a = analyze('hablaba');
    expect(has(a, 'hablar', fin('ind', 'impf', '1', 's'))).toBe(true);
    expect(has(a, 'hablar', fin('ind', 'impf', '3', 's'))).toBe(true);
  });
  it('irregular forms', () => {
    expect(has(analyze('hizo'), 'hacer', fin('ind', 'pret', '3', 's'))).toBe(true);
    expect(has(analyze('tuvieron'), 'tener', fin('ind', 'pret', '3', 'p'))).toBe(true);
    expect(has(analyze('vaya'), 'ir', fin('sub', 'pres', '3', 's'))).toBe(true);
    expect(has(analyze('hubiera'), 'haber', fin('sub', 'impf', '1', 's'))).toBe(true);
    expect(has(analyze('hay'), 'haber', fin('ind', 'pres', '3', 's'))).toBe(true);
    expect(has(analyze('oyó'), 'oír', fin('ind', 'pret', '3', 's'))).toBe(true);
    expect(has(analyze('sé'), 'saber', fin('ind', 'pres', '1', 's'))).toBe(true);
    expect(has(analyze('sé'), 'ser', IMP_2S)).toBe(true);
  });
  it('participles agree', () => {
    expect(has(analyze('hechas'), 'hacer', { form: 'part', gender: 'f', number: 'p' })).toBe(true);
  });
  it('accent-insensitive fallback: missing and extra accents', () => {
    expect(has(analyze('estan'), 'estar', fin('ind', 'pres', '3', 'p'))).toBe(true);
    expect(has(analyze('comio'), 'comer', fin('ind', 'pret', '3', 's'))).toBe(true);
    expect(has(analyze('arbol'), 'árbol')).toBe(true);
    expect(has(analyze('cancion'), 'canción')).toBe(true);
  });
  it('accentless "esta" is the determiner, "está" is estar', () => {
    const esta = analyze('esta');
    expect(esta[0]).toEqual({ lemma: 'este', pos: 'DET', features: { gender: 'f', number: 's' } });
    expect(has(esta, 'estar')).toBe(false);
    const está = analyze('está');
    expect(está[0]).toEqual({ lemma: 'estar', pos: 'VERB', features: fin('ind', 'pres', '3', 's') });
    expect(has(está, 'este')).toBe(false);
  });
  it('an exact accented word is not folded into its unaccented homograph', () => {
    expect(analyze('té')[0]).toMatchObject({ lemma: 'té', pos: 'NOUN' });
    expect(analyze('te')[0]).toMatchObject({ lemma: 'te', pos: 'PRON' });
  });
  it('ñ is not confused with n', () => {
    expect(has(analyze('año'), 'año')).toBe(true);
    expect(has(analyze('ano'), 'año')).toBe(false);
  });
});

describe('analyze: enclitic pronouns', () => {
  it('leerla -> leer infinitive', () => {
    expect(analyze('leerla')).toEqual([{ lemma: 'leer', pos: 'VERB', features: { form: 'inf' } }]);
  });
  it('dámelo -> dar imperative (accent from clitics removed)', () => {
    expect(analyze('dámelo')).toEqual([{ lemma: 'dar', pos: 'VERB', features: IMP_2S }]);
    expect(analyze('damelo')).toEqual([{ lemma: 'dar', pos: 'VERB', features: IMP_2S }]);
  });
  it('comiéndolo -> comer gerund', () => {
    expect(analyze('comiéndolo')).toEqual([{ lemma: 'comer', pos: 'VERB', features: { form: 'ger' } }]);
  });
  it('more clitic hosts', () => {
    expect(has(analyze('dime'), 'decir', IMP_2S)).toBe(true);
    expect(has(analyze('dime'), 'dar')).toBe(false); // "di" as dar preterite cannot host a clitic
    expect(has(analyze('hazlo'), 'hacer', IMP_2S)).toBe(true);
    expect(has(analyze('vete'), 'ir', IMP_2S)).toBe(true);
    expect(has(analyze('dándoselo'), 'dar', { form: 'ger' })).toBe(true);
    expect(has(analyze('decírselo'), 'decir', { form: 'inf' })).toBe(true);
    expect(has(analyze('oírlo'), 'oír', { form: 'inf' })).toBe(true);
    expect(has(analyze('cállate'), 'callar', IMP_2S)).toBe(true);
  });
  it('usted and nosotros commands', () => {
    expect(has(analyze('dígame'), 'decir', fin('sub', 'pres', '3', 's'))).toBe(true);
    expect(has(analyze('sentémonos'), 'sentar', fin('sub', 'pres', '1', 'p'))).toBe(true);
    expect(has(analyze('vámonos'), 'ir')).toBe(true);
  });
  it('siéntate is sentar imperative, not a sentir usted command', () => {
    const a = analyze('siéntate');
    expect(has(a, 'sentar', IMP_2S)).toBe(true);
    expect(has(a, 'sentir')).toBe(false);
  });
  it('exact words are never split into verb + clitic', () => {
    expect(analyze('mesa').every((a) => a.lemma === 'mesa')).toBe(true);
  });
  it('cliticSplits enumerates up to two clitics', () => {
    expect(cliticSplits('dámelo')).toEqual([['dáme', ['lo']], ['dá', ['me', 'lo']]]);
    expect(cliticSplits('dámelo', 1)).toEqual([['dáme', ['lo']]]);
    expect(cliticSplits('me')).toEqual([]);
  });
});

describe('analyze: nominal forms', () => {
  it('cansadas -> cansado ADJ f.p first, then cansar participle', () => {
    const a = analyze('cansadas');
    expect(a[0]).toEqual({ lemma: 'cansado', pos: 'ADJ', features: { gender: 'f', number: 'p' } });
    expect(has(a, 'cansar', { form: 'part', gender: 'f', number: 'p' })).toBe(true);
  });
  it('nouns', () => {
    expect(analyze('niña')).toEqual([{ lemma: 'niño', pos: 'NOUN', features: { gender: 'f', number: 's' } }]);
    expect(has(analyze('jóvenes'), 'joven', { gender: 'f', number: 'p' })).toBe(true);
    expect(has(analyze('países'), 'país', { gender: 'm', number: 'p' })).toBe(true);
    expect(has(analyze('luces'), 'luz', { gender: 'f', number: 'p' })).toBe(true);
  });
  it('determiners and pronouns', () => {
    expect(has(analyze('la'), 'el', { gender: 'f', number: 's' })).toBe(true);
    expect(has(analyze('la'), 'lo', { person: '3', gender: 'f', number: 's' })).toBe(true);
    expect(analyze('la')[0]?.pos).toBe('DET');
    expect(has(analyze('ellas'), 'ellos', { person: '3', number: 'p', gender: 'f' })).toBe(true);
    expect(has(analyze('buen'), 'bueno', { gender: 'm', number: 's' })).toBe(true);
    expect(has(analyze('algún'), 'alguno', { gender: 'm', number: 's' })).toBe(true);
  });
  it('accent distinguishes homographs', () => {
    expect(analyze('él')[0]?.lemma).toBe('él');
    expect(analyze('el')[0]?.lemma).toBe('el');
    expect(analyze('tú')[0]?.pos).toBe('PRON');
    expect(analyze('tu')[0]?.pos).toBe('DET');
    expect(analyze('qué')[0]?.lemma).toBe('qué');
    expect(analyze('que')[0]?.lemma).toBe('que');
  });
});

describe('analyze: edge cases', () => {
  it('empty and punctuation-only input', () => {
    expect(analyze('')).toEqual([]);
    expect(analyze('¿?')).toEqual([]);
    expect(analyze('...')).toEqual([]);
  });
  it('unknown words', () => {
    expect(analyze('xyzzy')).toEqual([]);
    expect(analyze('qwertyuiop')).toEqual([]);
  });
  it('capitalized sentence starts and edge punctuation are normalized', () => {
    expect(has(analyze('Estoy'), 'estar')).toBe(true);
    expect(has(analyze('¡Hola!'), 'hola')).toBe(true);
    expect(has(analyze('ESTÁ'), 'estar')).toBe(true);
  });
  it('clipped forms are unknown without register packs', () => {
    expect(analyze("'tá")).toEqual([]);
    expect(analyze("pa'")).toEqual([]);
  });
  it('returns fresh objects (callers may mutate them)', () => {
    const a = analyze('estoy');
    (a[0] as Analysis).features.tense = 'x';
    expect(analyze('estoy')[0]?.features.tense).toBe('pres');
  });
});

function entry(form: string, neutral: string, lemma: string, kind: SlangEntry['kind'], gloss: string): SlangEntry {
  return {
    form, norm: form.toLowerCase().replace(/’/g, "'"), neutral, lemma, gloss: { en: gloss }, regions: ['PR'],
    formality: 'street', explicit: false, kind,
  };
}

/** A tiny stand-in for a real register pack (owned by another module). */
const PR_STUB: RegisterPack = {
  id: 'es-PR', region: 'PR',
  entries: [
    entry("'tá", 'está', "'tá", 'clipped', 'is'),
    entry("pa'", 'para', "pa'", 'clipped', 'for'),
    entry('janguear', 'salir', 'janguear', 'word', 'to hang out'),
    entry('corillo', 'grupo', 'corillo', 'word', 'group of friends'),
    entry('vaina', 'cosa', 'vaina', 'word', 'thing'),
    entry('chévere', 'bueno', 'chévere', 'word', 'cool'),
  ],
};

describe('analyze with register packs', () => {
  const slang = createAnalyzer([PR_STUB]);
  it('clipped forms analyze to the slang lemma with the neutral pos and features', () => {
    expect(slang("'tá")).toEqual([{ lemma: "'tá", pos: 'VERB', features: fin('ind', 'pres', '3', 's') }]);
    expect(slang("pa'")).toEqual([{ lemma: "pa'", pos: 'ADP', features: {} }]);
  });
  it('slang verbs conjugate and slang nouns inflect', () => {
    expect(slang('janguear')[0]).toMatchObject({ lemma: 'janguear', pos: 'VERB', features: { form: 'inf' } });
    expect(has(slang('jangueamos'), 'janguear', fin('ind', 'pres', '1', 'p'))).toBe(true);
    expect(has(slang('corillos'), 'corillo', { gender: 'm', number: 'p' })).toBe(true);
    expect(has(slang('chéveres'), 'chévere', { gender: 'm', number: 'p' })).toBe(true);
  });
  it('standard analyses come first and duplicates are merged', () => {
    const a = slang('vaina');
    expect(a).toEqual([{ lemma: 'vaina', pos: 'NOUN', features: { gender: 'f', number: 's' } }]);
  });
  it('accent-insensitive fallback also covers slang', () => {
    expect(has(slang("'ta"), "'tá")).toBe(true);
  });
  it('does not change standard analysis', () => {
    expect(slang('estoy')).toEqual(analyze('estoy'));
    expect(analyze('janguear')).toEqual([]);
  });
  it("uses the entry's own pos when the neutral word cannot supply it", () => {
    const entry = (form: string, neutral: string, pos?: SlangEntry['pos']): SlangEntry => {
      const e: SlangEntry = { form, norm: form, neutral, lemma: form, gloss: { en: '' }, regions: ['PR'], formality: 'casual', explicit: false, kind: 'word' };
      if (pos) e.pos = pos;
      return e;
    };
    const reg: RegisterPack = {
      id: 'es-XX',
      region: 'PR',
      entries: [entry('gufear', 'bromear', 'VERB'), entry('jartera', 'hartura', 'NOUN'), entry('lucas', 'miles', 'NOUN'), entry('charro', 'cursi')],
    };
    const a = createAnalyzer([reg]);
    expect(a('gufear')[0]).toMatchObject({ lemma: 'gufear', pos: 'VERB', features: { form: 'inf' } });
    expect(has(a('gufeamos'), 'gufear', fin('ind', 'pres', '1', 'p'))).toBe(true);
    expect(a('jartera')[0]).toMatchObject({ lemma: 'jartera', pos: 'NOUN', features: { gender: 'f', number: 's' } });
    expect(has(a('jarteras'), 'jartera', { gender: 'f', number: 'p' })).toBe(true);
    expect(a('lucas')[0]).toMatchObject({ pos: 'NOUN', features: { gender: 'f', number: 'p' } });
    // Without a pos, a neutral word outside the lexicon gives X, as before.
    expect(a('charro')[0]?.pos).toBe('X');
  });
});

describe('round trip: analyze(inflect(lemma, f)) contains lemma with f', () => {
  const sample = LEMMAS_BY_FREQUENCY.filter((_, i) => i % 4 === 0);
  const required = `ser estar ir haber tener hacer poder decir ver dar saber querer poner venir salir oír traer
    caer conocer conducir traducir producir leer creer caber valer andar sentir dormir morir pedir seguir elegir
    jugar empezar pensar volver encontrar contar preferir`.trim().split(/\s+/);
  const lemmas = [...new Set([...sample, ...required])];
  it(`holds for every form of ${lemmas.length} lemmas`, () => {
    const failures: string[] = [];
    let checked = 0;
    for (const lemma of lemmas) {
      for (const [l, pos, gender] of lexiconRows(lemma)) {
        for (const e of paradigm(l, pos, gender)) {
          if (e.alt) continue;
          const surface = inflect(lemma, e.features);
          if (surface === undefined) {
            failures.push(`${lemma} ${JSON.stringify(e.features)} -> undefined`);
            continue;
          }
          checked++;
          if (!has(analyze(surface), lemma, e.features)) failures.push(`${lemma} ${JSON.stringify(e.features)} -> ${surface}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(5000);
  });
});

describe('-se imperfect subjunctive (lng-7)', () => {
  it('analyzes the -se forms like the -ra forms', () => {
    const cases: Array<[string, string]> = [
      ['fuese', 'ser'], ['tuviese', 'tener'], ['pudiese', 'poder'], ['hiciese', 'hacer'],
      ['estuviese', 'estar'], ['dijese', 'decir'], ['quisiese', 'querer'], ['hablase', 'hablar'],
    ];
    for (const [form, lemma] of cases) {
      const a = analyze(form).find((x) => x.lemma === lemma);
      expect(a?.features, form).toMatchObject({ mood: 'sub', tense: 'impf' });
    }
    expect(analyze('hablase').some((x) => x.features.mood === 'imp')).toBe(false);
  });
});

describe('clitic gaps (lng-9)', () => {
  it('analyzes usted commands of dar with clitics (deme, dele)', () => {
    for (const w of ['deme', 'dele', 'démelo']) {
      expect(analyze(w).map((a) => a.lemma), w).toContain('dar');
    }
  });

  it('keeps the standard clitic reading of a word that is also a slang entry', () => {
    const reg: RegisterPack = {
      id: 'x', region: 'DO',
      entries: [{ form: 'dímelo', norm: 'dímelo', neutral: 'hola', lemma: 'dímelo', gloss: { en: 'hi' }, regions: ['DO'], formality: 'casual', explicit: false, kind: 'word', pos: 'INTJ' }],
    };
    const an = createAnalyzer([reg]);
    const lemmas = an('dímelo').map((a) => a.lemma);
    expect(lemmas[0]).toBe('decir');
    expect(lemmas).toContain('dímelo');
  });
});
