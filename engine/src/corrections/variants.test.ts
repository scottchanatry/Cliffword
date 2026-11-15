import { describe, expect, it } from 'vitest';
import type { CorrectionRule, InflectRule, InsertRule, SwapRule } from '../lang/types';
import {
  ARTICLE_DELETE_RULE,
  ARTICLE_INSERT_RULES,
  GENDER_RULE,
  MOOD_RULE,
  NUMBER_RULE,
  PERSONAL_A_DELETE_RULE,
  PERSONAL_A_INSERT_RULE,
  POR_PARA_RULE,
  SER_ESTAR_RULE,
  SPANISH_RULES,
} from '../lang/es/rules';
import { TEST_REGISTERS, createTestPack, testSegment } from './testPack';
import {
  capitalizeFirst,
  generateVariantSet,
  generateVariants,
  isAllCaps,
  lowercaseFirst,
  matchCase,
  slangWordIndices,
  startsUpper,
} from './variants';
import type { Variant } from './variants';

const full = createTestPack({ rules: SPANISH_RULES });

function texts(vs: readonly Variant[]): string[] {
  return vs.map((v) => v.text);
}

/** Every variant must rebuild from its span and replacement. */
function expectWellFormed(original: string, vs: readonly Variant[]): void {
  for (const v of vs) {
    expect(v.start).toBeGreaterThanOrEqual(0);
    expect(v.end).toBeGreaterThanOrEqual(v.start);
    expect(v.end).toBeLessThanOrEqual(original.length);
    expect(original.slice(v.start, v.end)).toBe(v.original);
    expect(original.slice(0, v.start) + v.replacement + original.slice(v.end)).toBe(v.text);
    expect(v.text).not.toBe(original);
  }
}

/** Character spans of the words with these norms in `text`. */
function spansOf(text: string, norms: readonly string[]): Array<[number, number]> {
  return testSegment(text)
    .filter((s) => s.kind === 'word' && norms.includes(s.norm))
    .map((s) => [s.start, s.end]);
}

function overlaps(v: Variant, [s, e]: [number, number]): boolean {
  if (v.start === v.end) return v.start > s && v.start < e;
  return v.start < e && s < v.end;
}

describe('case helpers', () => {
  it('detects and applies capitalization patterns', () => {
    expect(startsUpper('Soy')).toBe(true);
    expect(startsUpper('soy')).toBe(false);
    expect(startsUpper("'Tá")).toBe(true);
    expect(startsUpper('')).toBe(false);
    expect(isAllCaps('SOY')).toBe(true);
    expect(isAllCaps('A')).toBe(false);
    expect(isAllCaps('Soy')).toBe(false);
    expect(capitalizeFirst('estoy')).toBe('Estoy');
    expect(capitalizeFirst('él')).toBe('Él');
    expect(capitalizeFirst("'tá")).toBe("'Tá");
    expect(capitalizeFirst('')).toBe('');
    expect(lowercaseFirst('Gente')).toBe('gente');
    expect(matchCase('Soy', 'estoy')).toBe('Estoy');
    expect(matchCase('SOY', 'estoy')).toBe('ESTOY');
    expect(matchCase('soy', 'estoy')).toBe('estoy');
    expect(matchCase('Eres', 'estás')).toBe('Estás');
    expect(matchCase('ERES', 'estás')).toBe('ESTÁS');
  });
});

describe('generateVariants: empty and degenerate input', () => {
  it('returns nothing for empty, whitespace-only and punctuation-only text', () => {
    for (const t of ['', '   ', '...', '¡¿?!', ' , ; ', '123']) {
      const set = generateVariantSet(full, t);
      expect(set.variants, JSON.stringify(t)).toEqual([]);
      expect(set.dropped).toBe(0);
      expect(set.generated).toBe(0);
    }
  });

  it('returns nothing when the pack has no rules', () => {
    expect(generateVariants(createTestPack(), 'Soy cansado.')).toEqual([]);
  });

  it('leaves unknown words alone but still edits known ones', () => {
    const vs = generateVariants(full, 'Soy zorblax.');
    // No subjunctive "Sea": the mood rule changes an indicative only after a cue (que...).
    expect(texts(vs)).toEqual(['Estoy zorblax.']);
    expectWellFormed('Soy zorblax.', vs);
    for (const v of vs) expect(v.wordIndex).toBe(0);
  });

  it('is deterministic', () => {
    const a = generateVariantSet(full, 'La casa blanco es bonita.');
    const b = generateVariantSet(full, 'La casa blanco es bonita.');
    expect(a).toEqual(b);
  });
});

