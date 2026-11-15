import { describe, expect, it } from 'vitest';
import type { Analysis, CliticSplit, CorrectionRule, InflectRule, InsertRule, LanguagePack, MoveRule, SwapRule } from '../lang/types';
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
  KIND_PRIORITY,
  anchorFormOf,
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

// ---------------------------------------------------------------------------
// Move rules (language-neutral, with a stub pack)
// ---------------------------------------------------------------------------

const CL = ['lo', 'la', 'me', 'te'];
const PRON = (lemma: string): Analysis[] => [{ lemma, pos: 'PRON', features: {} }];
const IMP = { form: 'fin', mood: 'imp', person: '2', number: 's' };

/** Extra analyses: clitics, a negation, an imperative, and a clitic form the "analyzer" accepts. */
const MOVE_EXTRA: Record<string, Analysis[]> = {
  lo: PRON('lo'),
  me: PRON('me'),
  te: PRON('te'),
  le: PRON('le'),
  se: PRON('se'),
  no: [{ lemma: 'no', pos: 'ADV', features: {} }],
  baila: [{ lemma: 'bailar', pos: 'VERB', features: IMP }],
  bailalo: [{ lemma: 'bailar', pos: 'VERB', features: IMP }],
};

/**
 * Stub pack with move support: clitics attach by plain concatenation and split off
 * when what is left is a verb the pack knows (up to two clitics). The "analyzer"
 * accepts bailalo (an imperative host) but not comprolo (a finite host).
 */
function movePack(rules: readonly CorrectionRule[], opts: { attach?: boolean; split?: boolean } = {}): LanguagePack {
  const base = createTestPack({ rules, extra: MOVE_EXTRA });
  const cliticForms = new Set(['bailalo']);
  // A host is a verb form of its own: known, and not itself a verb + clitic form.
  const isHost = (w: string) => !cliticForms.has(w) && base.analyze(w).some((a) => a.pos === 'VERB');
  const split = (word: string): CliticSplit | undefined => {
    if (base.analyze(word).length && !cliticForms.has(word)) return undefined;
    for (const c of CL) {
      if (!word.endsWith(c) || word.length <= c.length) continue;
      const rest = word.slice(0, -c.length);
      if (isHost(rest)) return { host: rest, clitics: [c] };
      for (const d of CL) {
        if (rest.endsWith(d) && isHost(rest.slice(0, -d.length))) return { host: rest.slice(0, -d.length), clitics: [d, c] };
      }
    }
    return undefined;
  };
  return {
    ...base,
    inflect: (lemma, f) =>
      lemma === 'bailar' && f.mood === 'sub' && f.tense === 'pres' && f.person === '2' ? 'bailes' : base.inflect(lemma, f),
    ...(opts.attach === false ? {} : { attachClitic: (host: string, clitic: string) => host + clitic }),
    ...(opts.split === false ? {} : { splitClitics: split }),
  };
}

const FIN: MoveRule = {
  id: 't.fin', kind: 'move', explainKey: 't.place', words: CL, anchorPos: ['VERB'], anchorForms: ['fin'], positions: ['before'],
  homographs: ['la'], notBeforePos: ['NOUN', 'ADJ', 'DET'], notBeforeWords: ['que'],
};
const ATTACH: MoveRule = {
  id: 't.attach', kind: 'move', explainKey: 't.place', words: CL, anchorPos: ['VERB'], anchorForms: ['inf', 'imp'],
  positions: ['attach'], notAfterWords: ['no'],
};
const NEG: MoveRule = {
  id: 't.neg', kind: 'move', explainKey: 't.neg', words: CL, anchorPos: ['VERB'], anchorForms: ['imp'], positions: ['before'],
  afterWords: ['no'], inflectAnchor: { mood: 'sub', tense: 'pres' },
};
const ORDER: MoveRule = {
  id: 't.order', kind: 'move', explainKey: 't.order', words: CL, anchorPos: ['VERB'], positions: [], order: [['te'], ['me'], ['lo', 'la']],
};
const MOVES = [FIN, ATTACH, NEG];

