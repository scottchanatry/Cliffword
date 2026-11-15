/**
 * Spanish verb conjugation.
 *
 * Method: every verb is conjugated regularly from its infinitive (stem + ending for its
 * class -ar/-er/-ir), with four systematic adjustments: stem changes in stressed forms
 * (e>ie, o>ue, e>i, u>ue), spelling rules when an ending is attached (c>qu, g>gu, z>c,
 * gu>gü before e; c>z, g>j, gu>g, -zc- before a/o; y between vowels in -uir and vowel
 * stems such as leer), accent on stressed weak stem vowels (envío), and irregular data
 * from verbData.ts (strong preterites, future stems, irregular yo forms, overrides).
 * Derived tenses follow the textbook rules: present subjunctive from the yo present,
 * imperfect subjunctive (-ra) from the 3rd plural preterite, tú imperative from the 3rd
 * singular present. Prefixed irregulars (mantener, componer, prevenir) are built from
 * their base with the stress kept (ten -> mantén).
 */
import type { Features } from '../types';
import {
  ACCENTED_WEAK_STEM, FINITE_TENSES, IRREGULAR_PARTICIPLES, IRREGULAR_VERBS, NOT_ZC,
  PARTICIPLE_SUFFIXES, PERSONS, PREFIXABLE_BASES, STEM_CHANGES,
  type FiniteTense, type PersonNumber, type Slot, type StemChange, type VerbSpec,
} from './verbData';
import { accentLastVowel, addAcute, isVowel, prefixKeepingStress, removeAcute } from './stress';

export type { Slot, PersonNumber, FiniteTense } from './verbData';
export { PERSONS, FINITE_TENSES } from './verbData';

export type VerbClass = 'ar' | 'er' | 'ir';

/** A full conjugation: one form per slot, plus extra spellings accepted by analysis. */
export interface Conjugation {
  readonly lemma: string;
  readonly forms: ReadonlyMap<Slot, string>;
  readonly alts: ReadonlyMap<Slot, readonly string[]>;
}

const ENDINGS: Record<VerbClass, Record<'ind.pres' | 'ind.pret' | 'ind.impf' | 'sub.pres', readonly string[]> & { ger: string; part: string }> = {
  ar: {
    'ind.pres': ['o', 'as', 'a', 'amos', 'áis', 'an'],
    'ind.pret': ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'],
    'ind.impf': ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'],
    'sub.pres': ['e', 'es', 'e', 'emos', 'éis', 'en'],
    ger: 'ando',
    part: 'ado',
  },
  er: {
    'ind.pres': ['o', 'es', 'e', 'emos', 'éis', 'en'],
    'ind.pret': ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    'ind.impf': ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    'sub.pres': ['a', 'as', 'a', 'amos', 'áis', 'an'],
    ger: 'iendo',
    part: 'ido',
  },
  ir: {
    'ind.pres': ['o', 'es', 'e', 'imos', 'ís', 'en'],
    'ind.pret': ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    'ind.impf': ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    'sub.pres': ['a', 'as', 'a', 'amos', 'áis', 'an'],
    ger: 'iendo',
    part: 'ido',
  },
};
const FUT_ENDINGS = ['é', 'ás', 'á', 'emos', 'éis', 'án'];
const COND_ENDINGS = ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'];
const STRONG_PRET_ENDINGS = ['e', 'iste', 'o', 'imos', 'isteis', 'ieron'];
/** Persons whose present forms are stressed on the stem. */
const STEM_STRESSED = new Set<PersonNumber>(['1s', '2s', '3s', '3p']);

/** Class, stem and future base of an infinitive, or undefined if it is not one. */
export function verbClass(lemma: string): { cls: VerbClass; stem: string; futBase: string } | undefined {
  if (lemma.endsWith('ír')) return { cls: 'ir', stem: lemma.slice(0, -2), futBase: removeAcute(lemma) };
  const m = /(ar|er|ir)$/.exec(lemma);
  if (!m || !/^[a-zñáéíóúü]+$/.test(lemma)) return undefined;
  return { cls: m[1] as VerbClass, stem: lemma.slice(0, -2), futBase: lemma };
}

function replaceLast(s: string, target: string, by: string): string {
  const i = s.lastIndexOf(target);
  return i < 0 ? s : s.slice(0, i) + by + s.slice(i + target.length);
}

