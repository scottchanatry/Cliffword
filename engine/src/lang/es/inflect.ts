/**
 * Spanish inflection for all parts of speech.
 *
 * Every lexicon row has a paradigm: the list of its surface forms with their features
 * (verbs from conjugate.ts; nouns and adjectives by gender and number; determiners and
 * pronouns from small tables). inflect() picks the paradigm entry that matches the
 * requested features, and analyze.ts indexes the same paradigms in reverse, so the two
 * directions always agree.
 */
import type { Features, Pos } from '../types';
import { conjugate, participleForm, slotFeatures, verbClass } from './conjugate';
import { lexiconRows, type LexGender } from './lexicon';
import { isFinalStress, suffixKeepingStress } from './stress';

export interface ParadigmEntry {
  form: string;
  features: Features;
  /** Accepted by analysis (buen, hay, rió) but never produced by inflect. */
  alt?: boolean;
}

// ---------------------------------------------------------------- nouns and adjectives

/** Plurals that the rules below do not produce. */
export const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  carácter: 'caracteres', régimen: 'regímenes', espécimen: 'especímenes', club: 'clubes',
  álbum: 'álbumes', sándwich: 'sándwiches', menú: 'menús', esquí: 'esquís', jersey: 'jerséis',
  internet: 'internet', fax: 'faxes', tórax: 'tórax',
};

/**
 * Plural of a noun or adjective.
 *
 * Rules: unstressed vowel or á/é/ó -> +s (casa, café); í -> +es (rubíes); ú -> +s (menús);
 * -s/-x: +es only when the last syllable is stressed (mes, autobús -> autobuses), else
 * unchanged (lunes, crisis); -z -> -ces (luz -> luces); vowel + y -> +es (rey -> reyes);
 * l r n d j -> +es with the stress kept (joven -> jóvenes, canción -> canciones);
 * other consonants -> +s (robot). Irregular plurals come from a table.
 */
export function pluralize(word: string): string {
  const irr = IRREGULAR_PLURALS[word];
  if (irr) return irr;
  const last = word[word.length - 1] ?? '';
  if (!last) return word;
  if ('aeiouáéó'.includes(last)) return word + 's';
  if (last === 'ú') return word + 's';
  if (last === 'í') return word + 'es';
  if (last === 's' || last === 'x') return isFinalStress(word) ? suffixKeepingStress(word, 'es') : word;
  if (last === 'z') return suffixKeepingStress(word, 'ces', 1);
  if (last === 'y') return 'aeiou'.includes(word[word.length - 2] ?? '') ? word + 'es' : word + 's';
  if ('lrndj'.includes(last)) return suffixKeepingStress(word, 'es');
  return word + 's';
}

/** Feminine forms that the rules below do not produce. */
export const IRREGULAR_FEMININES: Readonly<Record<string, string>> = {
  actor: 'actriz', emperador: 'emperatriz', héroe: 'heroína', poeta: 'poetisa',
  alcalde: 'alcaldesa', conde: 'condesa', príncipe: 'princesa', duque: 'duquesa',
  jefe: 'jefa', presidente: 'presidenta', cliente: 'clienta', sirviente: 'sirvienta',
  dependiente: 'dependienta', nene: 'nena', monje: 'monja', gallo: 'gallina',
  barón: 'baronesa', tigre: 'tigresa', español: 'española', andaluz: 'andaluza',
  dios: 'diosa',
};

/** Adjectives in -or and -és that do not change for gender. */
const INVARIABLE_GENDER = new Set([
  'mejor', 'peor', 'mayor', 'menor', 'superior', 'inferior', 'exterior', 'interior',
  'anterior', 'posterior', 'ulterior', 'cortés', 'descortés', 'montés', 'marrón', 'común', 'afín',
]);

/**
 * Feminine of a noun or adjective. -o -> -a (amigo -> amiga); -or -> -ora except
 * comparatives (mejor); stressed -ón/-án/-ín/-és -> +a without the accent (alemán ->
 * alemana, inglés -> inglesa); -ote -> -ota; everything else, including -e, -ista and
 * -a words, keeps its form (grande, artista). Irregular forms come from a table.
 */
export function feminine(word: string): string {
  const irr = IRREGULAR_FEMININES[word];
  if (irr) return irr;
  if (INVARIABLE_GENDER.has(word)) return word;
  if (word.endsWith('o')) return word.slice(0, -1) + 'a';
  if (word.endsWith('or')) return word + 'a';
  if (/(ón|án|ín|és)$/.test(word)) return suffixKeepingStress(word, 'a');
  if (word.endsWith('ote')) return word.slice(0, -1) + 'a';
  return word;
}

