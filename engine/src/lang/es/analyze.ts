/**
 * Spanish morphological analysis: normalized word -> possible (lemma, pos, features).
 *
 * Method: a reverse index of every paradigm form of every lexicon lemma, built lazily
 * on first use. Lookup order:
 *   1. exact form (plus slang forms from register packs);
 *   2. enclitic pronouns stripped from infinitives, gerunds and affirmative commands
 *      (leerla, dámelo, comiéndolo, dígame, vámonos, deme), undoing the accent clitics
 *      add; tried also when the word is only a slang form (dímelo), before the slang;
 *   3. accent-insensitive match (esta -> está only when "esta" were unknown; estan ->
 *      están), keeping ñ distinct from n.
 * Results put a noun or adjective in its own dictionary form first (comida: the noun,
 * then the participle of comer), then sort by lemma frequency (most frequent first);
 * standard analyses come before slang ones. chooseSpanishAnalysis picks among them in
 * context.
 */
import type { Analysis, Features, Pos, RegisterPack } from '../types';
import { LEXICON, frequencyRank } from './lexicon';
import { normalize, stripAccents } from './normalize';
import { paradigm, verbParadigm, type ParadigmEntry } from './inflect';
import { verbClass } from './conjugate';
import { accentLastVowel, hasAcute, removeAcute, syllableCount } from './stress';

interface IndexEntry {
  lemma: string;
  pos: Pos;
  features: Features;
  rank: number;
}

/** Tunable analysis settings. */
export interface AnalyzeOptions {
  /** Maximum number of enclitic pronouns stripped from one verb (dándoselo has two). */
  maxClitics: number;
}

/** Defaults: up to two clitics, which covers all common Spanish combinations. */
export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = { maxClitics: 2 };

/** Enclitic pronouns, longest first so "los" is tried before "lo". */
export const CLITICS: readonly string[] = ['nos', 'les', 'los', 'las', 'me', 'te', 'se', 'os', 'lo', 'la', 'le'];

const SLANG_RANK = Number.MAX_SAFE_INTEGER;