describe('generateVariants: swaps', () => {
  const pack = createTestPack({ rules: [SER_ESTAR_RULE, POR_PARA_RULE] });

  it('swaps ser for estar with span, original and replacement', () => {
    const vs = generateVariants(pack, 'Soy cansado.');
    expect(vs).toEqual([
      {
        text: 'Estoy cansado.',
        ruleId: 'es.ser_estar',
        explainKey: 'es.ser_estar',
        kind: 'swap',
        start: 0,
        end: 3,
        original: 'Soy',
        replacement: 'Estoy',
        wordIndex: 0,
      },
    ]);
  });

  it('preserves capitalization: sentence start, lowercase, all caps', () => {
    expect(texts(generateVariants(pack, 'Soy cansado.'))).toEqual(['Estoy cansado.']);
    expect(texts(generateVariants(pack, 'Hoy soy contento.'))).toEqual(['Hoy estoy contento.']);
    expect(texts(generateVariants(pack, 'SOY CANSADO.'))).toEqual(['ESTOY CANSADO.']);
    expect(texts(generateVariants(pack, 'Para la comida.'))).toEqual(['Por la comida.']);
    expect(texts(generateVariants(pack, 'Eres alto.'))).toEqual(['Estás alto.']);
  });

  it('swaps in both directions and keeps accents on replacements', () => {
    expect(texts(generateVariants(pack, 'Ella está alta.'))).toEqual(['Ella es alta.']);
    expect(texts(generateVariants(pack, 'Ella es alta.'))).toEqual(['Ella está alta.']);
    expect(texts(generateVariants(pack, 'Seremos amigos.'))).toEqual(['Estaremos amigos.']);
  });

  it('treats accents as significant: "esta" (this) is not "está"', () => {
    expect(generateVariants(pack, 'Ella esta cansada.')).toEqual([]);
    expect(generateVariants(pack, 'Estas cansado.')).toEqual([]);
  });

  it('proposes one variant per swappable word, left to right', () => {
    const t = 'Soy feliz por ti y es para mi.';
    const vs = generateVariants(pack, t);
    expect(texts(vs)).toEqual([
      'Estoy feliz por ti y es para mi.',
      'Soy feliz por ti y está para mi.',
      'Soy feliz para ti y es para mi.',
      'Soy feliz por ti y es por mi.',
    ]);
    expectWellFormed(t, vs);
    expect(vs.map((v) => v.wordIndex)).toEqual([0, 5, 2, 6]);
  });

  it('handles groups with more than two members', () => {
    const three: SwapRule = { id: 't.three', kind: 'swap', explainKey: 'es.por_para', groups: [['por', 'para', 'pa']] };
    const vs = generateVariants(createTestPack({ rules: [three], registers: [] }), 'Gracias por todo.');
    expect(texts(vs)).toEqual(['Gracias para todo.', 'Gracias pa todo.']);
  });
});