/** Shortened masculine-singular forms used before a noun (buen día, gran casa). */
const APOCOPE: Readonly<Record<string, readonly [string, readonly ('m' | 'f')[]]>> = {
  bueno: ['buen', ['m']], malo: ['mal', ['m']], grande: ['gran', ['m', 'f']],
  primero: ['primer', ['m']], tercero: ['tercer', ['m']], santo: ['san', ['m']],
  postrero: ['postrer', ['m']],
};

function gn(gender: string, number: string): Features {
  return { gender, number };
}

function nounParadigm(lemma: string, gender: LexGender): ParadigmEntry[] {
  if (gender === 'c') {
    const fem = feminine(lemma);
    return [
      { form: lemma, features: gn('m', 's') },
      { form: fem, features: gn('f', 's') },
      { form: pluralize(lemma), features: gn('m', 'p') },
      { form: pluralize(fem), features: gn('f', 'p') },
    ];
  }
  return [
    { form: lemma, features: gn(gender, 's') },
    { form: pluralize(lemma), features: gn(gender, 'p') },
  ];
}

function adjectiveParadigm(lemma: string): ParadigmEntry[] {
  const fem = feminine(lemma);
  const out: ParadigmEntry[] = [
    { form: lemma, features: gn('m', 's') },
    { form: fem, features: gn('f', 's') },
    { form: pluralize(lemma), features: gn('m', 'p') },
    { form: pluralize(fem), features: gn('f', 'p') },
  ];
  const ap = APOCOPE[lemma];
  if (ap) for (const g of ap[1]) out.push({ form: ap[0], features: gn(g, 's'), alt: true });
  return out;
}

// ---------------------------------------------------------------- determiners, pronouns

/** Four forms in the order m.s f.s m.p f.p. */
type Four = readonly [string, string, string, string];
const ORDER: readonly Features[] = [gn('m', 's'), gn('f', 's'), gn('m', 'p'), gn('f', 'p')];

/** Determiners whose forms are not regular -o/-a/-os/-as. */
export const DETERMINER_FORMS: Readonly<Record<string, Four>> = {
  el: ['el', 'la', 'los', 'las'],
  un: ['un', 'una', 'unos', 'unas'],
  este: ['este', 'esta', 'estos', 'estas'],
  ese: ['ese', 'esa', 'esos', 'esas'],
  aquel: ['aquel', 'aquella', 'aquellos', 'aquellas'],
  mi: ['mi', 'mi', 'mis', 'mis'],
  tu: ['tu', 'tu', 'tus', 'tus'],
  su: ['su', 'su', 'sus', 'sus'],
  alguno: ['algún', 'alguna', 'algunos', 'algunas'],
  ninguno: ['ningún', 'ninguna', 'ningunos', 'ningunas'],
  cualquiera: ['cualquier', 'cualquier', 'cualesquiera', 'cualesquiera'],
};

/** Determiners and pronouns that exist only in the plural. */
const PLURAL_ONLY: Readonly<Record<string, readonly [string, string]>> = {
  varios: ['varios', 'varias'], ambos: ['ambos', 'ambas'],
};

/** Pronoun-only forms that differ from the determiner (alguno vs algún). */
const PRONOUN_FORMS: Readonly<Record<string, Four>> = {
  este: ['este', 'esta', 'estos', 'estas'],
  ese: ['ese', 'esa', 'esos', 'esas'],
  aquel: ['aquel', 'aquella', 'aquellos', 'aquellas'],
  alguno: ['alguno', 'alguna', 'algunos', 'algunas'],
  ninguno: ['ninguno', 'ninguna', 'ningunos', 'ningunas'],
  cualquiera: ['cualquiera', 'cualquiera', 'cualesquiera', 'cualesquiera'],
  lo: ['lo', 'la', 'los', 'las'],
};

/** Pronouns that inflect like -o/-a/-os/-as adjectives. */
const REGULAR_PRONOUNS = new Set([
  'todo', 'mucho', 'poco', 'otro', 'uno', 'mío', 'tuyo', 'suyo', 'nuestro', 'vuestro',
  'cuánto', 'tanto', 'mismo', 'demasiado',
]);

/** Pronouns with a number-only paradigm. */
const NUMBER_PRONOUNS: Readonly<Record<string, readonly [string, string]>> = {
  quien: ['quien', 'quienes'], quién: ['quién', 'quiénes'], cual: ['cual', 'cuales'],
  cuál: ['cuál', 'cuáles'], le: ['le', 'les'],
};

type PN = { person: string; number: string; gender?: string };
const pn = (person: string, number: string, gender?: string): Features =>
  gender ? { person, number, gender } : { person, number };