/**
 * Apply a stem change. strong = stem-stressed forms (piens-, vuelv-, pid-, jueg-);
 * weak = the -ir weakening (sint-, durm-). Only the last matching vowel changes, and
 * ue after g is written üe (avergüenzo).
 */
export function changeStem(stem: string, change: StemChange | undefined, strength: 'strong' | 'weak'): string {
  if (!change) return stem;
  if (strength === 'weak') {
    if (change === 'ie' || change === 'i') return replaceLast(stem, 'e', 'i');
    if (change === 'ue') return replaceLast(stem, 'o', 'u');
    return stem;
  }
  switch (change) {
    case 'ie': return replaceLast(stem, 'e', 'ie');
    case 'i': return replaceLast(stem, 'e', 'i');
    case 'uue': return replaceLast(stem, 'u', 'ue');
    case 'iie': return replaceLast(stem, 'i', 'ie');
    case 'ue': {
      const i = stem.lastIndexOf('o');
      if (i < 0) return stem;
      return stem.slice(0, i) + (stem[i - 1] === 'g' ? 'üe' : 'ue') + stem.slice(i + 1);
    }
  }
}

/**
 * Attach an ending to a stem with Spanish spelling rules.
 *
 * -ar before e: gu>gü, c>qu, g>gu, z>c (averigüé, busqué, llegué, empecé).
 * -er/-ir before a/o: c>zc for -zc- verbs (conozco), gu>g (sigo), qu>c, c>z (venzo),
 * g>j (elijo). After ñ or ll an unstressed i before a vowel drops (tiñó). After a vowel
 * stem (le-, ca-, o-) an unstressed i before a vowel becomes y (leyó) and before a
 * consonant takes an accent (leíste); -uir stems insert y before a, e, o (construyo).
 */
export function joinEnding(stem: string, ending: string, cls: VerbClass, zc = false): string {
  if (!ending) return stem;
  const e0 = ending[0] as string;
  /** First letter without its accent, for the spelling checks. */
  const p0 = removeAcute(e0);
  if (cls === 'ar') {
    if (p0 === 'e') {
      if (stem.endsWith('gu')) return stem.slice(0, -2) + 'gü' + ending;
      if (stem.endsWith('c')) return stem.slice(0, -1) + 'qu' + ending;
      if (stem.endsWith('g')) return stem.slice(0, -1) + 'gu' + ending;
      if (stem.endsWith('z')) return stem.slice(0, -1) + 'c' + ending;
    }
    return stem + ending;
  }
  if (p0 === 'a' || p0 === 'o') {
    if (zc && stem.endsWith('c')) return stem.slice(0, -1) + 'zc' + ending;
    if (stem.endsWith('gu')) return stem.slice(0, -2) + 'g' + ending;
    if (stem.endsWith('qu')) return stem.slice(0, -2) + 'c' + ending;
    if (stem.endsWith('c')) return stem.slice(0, -1) + 'z' + ending;
    if (stem.endsWith('g')) return stem.slice(0, -1) + 'j' + ending;
  }
  const last = stem[stem.length - 1];
  if ((last === 'ñ' || stem.endsWith('ll')) && e0 === 'i' && isVowel(ending[1])) return stem + ending.slice(1);
  const uir = cls === 'ir' && last === 'u' && !/[gq]u$/.test(stem);
  const vowelStem = last !== undefined && 'aeo'.includes(last);
  if (uir || vowelStem) {
    if (e0 === 'i') {
      if (isVowel(ending[1])) return stem + 'y' + ending.slice(1);
      return vowelStem ? stem + 'í' + ending.slice(1) : stem + ending;
    }
    if (uir && 'aeo'.includes(p0)) return stem + 'y' + ending;
  }
  return stem + ending;
}

/** Accent the last i/u of a stem (envi -> enví, reun -> reún). */
function accentWeakVowel(stem: string): string {
  for (let k = stem.length - 1; k >= 0; k--) {
    const ch = stem[k];
    if (ch === 'i' || ch === 'u') return addAcute(stem, k);
  }
  return stem;
}

function slotOf(tense: FiniteTense, p: PersonNumber): Slot {
  return `${tense}.${p}` as Slot;
}

function regularParticiple(lemma: string): string | undefined {
  const exact = IRREGULAR_PARTICIPLES.get(lemma);
  if (exact) return exact;
  for (const [suffix, part] of PARTICIPLE_SUFFIXES) {
    if (lemma.endsWith(suffix)) return lemma.slice(0, lemma.length - suffix.length) + part;
  }
  return undefined;
}