describe('generateVariants: inflections', () => {
  it('re-inflects gender on adjectives and determiners', () => {
    const pack = createTestPack({ rules: [GENDER_RULE] });
    const t = 'La casa blanco es bonita.';
    const vs = generateVariants(pack, t);
    expect(texts(vs)).toEqual(['El casa blanco es bonita.', 'La casa blanca es bonita.', 'La casa blanco es bonito.']);
    expectWellFormed(t, vs);
  });

  it('re-inflects number on nouns too and skips invariant forms', () => {
    const pack = createTestPack({ rules: [GENDER_RULE, NUMBER_RULE] });
    const vs = generateVariants(pack, 'La mesa grande.');
    // "grande" has no gender, so only its number changes.
    expect(texts(vs)).toEqual(['El mesa grande.', 'Las mesa grande.', 'La mesas grande.', 'La mesa grandes.']);
  });

  it('re-inflects mood and aspect on verbs, keeping person and tense', () => {
    const pack = createTestPack({ rules: SPANISH_RULES.filter((r) => r.id === 'es.aspect' || r.id === 'es.mood') });
    // The main verb "Quiero" has no subjunctive cue before it, so it is left alone.
    expect(texts(generateVariants(pack, 'Quiero que vienes.'))).toEqual(['Quiero que vengas.']);
    expect(texts(generateVariants(pack, 'Quiero comida.'))).toEqual([]);
    // A subjunctive always gets the indicative, cue or not.
    expect(texts(generateVariants(pack, 'Vengas mañana.'))).toEqual(['Vienes mañana.']);
    expect(texts(generateVariants(pack, 'Ayer comía en casa.'))).toEqual(['Ayer comí en casa.']);
    // "era" and "vivía" are both first and third person: each reading gets its preterite.
    // The two subjunctive readings of "vivía" give the same "viviera" once.
    expect(texts(generateVariants(pack, 'Cuando era niño vivía allí.'))).toEqual([
      'Cuando fui niño vivía allí.',
      'Cuando fue niño vivía allí.',
      'Cuando era niño viví allí.',
      'Cuando era niño vivió allí.',
      'Cuando era niño viviera allí.',
    ]);
  });

  it('keeps capitalization when re-inflecting', () => {
    const pack = createTestPack({ rules: [GENDER_RULE] });
    expect(texts(generateVariants(pack, 'La casa.'))).toEqual(['El casa.']);
    expect(texts(generateVariants(pack, 'LA CASA.'))).toEqual(['EL CASA.']);
  });

  it('ignores words whose analysis lacks the feature or whose POS is not listed', () => {
    const pack = createTestPack({ rules: [GENDER_RULE] });
    expect(generateVariants(pack, 'Muy grande.')).toEqual([]);
    expect(generateVariants(pack, 'Veo a Marta.')).toEqual([]);
  });
});

describe('generateVariants: inserts', () => {
  const personalA = createTestPack({ rules: [PERSONAL_A_INSERT_RULE] });

  it('inserts personal a between a verb and a proper noun', () => {
    const t = 'Veo Marta.';
    const vs = generateVariants(personalA, t);
    expect(vs).toEqual([
      {
        text: 'Veo a Marta.',
        ruleId: 'es.personal_a.insert',
        explainKey: 'es.personal_a',
        kind: 'insert',
        start: 4,
        end: 4,
        original: '',
        replacement: 'a ',
        wordIndex: 1,
      },
    ]);
  });

  it('does not insert after punctuation, at the start, next to the same word, or before non-matching POS', () => {
    expect(generateVariants(personalA, 'Veo, Marta.')).toEqual([]);
    expect(generateVariants(personalA, 'Marta llegó.')).toEqual([]);
    expect(generateVariants(personalA, 'Veo a Marta.')).toEqual([]);
    expect(generateVariants(personalA, 'Veo casa.')).toEqual([]);
    expect(generateVariants(personalA, 'Veo zorblax.')).toEqual([]);
  });

  it('reuses the spacing already in front of the word', () => {
    expect(texts(generateVariants(personalA, 'Veo  Marta.'))).toEqual(['Veo  a  Marta.']);
    expect(texts(generateVariants(personalA, 'Veo\tMarta.'))).toEqual(['Veo\ta\tMarta.']);
  });

  it('inserts articles that agree with the noun after a verb or preposition', () => {
    const pack = createTestPack({ rules: [...ARTICLE_INSERT_RULES] });
    expect(texts(generateVariants(pack, 'Compro pan.'))).toEqual(['Compro el pan.', 'Compro un pan.']);
    expect(texts(generateVariants(pack, 'Gracias por comida.'))).toEqual([
      'Gracias por la comida.',
      'Gracias por una comida.',
    ]);
    // After a determiner nothing is inserted (no "la la casa").
    expect(generateVariants(pack, 'Veo la casa.')).toEqual([]);
  });

  it('inserts every article when agreement filtering is off', () => {
    const pack = createTestPack({ rules: [...ARTICLE_INSERT_RULES] });
    expect(generateVariants(pack, 'Compro pan.', { agreeInserted: false })).toHaveLength(6);
  });

  it('moves the capital to an inserted sentence-initial word, except before proper nouns', () => {
    const anyLa: InsertRule = { id: 't.la', kind: 'insert', explainKey: 'es.article', word: 'la', beforePos: ['NOUN'] };
    const anyA: InsertRule = { id: 't.a', kind: 'insert', explainKey: 'es.personal_a', word: 'a', beforePos: ['PROPN'] };
    const pack = createTestPack({ rules: [anyLa, anyA] });
    const t = 'Gente es simpática.';
    const vs = generateVariants(pack, t);
    expect(texts(vs)).toEqual(['La gente es simpática.']);
    expect(vs[0]).toMatchObject({ start: 0, end: 5, original: 'Gente', replacement: 'La gente', wordIndex: 0 });
    expectWellFormed(t, vs);
    expect(texts(generateVariants(pack, '¿Gente aquí?'))).toEqual(['¿La gente aquí?']);
    expect(texts(generateVariants(pack, 'Hola. Gente aquí.'))).toEqual(['Hola. La gente aquí.']);
    expect(texts(generateVariants(pack, 'Marta llegó.'))).toEqual(['A Marta llegó.']);
    expect(texts(generateVariants(pack, 'GENTE AQUÍ.'))).toEqual(['LA GENTE AQUÍ.']);
  });
});

