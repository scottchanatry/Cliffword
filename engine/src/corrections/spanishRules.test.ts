/**
 * Data tests for SPANISH_RULES (engine/src/lang/es/rules.ts). They live here because
 * the corrections module owns rules.ts but not the rest of lang/es.
 */
import { describe, expect, it } from 'vitest';
import type { CorrectionRule, DeleteRule, InflectRule, InsertRule, MoveRule, SwapRule } from '../lang/types';
import { lexiconRows } from '../lang/es/lexicon';
import { CLITICS } from '../lang/es/analyze';
import { createSpanishPack } from '../lang/es/index';
import { createMockModel } from '../model/mock';
import { judgeSentence } from './judge';
import { generateVariantSet, generateVariants } from './variants';
import {
  ARTICLE_CONTRACTIONS,
  ARTICLE_FOLLOWER_POS,
  ARTICLE_FOLLOWER_WORDS,
  CLITIC_HOMOGRAPHS,
  CLITIC_ORDER,
  NEGATION_WORDS,
  NEGATIVE_COMMAND_RULE,
  PRONOUN_MOVE_RULES,
  PRONOUN_ORDER_RULE,
  SE_LO_RULE,
  SPANISH_CLITICS,
  ARTICLE_DELETE_RULE,
  ARTICLE_INSERT_RULES,
  MOOD_RULE,
  PERSON_NOUNS,
  STRESSED_A_FEMININES,
  SUBJUNCTIVE_CUES,
  SER_ESTAR_NONFINITE,
  SER_ESTAR_PARADIGM,
  SER_ESTAR_RULE,
  SPANISH_ARTICLES,
  SPANISH_EXPLAIN_KEYS,
  SPANISH_RULES,
  serEstarGroups,
} from '../lang/es/rules';

const swaps = SPANISH_RULES.filter((r): r is SwapRule => r.kind === 'swap');
const inflects = SPANISH_RULES.filter((r): r is InflectRule => r.kind === 'inflect');
const inserts = SPANISH_RULES.filter((r): r is InsertRule => r.kind === 'insert');
const deletes = SPANISH_RULES.filter((r): r is DeleteRule => r.kind === 'delete');
const moves = SPANISH_RULES.filter((r): r is MoveRule => r.kind === 'move');

function byId(id: string): CorrectionRule {
  const r = SPANISH_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`missing rule ${id}`);
  return r;
}

/** Every surface form a rule mentions. */
function formsOf(rule: CorrectionRule): string[] {
  switch (rule.kind) {
    case 'swap':
      // A one-way swap lists each source once and may share a target (le, les -> se).
      return rule.fromWords ? [...rule.fromWords, ...new Set(rule.groups.flat().filter((f) => !rule.fromWords?.includes(f)))] : rule.groups.flat();
    case 'delete':
      return [...rule.words];
    case 'insert':
      return [rule.word, ...(rule.afterWords ?? [])];
    case 'inflect':
      return [];
    case 'move':
      return [...rule.words];
  }
}