/** Find a prefixed irregular (obtener = ob + tener). */
function prefixedBase(lemma: string): { prefix: string; base: string } | undefined {
  let best: { prefix: string; base: string } | undefined;
  for (const [base, prefixes] of PREFIXABLE_BASES) {
    if (lemma.length <= base.length || !lemma.endsWith(base)) continue;
    const prefix = lemma.slice(0, lemma.length - base.length);
    if (prefixes.length && !prefixes.includes(prefix)) continue;
    if (!best || base.length > best.base.length) best = { prefix, base };
  }
  return best;
}

function build(lemma: string, spec: VerbSpec): Conjugation | undefined {
  const vc = verbClass(lemma);
  if (!vc) return undefined;
  const { cls, stem, futBase } = vc;
  const end = ENDINGS[cls];
  const change = STEM_CHANGES.get(lemma);
  const zc = /[aeiouáéíóú]c(er|ir)$/.test(lemma) && !NOT_ZC.has(lemma);
  let strong = changeStem(stem, change, 'strong');
  if (ACCENTED_WEAK_STEM.has(lemma)) strong = accentWeakVowel(strong);
  const weak = cls === 'ir' ? changeStem(stem, change, 'weak') : stem;
  const pretStem = spec.pretStem ?? (lemma.endsWith('ducir') ? lemma.slice(0, -3) + 'j' : undefined);
  const ov = spec.overrides ?? {};
  const forms = new Map<Slot, string>();
  const set = (slot: Slot, computed: string) => forms.set(slot, ov[slot] ?? computed);
  const join = (s: string, e: string) => joinEnding(s, e, cls, zc);

  set('inf', lemma);
  PERSONS.forEach((p, i) => {
    const e = end['ind.pres'][i] as string;
    set(slotOf('ind.pres', p), p === '1s' && spec.pres1s ? spec.pres1s : join(STEM_STRESSED.has(p) ? strong : stem, e));
  });
  PERSONS.forEach((p, i) => {
    let f: string;
    if (pretStem) {
      const e = STRONG_PRET_ENDINGS[i] as string;
      f = pretStem + (p === '3p' && pretStem.endsWith('j') ? 'eron' : e);
    } else {
      f = join(p === '3s' || p === '3p' ? weak : stem, end['ind.pret'][i] as string);
    }
    set(slotOf('ind.pret', p), f);
  });
  PERSONS.forEach((p, i) => set(slotOf('ind.impf', p), join(stem, end['ind.impf'][i] as string)));
  const fut = spec.futStem ?? futBase;
  PERSONS.forEach((p, i) => {
    set(slotOf('ind.fut', p), fut + (FUT_ENDINGS[i] as string));
    set(slotOf('ind.cond', p), fut + (COND_ENDINGS[i] as string));
  });
  const irregular1s = spec.pres1s ?? ov['ind.pres.1s'];
  const subStem = spec.subStem ?? (irregular1s && irregular1s.endsWith('o') ? irregular1s.slice(0, -1) : undefined);
  PERSONS.forEach((p, i) => {
    const e = end['sub.pres'][i] as string;
    const f = subStem !== undefined ? subStem + e : join(STEM_STRESSED.has(p) ? strong : weak, e);
    set(slotOf('sub.pres', p), f);
  });
  const pret3p = forms.get('ind.pret.3p') as string;
  const base = pret3p.endsWith('ron') ? pret3p.slice(0, -3) : pret3p;
  const subImpf = [base + 'ra', base + 'ras', base + 'ra', accentLastVowel(base) + 'ramos', base + 'rais', base + 'ran'];
  PERSONS.forEach((p, i) => set(slotOf('sub.impf', p), subImpf[i] as string));
  set('imp.2s', spec.imp ?? (forms.get('ind.pres.3s') as string));
  set('ger', spec.ger ?? join(weak, end.ger));
  set('part', spec.part ?? regularParticiple(lemma) ?? join(stem, end.part));

  const alts = new Map<Slot, readonly string[]>();
  for (const [slot, list] of Object.entries(spec.alts ?? {})) if (list) alts.set(slot as Slot, list);
  // The -se imperfect subjunctive (hablase, fuese, tuviésemos), built on the same base as
  // the -ra forms: common in Spain, literature and lyrics, so it must analyze.
  const subImpfSe = [base + 'se', base + 'ses', base + 'se', accentLastVowel(base) + 'semos', base + 'seis', base + 'sen'];
  PERSONS.forEach((p, i) => {
    const slot = slotOf('sub.impf', p);
    alts.set(slot, [...(alts.get(slot) ?? []), subImpfSe[i] as string]);
  });
  return { lemma, forms, alts };
}

