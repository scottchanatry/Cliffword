import { describe, expect, it } from 'vitest';
import type { RegisterPack } from '../../lang/types';
import type { PairPack } from '../types';
import { COGNATES, createEnEsPairPack, DEFAULT_EN_ES_OPTIONS, EXPLANATION_KEYS, slangGlossIndex } from './index';

/** Explain keys used by the Spanish correction rules (stub of the rules module's list). */
const RULE_EXPLAIN_KEYS = [
  'es.ser_estar', 'es.por_para', 'es.gender', 'es.number', 'es.aspect', 'es.mood', 'es.personal_a', 'es.article',
  'es.pronoun_placement', 'es.negative_command', 'es.pronoun_order', 'es.se_lo',
  'es.verb_agreement', 'es.contraction', 'es.body_article', 'es.pronoun_double',
];

const STUB_REGISTERS: RegisterPack[] = [
  {
    id: 'es-X',
    region: 'PR',
    entries: [
      {
        form: 'Wepa', norm: 'wepa', neutral: 'bravo', lemma: 'wepa', gloss: { en: 'woo-hoo!' },
        regions: ['PR'], formality: 'casual', explicit: false, kind: 'word',
      },
      {
        form: 'casa', norm: 'casa', neutral: 'hogar', lemma: 'casa', gloss: { en: 'SLANG HOUSE' },
        regions: ['PR'], formality: 'casual', explicit: false, kind: 'word',
      },
    ],
  },
];

describe('createEnEsPairPack', () => {
  const pack: PairPack = createEnEsPairPack();

  it('satisfies the PairPack interface for English speakers learning Spanish', () => {
    expect(pack.native).toBe('en');
    expect(pack.target).toBe('es');
    expect(typeof pack.gloss).toBe('function');
    expect(typeof pack.toTarget).toBe('function');
    expect(pack.cognates).toBeInstanceOf(Set);
    expect(pack.nativeLexicon).toBeInstanceOf(Set);
    expect(pack.cognates.size).toBeGreaterThanOrEqual(300);
    expect(pack.nativeLexicon.size).toBeGreaterThanOrEqual(1500);
    expect(Object.keys(pack.ui).length).toBeGreaterThanOrEqual(40);
  });

  it('carries false-friend warnings keyed by Spanish lemma', () => {
    expect(pack.falseFriends?.['embarazada']).toMatch(/pregnant/);
    expect(pack.falseFriends?.['librería']).toMatch(/bookstore/);
    for (const lemma of Object.keys(pack.falseFriends ?? {})) expect(pack.cognates.has(lemma), lemma).toBe(false);
  });

  it('marks cognates as probably known', () => {
    expect(pack.cognates.has('hospital')).toBe(true);
    expect(pack.cognates.has('importante')).toBe(true);
    expect(pack.cognates.has('embarazada')).toBe(false);
    expect(pack.cognates.has('perro')).toBe(false);
    expect(pack.cognates.size).toBe(COGNATES.length);
  });

  it('spots English words but never common Spanish ones', () => {
    for (const w of ['beach', 'the', 'want', "don't"]) expect(pack.nativeLexicon.has(w), w).toBe(true);
    for (const w of ['no', 'me', 'a', 'come', 'son', 'red', 'hotel', 'plan', 'pa', 'ta']) {
      expect(pack.nativeLexicon.has(w), w).toBe(false);
    }
  });

  it('glosses standard lemmas', () => {
    expect(pack.gloss('perro')).toBe('dog');
    expect(pack.gloss('Perro')).toBe('dog');
    expect(pack.gloss('xyzzy')).toBeUndefined();
    expect(pack.gloss('')).toBeUndefined();
    expect(pack.gloss('¡!')).toBeUndefined();
  });

  it('falls back to slang glosses for slang lemmas and clipped forms', () => {
    expect(pack.gloss('janguear')).toMatch(/hang out/);
    expect(pack.gloss("'tá")).toMatch(/is/);
    expect(pack.gloss('’tá')).toMatch(/is/);
    expect(pack.gloss("Pa'")).toMatch(/for/);
    expect(pack.gloss("pa'lante")).toMatch(/forward/);
    expect(pack.gloss('asere')).toMatch(/buddy/);
    // A standard gloss wins over a slang one.
    expect(pack.gloss('vaina')).toMatch(/thing/);
    expect(pack.gloss('guapo')).toBe('good-looking');
  });

  it('can use other register packs, or none', () => {
    const custom = createEnEsPairPack({ registers: STUB_REGISTERS });
    expect(custom.gloss('wepa')).toBe('woo-hoo!');
    expect(custom.gloss('janguear')).toBeUndefined();
    expect(custom.gloss('casa')).toMatch(/house, home/);
    const none = createEnEsPairPack({ registers: [] });
    expect(none.gloss("'tá")).toBeUndefined();
    expect(none.gloss('perro')).toBe('dog');
    expect(DEFAULT_EN_ES_OPTIONS.registers.length).toBe(5);
  });

  it('maps English words to Spanish lemmas', () => {
    expect(pack.toTarget('beach')).toEqual(['playa']);
    expect(pack.toTarget('Went')).toEqual(['ir']);
    expect(pack.toTarget('unknownword')).toEqual([]);
    expect(pack.toTarget('')).toEqual([]);
  });

  it('explains every key the Spanish rules use, and nothing else', () => {
    expect(Object.keys(pack.explanations).sort()).toEqual([...RULE_EXPLAIN_KEYS].sort());
    expect([...EXPLANATION_KEYS].sort()).toEqual([...RULE_EXPLAIN_KEYS].sort());
    for (const k of RULE_EXPLAIN_KEYS) expect(pack.explanations[k]?.length, k).toBeGreaterThan(20);
  });

  it('returns frozen tables and fresh sets, so callers cannot affect each other', () => {
    expect(Object.isFrozen(pack.explanations)).toBe(true);
    expect(Object.isFrozen(pack.ui)).toBe(true);
    const a = createEnEsPairPack();
    const b = createEnEsPairPack();
    expect(a.cognates).not.toBe(b.cognates);
    (a.cognates as Set<string>).add('zzz');
    expect(b.cognates.has('zzz')).toBe(false);
  });
});

describe('slangGlossIndex', () => {
  it('indexes by lemma and norm, first entry wins', () => {
    const idx = slangGlossIndex(STUB_REGISTERS);
    expect(idx.get('wepa')).toBe('woo-hoo!');
    expect(idx.get('casa')).toBe('SLANG HOUSE');
    expect(slangGlossIndex([]).size).toBe(0);
  });
});