/** Subject personal pronouns: the paradigm shared across the yo/tú/él... lemmas. */
export const PERSONAL_PRONOUNS: readonly (readonly [form: string, lemma: string, f: PN])[] = [
  ['yo', 'yo', { person: '1', number: 's' }],
  ['tú', 'tú', { person: '2', number: 's' }],
  ['él', 'él', { person: '3', number: 's', gender: 'm' }],
  ['ella', 'ella', { person: '3', number: 's', gender: 'f' }],
  ['nosotros', 'nosotros', { person: '1', number: 'p', gender: 'm' }],
  ['nosotras', 'nosotros', { person: '1', number: 'p', gender: 'f' }],
  ['vosotros', 'vosotros', { person: '2', number: 'p', gender: 'm' }],
  ['vosotras', 'vosotros', { person: '2', number: 'p', gender: 'f' }],
  ['ellos', 'ellos', { person: '3', number: 'p', gender: 'm' }],
  ['ellas', 'ellos', { person: '3', number: 'p', gender: 'f' }],
];
const PERSONAL_LEMMAS = new Set(PERSONAL_PRONOUNS.map((r) => r[1]));

/** Other pronouns with fixed person/number features. */
const FIXED_PRONOUNS: Readonly<Record<string, Features>> = {
  usted: pn('3', 's'), ustedes: pn('3', 'p'), vos: pn('2', 's'),
  me: pn('1', 's'), te: pn('2', 's'), nos: pn('1', 'p'), os: pn('2', 'p'), se: { person: '3' },
  mí: pn('1', 's'), ti: pn('2', 's'), sí: { person: '3' },
  conmigo: pn('1', 's'), contigo: pn('2', 's'), consigo: { person: '3' },
};

function fourParadigm(forms: Four): ParadigmEntry[] {
  return forms.map((form, i) => ({ form, features: { ...(ORDER[i] as Features) } }));
}

function determinerParadigm(lemma: string): ParadigmEntry[] {
  const four = DETERMINER_FORMS[lemma];
  if (four) {
    const out = fourParadigm(four);
    if (lemma === 'alguno' || lemma === 'ninguno') out.push({ form: lemma, features: gn('m', 's'), alt: true });
    return out;
  }
  const pl = PLURAL_ONLY[lemma];
  if (pl) return [{ form: pl[0], features: gn('m', 'p') }, { form: pl[1], features: gn('f', 'p') }];
  if (lemma.endsWith('o')) return adjectiveParadigm(lemma);
  if (lemma === 'bastante') return [{ form: lemma, features: { number: 's' } }, { form: 'bastantes', features: { number: 'p' } }];
  return [{ form: lemma, features: {} }];
}

function pronounParadigm(lemma: string): ParadigmEntry[] {
  for (const [form, l, f] of PERSONAL_PRONOUNS) if (l === lemma && form === lemma) {
    const out: ParadigmEntry[] = [{ form, features: { ...f } }];
    for (const [form2, l2, f2] of PERSONAL_PRONOUNS) if (l2 === lemma && form2 !== lemma) out.push({ form: form2, features: { ...f2 } });
    return out;
  }
  const fixed = FIXED_PRONOUNS[lemma];
  if (fixed) {
    if (lemma === 'usted') return [{ form: 'usted', features: { ...fixed } }, { form: 'ustedes', features: pn('3', 'p') }];
    return [{ form: lemma, features: { ...fixed } }];
  }
  if (lemma === 'lo') return (PRONOUN_FORMS.lo as Four).map((form, i) => ({ form, features: { person: '3', ...(ORDER[i] as Features) } }));
  if (lemma === 'le') return [{ form: 'le', features: pn('3', 's') }, { form: 'les', features: pn('3', 'p') }];
  const four = PRONOUN_FORMS[lemma];
  if (four) return fourParadigm(four);
  const pl = PLURAL_ONLY[lemma];
  if (pl) return [{ form: pl[0], features: gn('m', 'p') }, { form: pl[1], features: gn('f', 'p') }];
  const np = NUMBER_PRONOUNS[lemma];
  if (np) return [{ form: np[0], features: { number: 's' } }, { form: np[1], features: { number: 'p' } }];
  if (REGULAR_PRONOUNS.has(lemma)) return adjectiveParadigm(lemma);
  return [{ form: lemma, features: {} }];
}

function numeralParadigm(lemma: string): ParadigmEntry[] {
  if (lemma === 'uno') return [{ form: 'uno', features: { gender: 'm' } }, { form: 'una', features: { gender: 'f' } }];
  if (lemma.endsWith('ientos')) return [{ form: lemma, features: { gender: 'm' } }, { form: lemma.slice(0, -2) + 'as', features: { gender: 'f' } }];
  return [{ form: lemma, features: {} }];
}