describe('generateVariants: insert refinements (alg-2, lng-2, lng-5)', () => {
  it('treats a capitalized unknown word mid-sentence as a proper noun, unless disabled', () => {
    const pack = createTestPack({ rules: [PERSONAL_A_INSERT_RULE] });
    expect(texts(generateVariants(pack, 'Veo Pedro.'))).toEqual(['Veo a Pedro.']);
    expect(generateVariants(pack, 'Veo Pedro.', { capitalizedUnknownAsPropn: false })).toEqual([]);
    expect(generateVariants(pack, 'Veo pedro.')).toEqual([]);
    expect(generateVariants(pack, 'VEO PEDRO.')).toEqual([]);
  });

  it('inserts through determiners before a listed lemma', () => {
    const rule: InsertRule = {
      id: 't.a', kind: 'insert', explainKey: 'es.personal_a', word: 'a', beforeLemmas: ['madre', 'amigo'],
      throughPos: ['DET'], afterPos: ['VERB'], notBeforeWords: ['el'],
    };
    const pack = createTestPack({ rules: [rule] });
    const vs = generateVariants(pack, 'Veo mi madre.');
    expect(texts(vs)).toEqual(['Veo a mi madre.']);
    expect(vs[0]).toMatchObject({ start: 4, end: 4, wordIndex: 1 });
    expect(texts(generateVariants(pack, 'Veo madre.'))).toEqual(['Veo a madre.']);
    expect(generateVariants(pack, 'Veo mi casa.')).toEqual([]);
    expect(generateVariants(pack, 'Veo el amigo.')).toEqual([]); // "a el" would have to be "al"
    expect(generateVariants(pack, 'Veo a mi madre.')).toEqual([]);
  });

  it('respects notAfterWords and agreementExceptions, and checks agreement on determiner readings only', () => {
    const el: InsertRule = {
      id: 't.el', kind: 'insert', explainKey: 'es.article', word: 'el', beforePos: ['NOUN'], afterPos: ['VERB', 'ADP'],
      notAfterWords: ['para'], agreementExceptions: ['casa'],
    };
    const pack = createTestPack({ rules: [el] });
    expect(generateVariants(pack, 'Es para casa.')).toEqual([]);
    expect(texts(generateVariants(pack, 'Es por casa.'))).toEqual(['Es por el casa.']);
    expect(generateVariants(pack, 'Es por mesa.')).toEqual([]);
    // "una" also reads as a verb without gender in this pack; only its DET reading counts.
    const una: InsertRule = { id: 't.una', kind: 'insert', explainKey: 'es.article', word: 'una', beforePos: ['NOUN'], afterPos: ['ADP'] };
    const extra = { una: [{ lemma: 'un', pos: 'DET' as const, features: { gender: 'f', number: 's' } }, { lemma: 'unir', pos: 'VERB' as const, features: { mood: 'sub', tense: 'pres', person: '3', number: 's' } }] };
    const p2 = createTestPack({ rules: [una], extra });
    expect(generateVariants(p2, 'Es por libro.')).toEqual([]);
    expect(texts(generateVariants(p2, 'Es por mesa.'))).toEqual(['Es por una mesa.']);
  });

  it('does not protect slang marked alsoStandard in neutral register', () => {
    const registers = [{ id: 'es-PR', region: 'PR', entries: [{ ...TEST_REGISTERS[0]!.entries.find((e) => e.norm === 'brutal')!, alsoStandard: true }] }];
    const pack = createTestPack({ rules: [NUMBER_RULE], registers });
    expect(generateVariants(pack, 'Es brutal.', { register: 'street' })).toEqual([]);
    expect(texts(generateVariants(pack, 'Es brutal.', { register: 'neutral' }))).toEqual([]);
    expect([...slangWordIndices(pack, ['es', 'brutal'], 'neutral')]).toEqual([]);
    expect([...slangWordIndices(pack, ['es', 'brutal'], 'street')]).toEqual([1]);
    expect([...slangWordIndices(pack, ['es', 'brutal'])]).toEqual([1]);
  });
});