function featureKey(f: Features): string {
  return Object.entries(f)
    .filter(([, v]) => v)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

class FormIndex {
  readonly exact = new Map<string, IndexEntry[]>();
  readonly stripped = new Map<string, IndexEntry[]>();
  private readonly seen = new Set<string>();

  add(form: string, e: IndexEntry): void {
    const key = `${form}\u0001${e.lemma}\u0001${e.pos}\u0001${featureKey(e.features)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    push(this.exact, form, e);
    push(this.stripped, stripAccents(form), e);
  }

  addParadigm(lemma: string, pos: Pos, entries: readonly ParadigmEntry[], rank: number): void {
    for (const p of entries) this.add(p.form, { lemma, pos, features: p.features, rank });
  }

  /**
   * Order each list: a noun or adjective written in its own dictionary form first
   * (comida is the noun before the participle of comer, vino the noun before venir), then
   * by lemma frequency. Context (a determiner, haber, a pronoun) is applied later by
   * chooseSpanishAnalysis.
   */
  sort(): void {
    const sortList = (key: string, list: IndexEntry[], keyOf: (lemma: string) => string) => {
      const own = (e: IndexEntry) => ((e.pos === 'NOUN' || e.pos === 'ADJ') && keyOf(e.lemma) === key ? 0 : 1);
      list.sort((a, b) => own(a) - own(b) || a.rank - b.rank);
    };
    for (const [key, list] of this.exact) sortList(key, list, (l) => l);
    for (const [key, list] of this.stripped) sortList(key, list, stripAccents);
  }
}

function push(m: Map<string, IndexEntry[]>, k: string, e: IndexEntry): void {
  const list = m.get(k);
  if (list) list.push(e);
  else m.set(k, [e]);
}

let standardIndex: FormIndex | undefined;

/** The reverse index of all lexicon forms, built once on first use (stable sort keeps data order within a lemma). */
function getStandardIndex(): FormIndex {
  if (standardIndex) return standardIndex;
  const idx = new FormIndex();
  for (const [lemma, pos, gender] of LEXICON) {
    idx.addParadigm(lemma, pos, paradigm(lemma, pos, gender), frequencyRank(lemma) ?? SLANG_RANK);
  }
  idx.sort();
  standardIndex = idx;
  return idx;
}

function toAnalysis(e: IndexEntry): Analysis {
  return { lemma: e.lemma, pos: e.pos, features: { ...e.features } };
}

/** Analyses without duplicates (a slang entry may repeat a standard analysis). */
function distinct(entries: readonly IndexEntry[]): Analysis[] {
  const seen = new Set<string>();
  const out: Analysis[] = [];
  for (const e of entries) {
    const key = `${e.lemma}|${e.pos}|${featureKey(e.features)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toAnalysis(e));
  }
  return out;
}

function isCliticHost(f: Features): boolean {
  if (f.form === 'inf' || f.form === 'ger' || f.mood === 'imp') return true;
  // Usted/ustedes and nosotros commands use present subjunctive forms.
  return f.mood === 'sub' && f.tense === 'pres' && (f.person === '3' || (f.person === '1' && f.number === 'p'));
}

/** Ways to split trailing clitics off a word: [base, clitics] with up to `max` clitics. */
export function cliticSplits(word: string, max: number = DEFAULT_ANALYZE_OPTIONS.maxClitics): [string, string[]][] {
  const out: [string, string[]][] = [];
  const walk = (base: string, clitics: string[]) => {
    if (clitics.length >= max) return;
    for (const c of CLITICS) {
      if (base.length > c.length + 1 && base.endsWith(c)) {
        const rest = base.slice(0, -c.length);
        const cs = [c, ...clitics];
        out.push([rest, cs]);
        walk(rest, cs);
      }
    }
  };
  walk(word, []);
  return out;
}

/**
 * Analyze a word as verb + enclitic pronouns. For each split, try the base as written
 * and without its written accent (dá -> da, comiéndo -> comiendo); a one-syllable base
 * also with an accent (deme, dele: dé, the usted command of dar, loses its accent with a
 * clitic); before nos/se a nosotros command drops its final s (vámonos, digámoselo), so
 * base + "s" is tried too. Only infinitive, gerund, imperative and command-subjunctive
 * analyses are kept.
 */
function cliticAnalyses(word: string, lookup: (form: string) => IndexEntry[], max: number): IndexEntry[] {
  const found: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const [base, clitics] of cliticSplits(word, max)) {
    const bases = new Set([base, removeAcute(base)]);
    if (!hasAcute(base) && syllableCount(base) === 1) bases.add(accentLastVowel(base));
    const first = clitics[0];
    if (first === 'nos' || first === 'se') for (const b of [...bases]) bases.add(b + 's');
    for (const b of bases) {
      for (const e of lookup(b)) {
        if (e.pos !== 'VERB' && e.pos !== 'AUX') continue;
        // A dropped s before nos/se only happens in nosotros forms.
        if (b.endsWith('s') && !base.endsWith('s') && e.features.person !== '1') continue;
        if (!isCliticHost(e.features) && !(e.lemma === 'ir' && b === 'vamos' && first === 'nos')) continue;
        // Usted/ustedes commands never carry the tú/vosotros clitics te/os (siéntate is sentar, not sentir).
        if (e.features.mood === 'sub' && e.features.person === '3' && clitics.some((c) => c === 'te' || c === 'os')) continue;
        const key = `${e.lemma}|${e.pos}|${featureKey(e.features)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(e);
      }
    }
  }
  return found.sort((a, b) => a.rank - b.rank);
}

/**
 * Features of a slang word whose part of speech is given by its entry but cannot be
 * read off its neutral equivalent: infinitive for -ar/-er/-ir verbs; for nouns and
 * adjectives, plural when the form ends in -s (slang entries ending in -s are plurals:
 * lucas, mahones) and feminine when the singular ends in -a, else masculine.
 */
function slangBaseFeatures(pos: Pos, norm: string): Features {
  if (pos === 'VERB' || pos === 'AUX') return verbClass(norm) ? { form: 'inf' } : {};
  if (pos === 'NOUN' || pos === 'ADJ') {
    const plural = norm.endsWith('s');
    const singular = plural ? norm.replace(/e?s$/, '') : norm;
    return { gender: singular.endsWith('a') ? 'f' : 'm', number: plural ? 'p' : 's' };
  }
  return {};
}

/**
 * Build the slang index for register packs: each entry analyzes to its own lemma. The
 * part of speech is the entry's own pos when given, else that of the neutral word.
 */
function buildSlangIndex(registers: readonly RegisterPack[], analyzeStandard: (norm: string) => Analysis[]): FormIndex {
  const idx = new FormIndex();
  for (const reg of registers) {
    for (const entry of reg.entries) {
      const neutralWords = normalize(entry.neutral).split(/\s+/).filter(Boolean);
      const neutralNorm = neutralWords.length === 1 ? (neutralWords[0] as string) : neutralWords[0] ?? '';
      const neutralAnalyses = neutralNorm ? analyzeStandard(neutralNorm) : [];
      const neutral = entry.pos ? neutralAnalyses.find((a) => a.pos === entry.pos) : neutralAnalyses[0];
      const pos: Pos = entry.pos ?? neutral?.pos ?? 'X';
      const norm = normalize(entry.form);
      const features = neutral ? { ...neutral.features } : slangBaseFeatures(pos, norm || entry.norm);
      const forms = new Set([entry.norm, norm].filter(Boolean));
      for (const form of forms) idx.add(form, { lemma: entry.lemma, pos, features, rank: SLANG_RANK });
      if (entry.kind !== 'word') continue;
      // Slang verbs conjugate regularly (janguear -> jangueamos), slang nouns and adjectives inflect.
      if ((pos === 'VERB' || pos === 'AUX') && features.form === 'inf' && verbClass(norm)) {
        idx.addParadigm(entry.lemma, pos, verbParadigm(norm), SLANG_RANK);
      } else if (pos === 'NOUN') {
        const g = features.gender === 'f' ? 'f' : 'm';
        idx.addParadigm(entry.lemma, pos, paradigm(norm, 'NOUN', g), SLANG_RANK);
      } else if (pos === 'ADJ') {
        idx.addParadigm(entry.lemma, pos, paradigm(norm, 'ADJ'), SLANG_RANK);
      }
    }
  }
  idx.sort();
  return idx;
}

/**
 * Create an analyzer, optionally aware of slang register packs. The standard index is
 * shared and built lazily; the slang index is built lazily per analyzer.
 */
export function createAnalyzer(
  registers: readonly RegisterPack[] = [],
  opts: Partial<AnalyzeOptions> = {},
): (norm: string) => Analysis[] {
  const o: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS, ...opts };
  let slang: FormIndex | undefined;
  const getSlang = (): FormIndex => {
    if (!slang) slang = buildSlangIndex(registers, (n) => analyzeWith(n, false));
    return slang;
  };

  function analyzeWith(input: string, withSlang: boolean): Analysis[] {
    const norm = normalize(input) || input;
    if (!norm) return [];
    const std = getStandardIndex();
    const sl = withSlang && registers.length ? getSlang() : undefined;
    const stdExact = std.exact.get(norm) ?? [];
    const slangExact = sl?.exact.get(norm) ?? [];
    if (stdExact.length) return distinct([...stdExact, ...slangExact]);
    // A slang-only exact match does not hide a standard verb + clitic reading (dímelo,
    // dale, hágale are also forms of decir, dar, hacer), which comes first.
    const lookup = (f: string) => [...(std.exact.get(f) ?? []), ...(sl?.exact.get(f) ?? [])];
    const clitic = cliticAnalyses(norm, lookup, o.maxClitics);
    if (clitic.length || slangExact.length) return distinct([...clitic, ...slangExact]);
    const key = stripAccents(norm);
    const loose = [...(std.stripped.get(key) ?? []), ...(sl?.stripped.get(key) ?? [])];
    if (loose.length) return distinct(loose);
    return [];
  }

  return (norm: string) => analyzeWith(norm, true);
}

/**
 * True when `norm` is exactly a form of the standard lexicon (no slang, no clitics, no
 * accent-insensitive match): "tan", "eso" and "mano" are, "'tá" and "tán" are not.
 */
export function isStandardForm(norm: string): boolean {
  return getStandardIndex().exact.has(norm);
}

/** Analyze with the standard lexicon only (no slang). See createAnalyzer. */
export const analyze: (norm: string) => Analysis[] = createAnalyzer();