/**
 * Verb paradigm: infinitive, gerund, participle in four agreement forms, every finite
 * slot, the tú imperative, then alternative spellings. Order matters: inflect() takes
 * the first best match, so canonical forms come first.
 */
export function verbParadigm(lemma: string): ParadigmEntry[] {
  const conj = conjugate(lemma);
  if (!conj) return [];
  const out: ParadigmEntry[] = [];
  for (const [slot, form] of conj.forms) {
    if (slot === 'part') {
      for (const f of ORDER) {
        out.push({ form: participleForm(form, f.gender as string, f.number as string), features: { form: 'part', ...f } });
      }
    } else out.push({ form, features: slotFeatures(slot) });
  }
  for (const [slot, forms] of conj.alts) {
    for (const form of forms) out.push({ form, features: slotFeatures(slot), alt: true });
  }
  return out;
}

/**
 * Paradigm of a lemma for one part of speech: all forms with their features.
 * Uninflected parts of speech (ADV, ADP, CONJ, INTJ...) have the lemma alone with {}.
 */
export function paradigm(lemma: string, pos: Pos, gender?: LexGender): ParadigmEntry[] {
  switch (pos) {
    case 'VERB':
    case 'AUX':
      return verbParadigm(lemma);
    case 'NOUN':
      return nounParadigm(lemma, gender ?? 'm');
    case 'ADJ':
      return adjectiveParadigm(lemma);
    case 'DET':
      return determinerParadigm(lemma);
    case 'PRON':
      return pronounParadigm(lemma);
    case 'NUM':
      return numeralParadigm(lemma);
    default:
      return [{ form: lemma, features: {} }];
  }
}

// ---------------------------------------------------------------- inflect

function cleanFeatures(f: Features): [string, string][] {
  return Object.entries(f).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '');
}

/**
 * Pick the entry that matches every requested feature and has the fewest extra
 * features (ties go to the earlier, more canonical entry). Returns the entry and its
 * extra-feature count, or undefined.
 */
export function bestMatch(entries: readonly ParadigmEntry[], f: Features): { entry: ParadigmEntry; extra: number } | undefined {
  const req = cleanFeatures(f);
  let best: { entry: ParadigmEntry; extra: number } | undefined;
  for (const entry of entries) {
    if (entry.alt) continue;
    if (!req.every(([k, v]) => entry.features[k as keyof Features] === v)) continue;
    const extra = cleanFeatures(entry.features).length - req.length;
    if (!best || extra < best.extra) best = { entry, extra };
  }
  return best;
}

function inflectPersonal(lemma: string, f: Features): string | undefined {
  const own = PERSONAL_PRONOUNS.find((r) => r[0] === lemma)?.[2];
  if (!own) return undefined;
  const target: Features = { ...own, ...Object.fromEntries(cleanFeatures(f)) };
  const gender = target.gender ?? 'm';
  for (const [form, , rf] of PERSONAL_PRONOUNS) {
    if (rf.person === target.person && rf.number === target.number && (rf.gender === undefined || rf.gender === gender)) return form;
  }
  return undefined;
}

const VERBAL_KEYS = new Set(['tense', 'mood', 'person', 'form']);

/**
 * Surface form of `lemma` with `features`, or undefined if Spanish has no such form.
 *
 * Method: gather the paradigms of every lexicon row of the lemma and choose the entry
 * matching all requested features with the fewest extra ones, so inflect("casa",
 * {number:"p"}) picks the noun plural and inflect("poder", {number:"p"}) the noun
 * "poderes" rather than "podemos". Subject pronouns inflect across lemmas
 * (yo -> ellas). Lemmas missing from the lexicon still work when they are infinitives
 * (verbal features) or when only number is asked (pluralize).
 */
export function inflect(lemma: string, features: Features): string | undefined {
  if (PERSONAL_LEMMAS.has(lemma)) return inflectPersonal(lemma, features);
  const rows = lexiconRows(lemma);
  let best: { entry: ParadigmEntry; extra: number } | undefined;
  for (const [l, pos, gender] of rows) {
    const m = bestMatch(paradigm(l, pos, gender), features);
    if (m && (!best || m.extra < best.extra)) best = m;
  }
  if (best) return best.entry.form;
  if (rows.length) return undefined;
  const keys = cleanFeatures(features).map(([k]) => k);
  if (verbClass(lemma) && (keys.length === 0 || keys.some((k) => VERBAL_KEYS.has(k)))) {
    return bestMatch(verbParadigm(lemma), features)?.entry.form;
  }
  if (keys.every((k) => k === 'number')) return features.number === 'p' ? pluralize(lemma) : lemma;
  return undefined;
}