function derive(lemma: string, prefix: string, baseConj: Conjugation, base: string): Conjugation {
  const forms = new Map<Slot, string>();
  for (const [slot, f] of baseConj.forms) forms.set(slot, slot === 'inf' ? lemma : prefixKeepingStress(prefix, f));
  if (base === 'decir') forms.set('imp.2s', prefix + 'dice');
  const alts = new Map<Slot, readonly string[]>();
  for (const [slot, list] of baseConj.alts) alts.set(slot, list.map((f) => prefixKeepingStress(prefix, f)));
  return { lemma, forms, alts };
}

const cache = new Map<string, Conjugation | undefined>();

/**
 * Conjugate a Spanish infinitive into all slots (7 finite tenses x 6 persons, tú
 * imperative, infinitive, gerund, participle). Returns undefined if `lemma` is not an
 * infinitive. Results are cached; the function is pure.
 */
export function conjugate(lemma: string): Conjugation | undefined {
  if (cache.has(lemma)) return cache.get(lemma);
  let result: Conjugation | undefined;
  const spec = IRREGULAR_VERBS.get(lemma);
  if (spec) result = build(lemma, spec);
  else {
    const pb = prefixedBase(lemma);
    const baseConj = pb ? conjugate(pb.base) : undefined;
    result = pb && baseConj ? derive(lemma, pb.prefix, baseConj, pb.base) : build(lemma, {});
  }
  cache.set(lemma, result);
  return result;
}

/** Features of a slot, in the contract's codes. Participle gets masculine singular. */
export function slotFeatures(slot: Slot): Features {
  if (slot === 'inf') return { form: 'inf' };
  if (slot === 'ger') return { form: 'ger' };
  if (slot === 'part') return { form: 'part', gender: 'm', number: 's' };
  if (slot === 'imp.2s') return { form: 'fin', mood: 'imp', person: '2', number: 's' };
  const [mood, tense, pn] = slot.split('.') as [string, string, string];
  return { form: 'fin', mood, tense, person: pn[0] as string, number: pn[1] as string };
}

/**
 * Slot for a set of verb features, or undefined if the combination does not exist.
 * Missing values default to: form fin, mood ind, person 3, number s; a finite form needs
 * a tense unless it is imperative. Imperative exists only for tú (2s); subjunctive only
 * in pres and impf.
 */
export function featuresSlot(f: Features): Slot | undefined {
  const form = f.form ?? 'fin';
  if (form === 'inf' || form === 'ger' || form === 'part') return form;
  if (form !== 'fin') return undefined;
  const mood = f.mood ?? 'ind';
  const person = f.person ?? (mood === 'imp' ? '2' : '3');
  const number = f.number ?? 's';
  if (mood === 'imp') return person === '2' && number === 's' ? 'imp.2s' : undefined;
  const tense = f.tense;
  if (!tense || !['1', '2', '3'].includes(person) || !['s', 'p'].includes(number)) return undefined;
  const ft = `${mood}.${tense}` as FiniteTense;
  if (!FINITE_TENSES.includes(ft)) return undefined;
  return `${ft}.${person}${number}` as Slot;
}

/** Participle agreeing in gender and number (hecho, hecha, hechos, hechas). */
export function participleForm(part: string, gender: string, number: string): string {
  const fem = gender === 'f' && part.endsWith('o') ? part.slice(0, -1) + 'a' : part;
  return number === 'p' ? fem + 's' : fem;
}

/**
 * Conjugated form for features (see featuresSlot for defaults), or undefined.
 * Participles agree in gender and number when given.
 */
export function conjugateForm(lemma: string, f: Features): string | undefined {
  const conj = conjugate(lemma);
  if (!conj) return undefined;
  const slot = featuresSlot(f);
  if (!slot) return undefined;
  const form = conj.forms.get(slot);
  if (form && slot === 'part') return participleForm(form, f.gender ?? 'm', f.number ?? 's');
  return form;
}