describe('SPANISH_RULES: shape', () => {
  it('uses only the allowed explainKeys, and every allowed key at least once', () => {
    const allowed = new Set<string>(SPANISH_EXPLAIN_KEYS);
    for (const r of SPANISH_RULES) expect(allowed.has(r.explainKey), r.id).toBe(true);
    const used = new Set(SPANISH_RULES.map((r) => r.explainKey));
    for (const k of SPANISH_EXPLAIN_KEYS) expect(used.has(k), k).toBe(true);
    expect([...SPANISH_EXPLAIN_KEYS].sort()).toEqual([
      'es.article', 'es.aspect', 'es.gender', 'es.mood', 'es.negative_command', 'es.number', 'es.personal_a',
      'es.por_para', 'es.pronoun_order', 'es.pronoun_placement', 'es.se_lo', 'es.ser_estar',
    ]);
  });

  it('has unique rule ids', () => {
    const ids = SPANISH_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes every form lowercase, trimmed, without edge punctuation', () => {
    for (const r of SPANISH_RULES) {
      for (const f of formsOf(r)) {
        expect(f, r.id).toBe(f.trim().toLowerCase());
        expect(f, r.id).toMatch(/^[\p{L}\p{M}]+$/u);
      }
    }
  });

  it('has no duplicate forms within any rule', () => {
    for (const r of SPANISH_RULES) {
      const forms = formsOf(r);
      expect(new Set(forms).size, r.id).toBe(forms.length);
    }
  });

  it('keeps swap groups aligned: every group of a rule has the same length (at least 2)', () => {
    expect(swaps.length).toBe(3);
    for (const r of swaps) {
      const len = r.groups[0]?.length ?? 0;
      expect(len).toBeGreaterThanOrEqual(2);
      for (const g of r.groups) expect(g.length, `${r.id}: ${g.join('/')}`).toBe(len);
    }
  });

  it('marks only number agreement as street tolerant (Caribbean final -s)', () => {
    const tolerant = SPANISH_RULES.filter((r) => r.streetTolerant).map((r) => r.id);
    expect(tolerant).toEqual(['es.number']);
  });

  it('orders kinds as swaps, inflections, then inserts and deletes', () => {
    const rank = { swap: 0, move: 0, inflect: 1, insert: 2, delete: 2 } as const;
    const ranks = SPANISH_RULES.map((r) => rank[r.kind]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe('SPANISH_RULES: ser/estar', () => {
  it('covers every person and number in each required tense and mood', () => {
    const combos: Array<[string, string]> = [
      ['ind', 'pres'], ['ind', 'pret'], ['ind', 'impf'], ['ind', 'fut'], ['ind', 'cond'],
      ['sub', 'pres'], ['sub', 'impf'], ['sub', 'impf-se'],
    ];
    for (const [mood, tense] of combos) {
      const cells = SER_ESTAR_PARADIGM.filter((c) => c.mood === mood && c.tense === tense);
      const slots = cells.map((c) => `${c.person}${c.number}`).sort();
      expect(slots, `${mood} ${tense}`).toEqual(['1p', '1s', '2p', '2s', '3p', '3s']);
    }
    expect(SER_ESTAR_PARADIGM.length).toBe(combos.length * 6);
  });

  it('has the standard forms (spot checks across the paradigm)', () => {
    const cell = (mood: string, tense: string, pn: string) =>
      SER_ESTAR_PARADIGM.find((c) => c.mood === mood && c.tense === tense && `${c.person}${c.number}` === pn);
    const expectPair = (mood: string, tense: string, pn: string, ser: string, estar: string) => {
      const c = cell(mood, tense, pn);
      expect(c, `${mood} ${tense} ${pn}`).toBeDefined();
      expect([c?.ser, c?.estar]).toEqual([ser, estar]);
    };
    expectPair('ind', 'pres', '1s', 'soy', 'estoy');
    expectPair('ind', 'pres', '2s', 'eres', 'estás');
    expectPair('ind', 'pres', '3s', 'es', 'está');
    expectPair('ind', 'pres', '1p', 'somos', 'estamos');
    expectPair('ind', 'pres', '2p', 'sois', 'estáis');
    expectPair('ind', 'pres', '3p', 'son', 'están');
    expectPair('ind', 'pret', '1s', 'fui', 'estuve');
    expectPair('ind', 'pret', '3s', 'fue', 'estuvo');
    expectPair('ind', 'pret', '3p', 'fueron', 'estuvieron');
    expectPair('ind', 'impf', '1s', 'era', 'estaba');
    expectPair('ind', 'impf', '3s', 'era', 'estaba');
    expectPair('ind', 'impf', '1p', 'éramos', 'estábamos');
    expectPair('ind', 'fut', '1s', 'seré', 'estaré');
    expectPair('ind', 'fut', '2p', 'seréis', 'estaréis');
    expectPair('ind', 'cond', '3s', 'sería', 'estaría');
    expectPair('ind', 'cond', '1p', 'seríamos', 'estaríamos');
    expectPair('sub', 'pres', '1s', 'sea', 'esté');
    expectPair('sub', 'pres', '2s', 'seas', 'estés');
    expectPair('sub', 'pres', '2p', 'seáis', 'estéis');
    expectPair('sub', 'impf', '1p', 'fuéramos', 'estuviéramos');
    expectPair('sub', 'impf', '3p', 'fueran', 'estuvieran');
    expectPair('sub', 'impf-se', '1p', 'fuésemos', 'estuviésemos');
    expectPair('sub', 'impf-se', '3s', 'fuese', 'estuviese');
  });

  it('builds one [ser, estar] group per distinct pair, ser first', () => {
    const groups = serEstarGroups();
    expect(SER_ESTAR_RULE.groups).toEqual(groups);
    const serForms = new Set([...SER_ESTAR_PARADIGM.map((c) => c.ser), ...SER_ESTAR_NONFINITE.map((p) => p[0])]);
    const estarForms = new Set([...SER_ESTAR_PARADIGM.map((c) => c.estar), ...SER_ESTAR_NONFINITE.map((p) => p[1])]);
    for (const g of groups) {
      expect(g.length).toBe(2);
      expect(serForms.has(g[0] as string), g.join('/')).toBe(true);
      expect(estarForms.has(g[1] as string), g.join('/')).toBe(true);
    }
    // Shared 1s/3s forms (era, sería, sea, fuera, fuese) appear once.
    expect(groups.filter((g) => g[0] === 'era')).toEqual([['era', 'estaba']]);
    // 6 + 6 + 5 + 6 + 5 + 5 + 5 + 5 distinct finite pairs, plus 3 non-finite.
    expect(groups.length).toBe(43 + 3);
  });

  it('pairs each ser form with exactly one estar form (no form in two groups)', () => {
    const forms = SER_ESTAR_RULE.groups.flat();
    expect(new Set(forms).size).toBe(forms.length);
  });

  it('notes that the preterite is shared with ir', () => {
    expect(SER_ESTAR_RULE.groups).toContainEqual(['fui', 'estuve']);
    expect(SER_ESTAR_RULE.groups).toContainEqual(['fuimos', 'estuvimos']);
  });

  it('swaps por and para', () => {
    expect(byId('es.por_para')).toMatchObject({ kind: 'swap', groups: [['por', 'para']], explainKey: 'es.por_para' });
  });
});

describe('SPANISH_RULES: inflections, inserts, deletes', () => {
  it('defines gender, number, aspect and mood exactly as specified', () => {
    expect(byId('es.gender')).toMatchObject({ kind: 'inflect', pos: ['ADJ', 'DET'], feature: 'gender', values: ['m', 'f'] });
    expect(byId('es.number')).toMatchObject({
      kind: 'inflect',
      pos: ['ADJ', 'DET', 'NOUN'],
      feature: 'number',
      values: ['s', 'p'],
    });
    expect(byId('es.aspect')).toMatchObject({ kind: 'inflect', pos: ['VERB'], feature: 'tense', values: ['pret', 'impf'] });
    expect(byId('es.mood')).toMatchObject({ kind: 'inflect', pos: ['VERB'], feature: 'mood', values: ['ind', 'sub'] });
    for (const r of inflects) {
      expect(r.values.length).toBeGreaterThanOrEqual(2);
      expect(new Set(r.values).size).toBe(r.values.length);
    }
  });

  it('defines personal a as an insert before PROPN after VERB and a delete', () => {
    expect(byId('es.personal_a.insert')).toMatchObject({
      kind: 'insert',
      word: 'a',
      beforePos: ['PROPN'],
      afterPos: ['VERB'],
      explainKey: 'es.personal_a',
    });
    expect(byId('es.personal_a.delete')).toMatchObject({ kind: 'delete', words: ['a'], explainKey: 'es.personal_a' });
  });

  it('extends personal a to person nouns through determiners, never before "el" (alg-2, lng-2)', () => {
    const rule = byId('es.personal_a.insert') as InsertRule;
    expect(rule.beforeLemmas).toEqual([...PERSON_NOUNS]);
    expect(rule.throughPos).toEqual(['DET']);
    expect(rule.notBeforeWords).toEqual(['el']);
    // Every person noun is a noun lemma of the lexicon, so the chosen analysis can match it.
    for (const lemma of PERSON_NOUNS) expect(lexiconRows(lemma).some((r) => r[1] === 'NOUN'), lemma).toBe(true);
  });

  it('cues the subjunctive and leaves the indicative of main verbs alone (lng-4)', () => {
    expect(MOOD_RULE.cueWords).toEqual([...SUBJUNCTIVE_CUES]);
    expect(MOOD_RULE.cueFor).toEqual(['ind']);
    expect(SUBJUNCTIVE_CUES).toContain('que');
    expect(SUBJUNCTIVE_CUES).not.toContain('si');
  });

  it('keeps article inserts away from contractions and handles stressed-a feminines (lng-5)', () => {
    for (const r of ARTICLE_INSERT_RULES) expect(r.notAfterWords).toEqual([...ARTICLE_CONTRACTIONS]);
    const by = (w: string) => ARTICLE_INSERT_RULES.find((r) => r.word === w) as InsertRule;
    expect(by('el').agreementExceptions).toEqual([...STRESSED_A_FEMININES]);
    expect(by('un').agreementExceptions).toEqual([...STRESSED_A_FEMININES]);
    expect(by('la').notBeforeWords).toEqual([...STRESSED_A_FEMININES]);
    expect(by('una').notBeforeWords).toBeUndefined();
    expect(STRESSED_A_FEMININES).toEqual(expect.arrayContaining(['agua', 'alma', 'hambre', 'área']));
  });

  it('defines article inserts for el/la/los/las/un/una and one delete for all six', () => {
    expect([...SPANISH_ARTICLES]).toEqual(['el', 'la', 'los', 'las', 'un', 'una']);
    expect(ARTICLE_INSERT_RULES.map((r) => r.word)).toEqual([...SPANISH_ARTICLES]);
    for (const r of ARTICLE_INSERT_RULES) {
      expect(r.explainKey).toBe('es.article');
      expect(r.beforePos).toEqual(['NOUN']);
      expect(r.afterPos).toEqual(['VERB', 'ADP']);
    }
    expect(ARTICLE_DELETE_RULE.words).toEqual([...SPANISH_ARTICLES]);
    expect(inserts.length).toBe(1 + SPANISH_ARTICLES.length);
    expect(deletes.map((d) => d.id)).toEqual(['es.personal_a.delete', 'es.article.delete']);
  });
});

describe('SPANISH_RULES: object pronouns (data)', () => {
  it('moves the same clitics the analyzer strips, and orders each of them once', () => {
    expect([...SPANISH_CLITICS].sort()).toEqual([...CLITICS].sort());
    const ordered = CLITIC_ORDER.flat();
    expect([...ordered].sort()).toEqual([...SPANISH_CLITICS].sort());
    expect(new Set(ordered).size).toBe(ordered.length);
    expect(CLITIC_ORDER[0]).toEqual(['se']);
  });

  it('defines every move rule on verbs with the article guard', () => {
    expect(moves).toEqual([...PRONOUN_MOVE_RULES]);
    for (const r of moves) {
      expect(r.words, r.id).toEqual([...SPANISH_CLITICS]);
      expect(r.anchorPos, r.id).toEqual(['VERB', 'AUX']);
      expect(r.homographs, r.id).toEqual([...CLITIC_HOMOGRAPHS]);
      expect(r.notBeforePos, r.id).toEqual([...ARTICLE_FOLLOWER_POS]);
      expect(r.notBeforeWords, r.id).toEqual([...ARTICLE_FOLLOWER_WORDS]);
      for (const h of r.homographs ?? []) expect(r.words).toContain(h);
      expect(['es.pronoun_placement', 'es.negative_command', 'es.pronoun_order']).toContain(r.explainKey);
    }
    const byRuleId = (id: string) => byId(id) as MoveRule;
    expect(byRuleId('es.pronoun_placement.finite')).toMatchObject({ anchorForms: ['fin'], positions: ['before'] });
    expect(byRuleId('es.pronoun_placement.nonfinite')).toMatchObject({ anchorForms: ['inf', 'ger'], positions: ['attach'] });
    expect(byRuleId('es.pronoun_placement.command')).toMatchObject({
      anchorForms: ['imp'],
      positions: ['attach'],
      notAfterWords: [...NEGATION_WORDS],
    });
    expect(NEGATIVE_COMMAND_RULE).toMatchObject({
      anchorForms: ['imp'],
      positions: ['before'],
      afterWords: [...NEGATION_WORDS],
      inflectAnchor: { mood: 'sub', tense: 'pres' },
      explainKey: 'es.negative_command',
    });
    expect(PRONOUN_ORDER_RULE.positions).toEqual([]);
    expect(PRONOUN_ORDER_RULE.order).toEqual(CLITIC_ORDER.map((g) => [...g]));
  });

  it('changes le and les to se one way, only before lo, la, los, las', () => {
    expect(SE_LO_RULE).toMatchObject({
      kind: 'swap',
      groups: [['le', 'se'], ['les', 'se']],
      fromWords: ['le', 'les'],
      beforeWords: ['lo', 'la', 'los', 'las'],
      explainKey: 'es.se_lo',
    });
  });
});

/** proof/pairs.jsonl, rule pronoun_placement (ids 83 to 93), with the clitics each fix moves. */
const PRONOUN_PAIRS: ReadonlyArray<{ id: number; incorrect: string; correct: string; moved: string[] }> = [
  { id: 83, incorrect: 'Compré lo ayer.', correct: 'Lo compré ayer.', moved: ['lo'] },
  { id: 84, incorrect: 'Quiero te ver mañana.', correct: 'Quiero verte mañana.', moved: ['te'] },
  { id: 85, incorrect: 'Lo te digo ahora.', correct: 'Te lo digo ahora.', moved: ['lo', 'te'] },
  { id: 86, incorrect: 'No hazlo.', correct: 'No lo hagas.', moved: ['lo'] },
  { id: 87, incorrect: 'Le lo di a mi hermana.', correct: 'Se lo di a mi hermana.', moved: ['le'] },
  { id: 88, incorrect: 'Estoy lo leyendo ahora.', correct: 'Estoy leyéndolo ahora.', moved: ['lo'] },
  { id: 89, incorrect: 'Llamó me anoche.', correct: 'Me llamó anoche.', moved: ['me'] },
  { id: 90, incorrect: 'Lo haz ahora.', correct: 'Hazlo ahora.', moved: ['lo'] },
  { id: 91, incorrect: 'Vemos nos mañana.', correct: 'Nos vemos mañana.', moved: ['nos'] },
  { id: 92, incorrect: 'Invité la a cenar.', correct: 'La invité a cenar.', moved: ['la'] },
  { id: 93, incorrect: '¿Puedes me ayudar?', correct: '¿Puedes ayudarme?', moved: ['me'] },
];

const PRONOUN_KEYS = new Set(['es.pronoun_placement', 'es.negative_command', 'es.pronoun_order', 'es.se_lo']);

describe('object pronouns: the proof pairs with the real Spanish pack', () => {
  const es = createSpanishPack({ rules: SPANISH_RULES });
  const model = createMockModel();

  for (const p of PRONOUN_PAIRS) {
    it(`#${p.id} "${p.incorrect}" -> "${p.correct}" is among the variants, with a span over the moved words`, () => {
      const vs = generateVariants(es, p.incorrect);
      const fix = vs.find((v) => v.text === p.correct);
      expect(fix, vs.map((v) => v.text).join(' | ')).toBeDefined();
      if (!fix) return;
      expect(PRONOUN_KEYS.has(fix.explainKey), fix.ruleId).toBe(true);
      expect(p.incorrect.slice(0, fix.start) + fix.replacement + p.incorrect.slice(fix.end)).toBe(p.correct);
      expect(p.incorrect.slice(fix.start, fix.end)).toBe(fix.original);
      // The edit covers every moved clitic (judge localization cuts the shared prefix at fix.start).
      for (const c of p.moved) expect(es.normalize(fix.original), `${fix.ruleId} ${fix.original}`).toContain(c);
      const words = es.segment(p.incorrect).filter((s) => s.kind === 'word');
      const w = words[fix.wordIndex];
      expect(w && w.start >= fix.start && w.end <= fix.end, `wordIndex ${fix.wordIndex}`).toBe(true);
    });

    it(`#${p.id} judgeSentence with the mock scores "${p.correct}" as a candidate`, async () => {
      const j = await judgeSentence(model, es, '', p.incorrect);
      expect(j.variants.map((v) => v.text)).toContain(p.correct);
    });

    it(`#${p.id} the correct "${p.correct}" gets no pronoun variant and few variants overall`, () => {
      const set = generateVariantSet(es, p.correct, { maxVariants: 1000 });
      expect(set.variants.filter((v) => PRONOUN_KEYS.has(v.explainKey)).map((v) => v.text)).toEqual([]);
      // The other rules' usual handful (ser/estar, aspect, articles...), nothing from the moves.
      expect(set.generated).toBeLessThanOrEqual(6);
    });
  }

  it('makes at most two pronoun variants for each incorrect proof sentence', () => {
    for (const p of PRONOUN_PAIRS) {
      const set = generateVariantSet(es, p.incorrect, { maxVariants: 1000 });
      const pron = set.variants.filter((v) => PRONOUN_KEYS.has(v.explainKey));
      expect(pron.length, p.incorrect).toBeGreaterThanOrEqual(1);
      expect(pron.length, p.incorrect).toBeLessThanOrEqual(2);
    }
  });
});

describe('object pronouns: beyond the proof pairs', () => {
  const es = createSpanishPack({ rules: SPANISH_RULES });
  const pronounTexts = (text: string, register: 'neutral' | 'street' = 'neutral') =>
    generateVariantSet(es, text, { maxVariants: 1000, register })
      .variants.filter((v) => PRONOUN_KEYS.has(v.explainKey))
      .map((v) => v.text);

  it('leaves correct sentences alone: articles, neuter lo, clitic hosts, homographs, two-verb sentences', () => {
    const correct = [
      'Es lo que quiero.', 'Veo la casa.', 'Es la una.', 'Son las 3.', 'Compré las dos.', 'Hice lo mejor que pude.',
      'Compré la lavadora.', 'Llamé a la que vino.', 'Fuese lo que fuese.', 'Vale la pena.', 'Les di los libros.',
      'Lo ve.', 'No ve nada.', 'Lo come.', 'Me di cuenta.', 'Al llegar me llamó.', 'Cuando llegó me llamó.',
      'Hágalo ahora.', 'Vámonos.', 'Dímelo.', 'Siéntate aquí.', 'Ponlo aquí.', 'Dile la verdad.', 'Dame la mano.',
      'Hay que hacerlo.', 'Estoy leyéndolo.', 'Lo estoy leyendo.', 'Te quiero.', 'Se lo di.', 'No me lo digas.',
      'No te vayas.', 'Me lo dio y se fue.', '¿Te lo digo?',
    ];
    for (const text of correct) expect(pronounTexts(text), text).toEqual([]);
  });

  it('detaches pronouns from finite verbs and negative commands, re-inflecting the command', () => {
    expect(pronounTexts('Compróla ayer.')).toEqual(['La compró ayer.']);
    expect(pronounTexts('No hágalo.')).toEqual(['No lo haga.']);
    expect(pronounTexts('No dime eso.')).toEqual(['No me digas eso.']);
    expect(pronounTexts('Nunca dime eso.')).toEqual(['Nunca me digas eso.']);
    expect(pronounTexts('No vete.')).toEqual(['No te vayas.']);
    expect(pronounTexts('No haz lo.')).toEqual(['No lo hagas.']);
  });

  it('offers both readings of an ambiguous verb and attaches clusters with the right accent', () => {
    expect(pronounTexts('Mira la.')).toEqual(['La mira.', 'Mírala.']);
    expect(pronounTexts('Quiero te lo dar.')).toEqual(['Te lo quiero dar.', 'Quiero dártelo.']);
    expect(pronounTexts('Dime lo.')).toEqual(['Dímelo.']);
    expect(pronounTexts('Para no te ver.')).toEqual(['Para no verte.']);
  });

  it('reorders separate and attached clusters', () => {
    expect(pronounTexts('Me se olvidó.')).toEqual(['Se me olvidó.']);
    expect(pronounTexts('Dalome.')).toEqual(['Dámelo.']);
  });

  it('keeps capitals: the new first word takes the capital, a shouted sentence stays shouted', () => {
    expect(pronounTexts('COMPRÉ LO AYER.')).toEqual(['LO COMPRÉ AYER.']);
    expect(pronounTexts('Vi los, pero no los compré.')).toEqual(['Los vi, pero no los compré.']);
  });

  it('never turns se into le, and applies in street register too', () => {
    expect(generateVariants(es, 'Se lo di.', { maxVariants: 1000 }).map((v) => v.text)).not.toContain('Le lo di.');
    expect(pronounTexts('Le lo di.', 'street')).toEqual(['Se lo di.']);
    expect(pronounTexts('Compré lo ayer.', 'street')).toEqual(['Lo compré ayer.']);
  });
});