describe('generateVariants: deletes', () => {
  it('deletes personal a with the space before it', () => {
    const pack = createTestPack({ rules: [PERSONAL_A_DELETE_RULE] });
    const vs = generateVariants(pack, 'Veo a Marta.');
    expect(vs).toEqual([
      {
        text: 'Veo Marta.',
        ruleId: 'es.personal_a.delete',
        explainKey: 'es.personal_a',
        kind: 'delete',
        start: 3,
        end: 5,
        original: ' a',
        replacement: '',
        wordIndex: 1,
      },
    ]);
  });

  it('moves the capital to the next word when deleting a sentence-initial word', () => {
    const pack = createTestPack({ rules: [ARTICLE_DELETE_RULE] });
    const t = 'La gente es simpática.';
    const vs = generateVariants(pack, t);
    expect(texts(vs)).toEqual(['Gente es simpática.']);
    expectWellFormed(t, vs);
    expect(texts(generateVariants(pack, 'la gente.'))).toEqual(['gente.']);
    expect(texts(generateVariants(pack, '¿La casa?'))).toEqual(['¿Casa?']);
    expect(texts(generateVariants(pack, 'La Marta llegó.'))).toEqual(['Marta llegó.']);
  });

  it('deletes a sentence-final word without leaving a double space', () => {
    const pack = createTestPack({ rules: [PERSONAL_A_DELETE_RULE] });
    expect(texts(generateVariants(pack, 'Voy a.'))).toEqual(['Voy.']);
  });
});

describe('generateVariants: slang and register', () => {
  const street = "El corillo ya 'tá listo pa' bailar.";

  it('never edits slang words, in neutral or street register', () => {
    for (const register of ['neutral', 'street'] as const) {
      const vs = generateVariants(full, street, { register, maxVariants: 100 });
      expectWellFormed(street, vs);
      for (const span of spansOf(street, ["'tá", "pa'", 'corillo'])) {
        for (const v of vs) expect(overlaps(v, span), `${v.text} touches ${street.slice(...span)}`).toBe(false);
      }
      // Nothing is inserted in front of a slang word either.
      for (const v of vs) expect(v.kind === 'insert' && v.wordIndex === 1).toBe(false);
    }
  });

  it('would edit the clipped form if it were not a slang entry (protection is what stops it)', () => {
    // The mood rule without its cue condition, so it re-inflects the main verb 'tá.
    const rules = SPANISH_RULES.map((r) => (r.id === 'es.mood' ? { ...r, cueWords: undefined, cueFor: undefined } : r));
    const noSlang = createTestPack({ rules, registers: [] });
    const vs = generateVariants(noSlang, street, { maxVariants: 100 });
    const [s, e] = spansOf(street, ["'tá"])[0] as [number, number];
    expect(vs.some((v) => v.start === s && v.end === e)).toBe(true);
  });

  it('keeps the slang word intact when deleting the article in front of it', () => {
    const vs = generateVariants(full, street, { maxVariants: 100 });
    expect(texts(vs)).toContain("corillo ya 'tá listo pa' bailar.");
    expect(texts(vs)).not.toContain("Corillo ya 'tá listo pa' bailar.");
  });

  it('protects every word of a multi-word slang entry', () => {
    const t = 'Vamos de una.';
    expect(generateVariants(full, t, { maxVariants: 100 })).toEqual([]);
    const noSlang = createTestPack({ rules: SPANISH_RULES, registers: [] });
    expect(texts(generateVariants(noSlang, t, { maxVariants: 100 }))).toContain('Vamos de un.');
  });

  it('finds slang word indices for single words and phrases', () => {
    expect([...slangWordIndices(full, ['el', 'corillo', 'ya', "'tá", 'listo', "pa'", 'bailar'])]).toEqual([1, 3, 5]);
    expect([...slangWordIndices(full, ['vamos', 'de', 'una'])].sort()).toEqual([1, 2]);
    expect([...slangWordIndices(full, ['de', 'casa', 'una'])]).toEqual([]);
  });

  it('skips streetTolerant rules in street register only', () => {
    const t = 'Los libro nuevos.';
    const neutral = generateVariants(full, t, { maxVariants: 100 });
    const streetVs = generateVariants(full, t, { register: 'street', maxVariants: 100 });
    expect(neutral.some((v) => v.ruleId === 'es.number')).toBe(true);
    expect(streetVs.some((v) => v.ruleId === 'es.number')).toBe(false);
    expect(streetVs.some((v) => v.ruleId === 'es.gender')).toBe(true);
    expect(texts(neutral)).toContain('Los libros nuevos.');
  });

  it('applies the streetTolerant flag of any rule, not just number', () => {
    const tolerantSwap: SwapRule = { ...SER_ESTAR_RULE, id: 't.tolerant', streetTolerant: true };
    const pack = createTestPack({ rules: [tolerantSwap] });
    expect(generateVariants(pack, 'Soy cansado.', { register: 'street' })).toEqual([]);
    expect(texts(generateVariants(pack, 'Soy cansado.', { register: 'neutral' }))).toEqual(['Estoy cansado.']);
  });
});

