/**
 * Data tests for SPANISH_RULES (engine/src/lang/es/rules.ts). They live here because
 * the corrections module owns rules.ts but not the rest of lang/es.
 */
import { describe, expect, it } from 'vitest';
import type { CorrectionRule, DeleteRule, InflectRule, InsertRule, SwapRule } from '../lang/types';
import { lexiconRows } from '../lang/es/lexicon';
import {
  ARTICLE_CONTRACTIONS,
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

function byId(id: string): CorrectionRule {
  const r = SPANISH_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`missing rule ${id}`);
  return r;
}

/** Every surface form a rule mentions. */
function formsOf(rule: CorrectionRule): string[] {
  switch (rule.kind) {
    case 'swap':
      return rule.groups.flat();
    case 'delete':
      return [...rule.words];
    case 'insert':
      return [rule.word, ...(rule.afterWords ?? [])];
    case 'inflect':
      return [];
  }
}

describe('SPANISH_RULES: shape', () => {
  it('uses only the allowed explainKeys, and every allowed key at least once', () => {
    const allowed = new Set<string>(SPANISH_EXPLAIN_KEYS);
    for (const r of SPANISH_RULES) expect(allowed.has(r.explainKey), r.id).toBe(true);
    const used = new Set(SPANISH_RULES.map((r) => r.explainKey));
    for (const k of SPANISH_EXPLAIN_KEYS) expect(used.has(k), k).toBe(true);
    expect([...SPANISH_EXPLAIN_KEYS].sort()).toEqual(
      ['es.article', 'es.aspect', 'es.gender', 'es.mood', 'es.number', 'es.personal_a', 'es.por_para', 'es.ser_estar'],
    );
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
    expect(swaps.length).toBe(2);
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
    const rank = { swap: 0, inflect: 1, insert: 2, delete: 2 } as const;
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