function moveTexts(pack: LanguagePack, t: string): string[] {
  const vs = generateVariants(pack, t, { maxVariants: 100 });
  expectWellFormed(t, vs);
  return texts(vs);
}

describe('generateVariants: move rules', () => {
  const pack = movePack(MOVES);

  it('classifies anchor forms: imperative, non-finite form, other finite, none', () => {
    expect(anchorFormOf({ lemma: 'x', pos: 'VERB', features: IMP })).toBe('imp');
    expect(anchorFormOf({ lemma: 'x', pos: 'VERB', features: { form: 'inf' } })).toBe('inf');
    expect(anchorFormOf({ lemma: 'x', pos: 'VERB', features: { form: 'ger' } })).toBe('ger');
    expect(anchorFormOf({ lemma: 'x', pos: 'VERB', features: { mood: 'sub', tense: 'pres' } })).toBe('fin');
    expect(anchorFormOf({ lemma: 'x', pos: 'VERB', features: { form: 'fin', mood: 'ind' } })).toBe('fin');
    expect(anchorFormOf({ lemma: 'x', pos: 'NOUN', features: {} })).toBeUndefined();
  });

  it('moves a clitic after a finite verb in front of it, with a span over both words', () => {
    const t = 'Compro lo hoy.';
    const vs = generateVariants(pack, t);
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({
      text: 'Lo compro hoy.', ruleId: 't.fin', explainKey: 't.place', kind: 'move',
      start: 0, end: 9, original: 'Compro lo', replacement: 'Lo compro', wordIndex: 1,
    });
    expectWellFormed(t, vs);
  });

  it('moves a cluster as one unit, keeping its order and spacing', () => {
    expect(moveTexts(pack, 'Compro te lo hoy.')).toEqual(['Te lo compro hoy.']);
    expect(moveTexts(pack, 'Ya compro  me lo.')).toEqual(['Ya me lo  compro.']);
  });

  it('keeps case: the new first word takes the capital, all caps stay all caps', () => {
    expect(moveTexts(pack, 'COMPRO LO HOY.')).toEqual(['LO COMPRO HOY.']);
    expect(moveTexts(pack, 'Hoy compro lo.')).toEqual(['Hoy lo compro.']);
  });

  it('reads a homograph as the other word before a noun, a listed word, a number or an unknown word', () => {
    expect(moveTexts(pack, 'Compro la casa.')).toEqual([]);
    expect(moveTexts(pack, 'Compro la que quiero.')).toEqual([]);
    expect(moveTexts(pack, 'Compro la 2.')).toEqual([]);
    expect(moveTexts(pack, 'Compro la zzz.')).toEqual([]);
    expect(moveTexts(pack, 'Compro la.')).toEqual(['La compro.']);
    expect(moveTexts(pack, 'Compro la hoy.')).toEqual(['La compro hoy.']);
  });

  it('proposes each adjacent anchor its own position: before the finite verb, attached to the infinitive', () => {
    expect(moveTexts(pack, 'Quiero lo bailar.')).toEqual(['Lo quiero bailar.', 'Quiero bailarlo.']);
    expect(moveTexts(pack, 'Lo baila.')).toEqual(['Bailalo.']);
  });

  it('leaves a cluster alone when either neighbour allows it ("Para bailar me llamo")', () => {
    expect(moveTexts(pack, 'Para bailar me llamo.')).toEqual([]);
    expect(moveTexts(pack, 'Lo compro.')).toEqual([]);
  });

  it('proposes no attach position without pack.attachClitic', () => {
    expect(moveTexts(movePack(MOVES, { attach: false }), 'Quiero lo bailar.')).toEqual(['Lo quiero bailar.']);
  });

  it('detaches clitics the pack does not accept on a finite verb', () => {
    const t = 'Comprolo hoy.';
    const vs = generateVariants(pack, t);
    expect(vs.map((v) => [v.text, v.start, v.end, v.wordIndex])).toEqual([['Lo compro hoy.', 0, 8, 0]]);
    expect(moveTexts(movePack(MOVES, { split: false }), t)).toEqual([]);
  });

  it('keeps attached clitics the pack accepts, unless a context rule forbids them; then re-inflects the anchor', () => {
    expect(moveTexts(pack, 'Bailalo.')).toEqual([]);
    expect(moveTexts(pack, 'No bailalo.')).toEqual(['No lo bailes.']);
    expect(generateVariants(pack, 'No bailalo.')[0]).toMatchObject({ ruleId: 't.neg', explainKey: 't.neg', original: 'bailalo' });
    expect(moveTexts(pack, 'No baila lo.')).toEqual(['No lo bailes.']);
    expect(moveTexts(pack, 'No lo baila.')).toEqual([]);
  });

  it('drops a re-inflecting variant when the pack cannot produce the form', () => {
    const neg: MoveRule = { ...NEG, inflectAnchor: { mood: 'sub', tense: 'impf' } };
    expect(moveTexts(movePack([FIN, ATTACH, neg]), 'No bailalo.')).toEqual([]);
  });

  it('supports the after position (any language where clitics follow the verb)', () => {
    const after: MoveRule = { ...FIN, id: 't.after', positions: ['after'] };
    expect(moveTexts(movePack([after]), 'Lo compro hoy.')).toEqual(['Compro lo hoy.']);
    expect(moveTexts(movePack([after]), 'Compro lo hoy.')).toEqual([]);
  });

  it('reorders separate and attached clusters with an order-only rule', () => {
    const op = movePack([ORDER]);
    const vs = generateVariants(op, 'Lo te compro.');
    expect(vs.map((v) => [v.text, v.ruleId, v.original, v.wordIndex])).toEqual([['Te lo compro.', 't.order', 'Lo te', 0]]);
    expect(moveTexts(op, 'Te lo compro.')).toEqual([]);
    expect(moveTexts(op, 'Bailalote.')).toEqual(['Bailatelo.']);
    // Not next to a verb: nothing to order against.
    expect(moveTexts(op, 'Hoy lo te.')).toEqual([]);
  });

  it('never moves a slang word or uses one as an anchor', () => {
    expect(moveTexts(pack, 'Quiero lo janguear.')).toEqual(['Lo quiero janguear.']);
  });

  it('ranks moves with swaps, so a tight cap keeps them ahead of inflections', () => {
    expect(KIND_PRIORITY.move).toBe(KIND_PRIORITY.swap);
    const p = movePack([GENDER_RULE, FIN]);
    const t = 'Compro lo hoy en la casa blanco.';
    expect(texts(generateVariants(p, t, { maxVariants: 1 }))).toEqual(['Lo compro hoy en la casa blanco.']);
    expect(generateVariantSet(p, t, { maxVariants: 100 }).generated).toBeGreaterThan(1);
  });
});

describe('generateVariants: swap context conditions', () => {
  it('swaps only before the listed words, one way with fromWords', () => {
    const rule: SwapRule = { id: 't.se', kind: 'swap', explainKey: 't.se', groups: [['le', 'se']], fromWords: ['le'], beforeWords: ['lo'] };
    const pack = createTestPack({ rules: [rule], extra: MOVE_EXTRA });
    expect(texts(generateVariants(pack, 'Le lo compro.'))).toEqual(['Se lo compro.']);
    expect(texts(generateVariants(pack, 'Le compro.'))).toEqual([]);
    expect(texts(generateVariants(pack, 'Se lo compro.'))).toEqual([]);
    expect(texts(generateVariants(pack, 'Le, lo compro.'))).toEqual([]);
  });

  it('swaps only after the listed words', () => {
    const rule: SwapRule = { ...POR_PARA_RULE, id: 't.after', afterWords: ['compro'] };
    const pack = createTestPack({ rules: [rule] });
    expect(texts(generateVariants(pack, 'Compro por ti.'))).toEqual(['Compro para ti.']);
    expect(texts(generateVariants(pack, 'Voy por ti.'))).toEqual([]);
  });
});