describe('generateVariants: priority, dedup and cap', () => {
  it('orders swaps, then inflections, then inserts and deletes, whatever the rule order', () => {
    const uncuedMood: InflectRule = { ...MOOD_RULE, cueWords: undefined, cueFor: undefined };
    const rules: CorrectionRule[] = [ARTICLE_DELETE_RULE, uncuedMood, GENDER_RULE, SER_ESTAR_RULE];
    const pack = createTestPack({ rules });
    const vs = generateVariants(pack, 'La casa es blanco.', { maxVariants: 100 });
    expect(vs.map((v) => v.kind)).toEqual(['swap', 'inflect', 'inflect', 'inflect', 'delete']);
    // Inflections follow the order of rules in the pack (mood before gender here).
    expect(vs.map((v) => v.ruleId)).toEqual(['es.ser_estar', 'es.mood', 'es.gender', 'es.gender', 'es.article.delete']);
  });

  it('keeps the first of identical texts and drops variants equal to the original', () => {
    const a: SwapRule = { id: 't.a', kind: 'swap', explainKey: 'es.ser_estar', groups: [['soy', 'estoy']] };
    const b: SwapRule = { id: 't.b', kind: 'swap', explainKey: 'es.mood', groups: [['soy', 'estoy'], ['soy', 'soy']] };
    const pack = createTestPack({ rules: [a, b] });
    const set = generateVariantSet(pack, 'Soy cansado.');
    expect(set.variants.map((v) => [v.text, v.ruleId])).toEqual([['Estoy cansado.', 't.a']]);
    expect(set.generated).toBe(1);
    expect(set.dropped).toBe(0);
  });

  it('caps at maxVariants, keeps the highest-priority ones and reports the dropped count', () => {
    const t = 'La casa blanco es bonita.';
    const all = generateVariantSet(full, t, { maxVariants: 1000 });
    expect(all.dropped).toBe(0);
    expect(all.generated).toBe(all.variants.length);
    expect(all.generated).toBeGreaterThan(4);
    const capped = generateVariantSet(full, t, { maxVariants: 3 });
    expect(capped.variants).toEqual(all.variants.slice(0, 3));
    expect(capped.generated).toBe(all.generated);
    expect(capped.dropped).toBe(all.generated - 3);
    const none = generateVariantSet(full, t, { maxVariants: 0 });
    expect(none.variants).toEqual([]);
    expect(none.dropped).toBe(all.generated);
  });

  it('has distinct texts and well-formed spans for a long sentence with every rule', () => {
    const t = 'Ayer fui a playa con Ana y comía por la tarde una fruta blanco.';
    const vs = generateVariants(full, t, { maxVariants: 1000 });
    expect(new Set(texts(vs)).size).toBe(vs.length);
    expectWellFormed(t, vs);
  });
});
