/**
 * Rule-made variants of a learner sentence.
 *
 * The model only scores; it never explains. This file turns the language pack's
 * correction rules (data) into concrete alternative sentences, each tagged with the
 * rule that made it and the exact character span it changed. judge.ts then scores the
 * variants against the original and lets the winning rule supply the explanation.
 *
 * Everything goes through the language pack: words come from pack.segment (spaces are
 * never assumed to separate words), lookups use segment norms, analyses come from
 * pack.analyze and new forms from pack.inflect.
 */
import type {
  Analysis,
  CorrectionRule,
  DeleteRule,
  InflectRule,
  InsertRule,
  LanguagePack,
  Register,
  Pos,
  RegisterPack,
  Segment,
  SwapRule,
} from '../lang/types';
import { chooseAnalysesInText } from '../lang/choose';

/** Register the learner is speaking in (shared contract type; see lang/types). */
export type { Register } from '../lang/types';

export interface VariantOptions {
  /** In "street" register, rules with streetTolerant are skipped. */
  register: Register;
  /** At most this many variants are returned; the rest are counted as dropped. */
  maxVariants: number;
  /**
   * Drop an inserted word whose gender or number (from pack.analyze) clashes with the
   * word it is inserted before, e.g. "la" before "mercado". Language-neutral: it only
   * compares the gender and number features and is a no-op where words carry none.
   */
  agreeInserted: boolean;
  /**
   * Treat a capitalized word the pack does not know, away from a sentence start, as a
   * proper noun (PROPN), as story selection does: "Veo Marta" gets "Veo a Marta".
   */
  capitalizedUnknownAsPropn: boolean;
}

/** Defaults for variant generation. */
export const DEFAULT_VARIANT_OPTIONS: Readonly<VariantOptions> = {
  register: 'neutral',
  /** Each variant costs one scoreContinuation call. set from proof/RESULTS.md (speed: one sentence plus N variants). */
  maxVariants: 16,
  agreeInserted: true,
  capitalizedUnknownAsPropn: true,
};

/**
 * One alternative sentence. Invariant:
 * text === original sentence.slice(0, start) + replacement + original sentence.slice(end),
 * and `original` === original sentence.slice(start, end).
 */
export interface Variant {
  /** The full variant sentence. */
  text: string;
  /** CorrectionRule.id of the rule that made it. */
  ruleId: string;
  /** CorrectionRule.explainKey of that rule. */
  explainKey: string;
  /** Kind of the rule that made it. */
  kind: CorrectionRule['kind'];
  /** Start of the edited span in the original sentence (inclusive). */
  start: number;
  /** End of the edited span in the original sentence (exclusive). Equal to start for a pure insert. */
  end: number;
  /** Original text of the span ('' for a pure insert). */
  original: string;
  /** Text that replaces the span ('' for a pure delete). */
  replacement: string;
  /**
   * Index, among the word segments of the original, of the word the edit is about: the
   * replaced or deleted word, or the word an insert goes in front of. Used for shading.
   */
  wordIndex: number;
}

export interface VariantSet {
  /** Variants in priority order, deduplicated, at most maxVariants of them. */
  variants: Variant[];
  /** Distinct variants generated before the cap. */
  generated: number;
  /** Distinct variants cut by the cap (generated - variants.length). */
  dropped: number;
}

/** A word segment with its position and lookups resolved. */
interface Word {
  seg: Segment;
  /** Index among word segments. */
  index: number;
  /** Index among all segments. */
  segIndex: number;
  norm: string;
  /** Slang entry (or part of a slang phrase): never edited, nothing inserted before it. */
  protected: boolean;
  /** The analysis chosen in context (lang/choose.ts); undefined for unknown words. */
  chosen: Analysis | undefined;
  /**
   * Every analysis with the chosen lemma and part of speech: the readings of the chosen
   * word ("era" is first and third person of ser), without its homographs (casa/casar).
   */
  readings: Analysis[];
  /** Part of speech of `chosen`, or PROPN for a capitalized unknown word mid-sentence. */
  pos: Pos | undefined;
  /** Index of the word's sentence in the text. */
  sentence: number;
}

interface Candidate {
  variant: Variant;
  kindRank: number;
  ruleIndex: number;
  seq: number;
}

/**
 * Priority of rule kinds when variants are capped: swaps first (cheap, targeted,
 * usually the classic learner errors), then inflections, then inserts and deletes,
 * which change sentence length and are the least reliable to score.
 */
export const KIND_PRIORITY: Readonly<Record<CorrectionRule['kind'], number>> = {
  swap: 0,
  inflect: 1,
  insert: 2,
  delete: 2,
};

const LETTERS_RE = /[\p{L}\p{M}]/u;
const UPPER_RE = /\p{Lu}/u;
const LOWER_RE = /\p{Ll}/u;
const EDGE_LEAD_RE = /^[^\p{L}\p{M}\p{N}'’ʼ]*/u;
const EDGE_TRAIL_RE = /[^\p{L}\p{M}\p{N}'’ʼ]*$/u;
/** Sentence-final punctuation; a word after it starts a sentence. */
const SENTENCE_END_RE = /[.!?…。？！]$/u;
/** Opening marks that may sit between a sentence start and its first word. */
const OPENING_RE = /^[¿¡«“‘„"'(\[{]+$/u;

// ---------------------------------------------------------------------------
// Case handling
// ---------------------------------------------------------------------------

/** First letter of `s` (skipping leading apostrophes or other non-letters), or ''. */
function firstLetter(s: string): string {
  for (const ch of s) if (LETTERS_RE.test(ch)) return ch;
  return '';
}

/** True if the first letter of `s` is uppercase. */
export function startsUpper(s: string): boolean {
  const ch = firstLetter(s);
  return ch !== '' && UPPER_RE.test(ch);
}

/** True if `s` has at least two letters and none of them is lowercase ("SOY", not "A"). */
export function isAllCaps(s: string): boolean {
  let letters = 0;
  for (const ch of s) {
    if (!LETTERS_RE.test(ch)) continue;
    letters++;
    if (LOWER_RE.test(ch)) return false;
  }
  return letters >= 2;
}

/** Uppercase the first letter of `s`, leaving the rest unchanged. */
export function capitalizeFirst(s: string): string {
  const ch = firstLetter(s);
  if (!ch) return s;
  const i = s.indexOf(ch);
  return s.slice(0, i) + ch.toUpperCase() + s.slice(i + ch.length);
}

/** Lowercase the first letter of `s`, leaving the rest unchanged. */
export function lowercaseFirst(s: string): string {
  const ch = firstLetter(s);
  if (!ch) return s;
  const i = s.indexOf(ch);
  return s.slice(0, i) + ch.toLowerCase() + s.slice(i + ch.length);
}

/**
 * Give `word` the capitalization pattern of `model`: all caps if the model is all caps
 * (two or more letters, none lowercase), first letter capitalized if the model's first
 * letter is uppercase, otherwise `word` unchanged. Rule forms are written lowercase, so
 * "Soy" + "estoy" -> "Estoy", "SOY" + "estoy" -> "ESTOY", "soy" + "estoy" -> "estoy".
 */
export function matchCase(model: string, word: string): string {
  if (isAllCaps(model)) return word.toUpperCase();
  if (startsUpper(model)) return capitalizeFirst(word);
  return word;
}

// ---------------------------------------------------------------------------
// Slang protection
// ---------------------------------------------------------------------------

/** Slang entries of a pack's register packs, indexed for matching against sentence words. */
export interface SlangIndex {
  /** Normalized single-word slang forms. */
  single: Set<string>;
  /** Multi-word slang entries as sequences of normalized words. */
  phrases: string[][];
  /**
   * Single forms, and phrases (words joined by one space), of entries marked
   * SlangEntry.alsoStandard: standard words too (guapo, bajo, dale; "de una", "qué más").
   */
  alsoStandard: Set<string>;
}

const slangCache = new WeakMap<LanguagePack, { registers: readonly RegisterPack[]; index: SlangIndex }>();

/**
 * Index the slang entries of every register pack: single words by norm (both the
 * stored norm and pack.normalize(form)), phrases as word-norm sequences obtained by
 * segmenting the entry's form with the pack, and the forms of entries marked
 * alsoStandard. Cached per pack and registers array.
 */
export function slangIndex(pack: LanguagePack): SlangIndex {
  const hit = slangCache.get(pack);
  if (hit && hit.registers === pack.registers) return hit.index;
  const single = new Set<string>();
  const phrases: string[][] = [];
  const alsoStandard = new Set<string>();
  for (const reg of pack.registers) {
    for (const e of reg.entries) {
      const words = pack
        .segment(e.form)
        .filter((s) => s.kind === 'word')
        .map((s) => s.norm || pack.normalize(s.text))
        .filter((n) => n !== '');
      if (words.length > 1) {
        phrases.push(words);
        if (e.alsoStandard) alsoStandard.add(words.join(' '));
        continue;
      }
      const forms = [e.norm, pack.normalize(e.form), words[0]].filter((f): f is string => !!f);
      for (const f of forms) {
        single.add(f);
        if (e.alsoStandard) alsoStandard.add(f);
      }
    }
  }
  const index = { single, phrases, alsoStandard };
  slangCache.set(pack, { registers: pack.registers, index });
  return index;
}

/**
 * Word indices covered by a slang entry: any single slang word, or every word of a
 * matched phrase. In neutral register (the learner is speaking standard Spanish, say),
 * entries that are also standard words are left out: "Ella es muy guapo" must still be
 * corrected, and the phrase "de una" must not hide "de una parque". Street register (the
 * default) covers every entry.
 */
export function slangWordIndices(pack: LanguagePack, norms: readonly string[], register: Register = 'street'): Set<number> {
  const idx = slangIndex(pack);
  const skip = register === 'neutral' ? idx.alsoStandard : new Set<string>();
  const out = new Set<number>();
  norms.forEach((n, i) => {
    if (idx.single.has(n) && !skip.has(n)) out.add(i);
  });
  for (const phrase of idx.phrases) {
    if (skip.has(phrase.join(' '))) continue;
    for (let i = 0; i + phrase.length <= norms.length; i++) {
      let ok = true;
      for (let j = 0; j < phrase.length; j++) {
        if (norms[i + j] !== phrase[j]) {
          ok = false;
          break;
        }
      }
      if (ok) for (let j = 0; j < phrase.length; j++) out.add(i + j);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sentence context helpers
// ---------------------------------------------------------------------------

/**
 * Word segments of `segments`, with norms, slang protection (for the register), the
 * analysis chosen in context and the sentence index resolved.
 */
function collectWords(
  pack: LanguagePack,
  segments: readonly Segment[],
  analyze: (norm: string) => Analysis[],
  o: VariantOptions,
): Word[] {
  const starts = segments.map((s, i) => s.kind === 'word' && atSentenceStart(segments, i));
  const words: Word[] = [];
  let sentence = -1;
  for (const c of chooseAnalysesInText(pack, segments, starts, analyze)) {
    const seg = segments[c.segIndex] as Segment;
    if (starts[c.segIndex] || sentence < 0) sentence++;
    let pos: Pos | undefined = c.chosen?.pos;
    if (!c.chosen && c.capitalizedMidSentence && o.capitalizedUnknownAsPropn) pos = 'PROPN';
    const ch = c.chosen;
    const readings = ch ? c.analyses.filter((a) => a.lemma === ch.lemma && a.pos === ch.pos) : [];
    words.push({ seg, index: words.length, segIndex: c.segIndex, norm: c.norm, protected: false, chosen: ch, readings, pos, sentence });
  }
  const prot = slangWordIndices(
    pack,
    words.map((w) => w.norm),
    o.register,
  );
  for (const w of words) w.protected = prot.has(w.index);
  return words;
}

/**
 * True if the word at segIndex starts a sentence: walking left over spaces and opening
 * marks (¿ ¡ « quotes, brackets) reaches the start of the text or sentence-final
 * punctuation.
 */
function atSentenceStart(segments: readonly Segment[], segIndex: number): boolean {
  for (let i = segIndex - 1; i >= 0; i--) {
    const s = segments[i] as Segment;
    if (s.kind === 'space') continue;
    if (s.kind === 'punct' && OPENING_RE.test(s.text)) continue;
    return s.kind === 'punct' && SENTENCE_END_RE.test(s.text);
  }
  return true;
}

/** The previous word if only spaces separate it from words[i]; punctuation in between breaks adjacency. */
function adjacentPrevWord(segments: readonly Segment[], words: readonly Word[], i: number): Word | undefined {
  const w = words[i];
  const prev = words[i - 1];
  if (!w || !prev) return undefined;
  for (let s = prev.segIndex + 1; s < w.segIndex; s++) {
    if ((segments[s] as Segment).kind !== 'space') return undefined;
  }
  return prev;
}

/** The next word if only spaces separate it from words[i]. */
function adjacentNextWord(segments: readonly Segment[], words: readonly Word[], i: number): Word | undefined {
  const w = words[i];
  const next = words[i + 1];
  if (!w || !next) return undefined;
  for (let s = w.segIndex + 1; s < next.segIndex; s++) {
    if ((segments[s] as Segment).kind !== 'space') return undefined;
  }
  return next;
}

/**
 * Separator to put between an inserted word and the word after it: the whitespace
 * already in front of that word, else the first whitespace in the sentence, else ''
 * (for scripts written without spaces).
 */
function insertSeparator(segments: readonly Segment[], segIndex: number): string {
  const before = segments[segIndex - 1];
  if (before && before.kind === 'space') return before.text;
  const anySpace = segments.find((s) => s.kind === 'space');
  return anySpace ? ' ' : '';
}

/** Replace the core of a word segment (keeping edge punctuation the segmenter left on it). */
function replaceCore(segText: string, replacement: string): string {
  const lead = EDGE_LEAD_RE.exec(segText)?.[0] ?? '';
  const rest = segText.slice(lead.length);
  const trail = EDGE_TRAIL_RE.exec(rest)?.[0] ?? '';
  const core = rest.slice(0, rest.length - trail.length);
  return lead + matchCase(core || segText, replacement) + trail;
}

function makeVariant(
  text: string,
  rule: CorrectionRule,
  start: number,
  end: number,
  replacement: string,
  wordIndex: number,
): Variant {
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    ruleId: rule.id,
    explainKey: rule.explainKey,
    kind: rule.kind,
    start,
    end,
    original: text.slice(start, end),
    replacement,
    wordIndex,
  };
}

// ---------------------------------------------------------------------------
// Per-kind generators
// ---------------------------------------------------------------------------

/**
 * Swap: for each unprotected word whose norm is in a group, propose every other member
 * of every group that contains it, with the word's capitalization.
 */
function swapVariants(pack: LanguagePack, text: string, words: readonly Word[], rule: SwapRule): Variant[] {
  const alternatives = new Map<string, string[]>();
  for (const group of rule.groups) {
    const norms = group.map((g) => pack.normalize(g));
    norms.forEach((n, i) => {
      const list = alternatives.get(n) ?? [];
      group.forEach((form, j) => {
        if (j !== i && norms[j] !== n && !list.includes(form)) list.push(form);
      });
      alternatives.set(n, list);
    });
  }
  const out: Variant[] = [];
  for (const w of words) {
    if (w.protected) continue;
    for (const form of alternatives.get(w.norm) ?? []) {
      out.push(makeVariant(text, rule, w.seg.start, w.seg.end, replaceCore(w.seg.text, form), w.index));
    }
  }
  return out;
}

/**
 * Inflect: for each unprotected word and each of its readings (the analyses with the
 * lemma and part of speech chosen in context) whose POS is in rule.pos and whose value of
 * rule.feature is one of rule.values, ask pack.inflect for the same lemma and features
 * with every other value. Homographs are left alone: the verb readings of nouns and
 * prepositions (casa/casar, para/parar) make no variants. With rule.cueWords, a value in
 * rule.cueFor (every value without it) is changed only when a cue word occurs earlier in
 * the sentence. Forms the pack cannot produce, or that normalize to the word itself
 * (invariant adjectives such as "grande"), are skipped.
 */
function inflectVariants(pack: LanguagePack, text: string, words: readonly Word[], rule: InflectRule): Variant[] {
  const out: Variant[] = [];
  const cues = rule.cueWords ? new Set(rule.cueWords.map((c) => pack.normalize(c))) : undefined;
  for (const w of words) {
    if (w.protected) continue;
    const cued = () => words.some((x) => x.sentence === w.sentence && x.index < w.index && cues?.has(x.norm));
    const seen = new Set<string>();
    for (const a of w.readings) {
      if (!rule.pos.includes(a.pos)) continue;
      const current = a.features[rule.feature];
      if (current === undefined || !rule.values.includes(current)) continue;
      if (cues && (rule.cueFor === undefined || rule.cueFor.includes(current)) && !cued()) continue;
      for (const value of rule.values) {
        if (value === current) continue;
        const form = pack.inflect(a.lemma, { ...a.features, [rule.feature]: value });
        if (!form) continue;
        const norm = pack.normalize(form);
        if (norm === w.norm || seen.has(norm)) continue;
        seen.add(norm);
        out.push(makeVariant(text, rule, w.seg.start, w.seg.end, replaceCore(w.seg.text, form), w.index));
      }
    }
  }
  return out;
}

/**
 * True unless every pairing of analyses disagrees on gender or number. Unknown words
 * never clash. When the inserted word has determiner analyses, only those count ("una"
 * is also a form of unir, which carries no gender).
 */
function agrees(insertedAll: readonly Analysis[], next: readonly Analysis[]): boolean {
  const dets = insertedAll.filter((a) => a.pos === 'DET');
  const inserted = dets.length > 0 ? dets : insertedAll;
  if (inserted.length === 0 || next.length === 0) return true;
  for (const a of inserted) {
    for (const b of next) {
      let clash = false;
      for (const f of ['gender', 'number'] as const) {
        const x = a.features[f];
        const y = b.features[f];
        if (x !== undefined && y !== undefined && x !== y) clash = true;
      }
      if (!clash) return true;
    }
  }
  return false;
}

/**
 * Insert: put rule.word in front of each unprotected word whose chosen analysis has a POS
 * in rule.beforePos or a lemma in rule.beforeLemmas (any word if neither is given), or in
 * front of a run of rule.throughPos words leading to such a word ("Veo [a] mi madre"). If
 * afterPos or afterWords is given, the word directly before (only spaces in between) must
 * have its chosen POS in afterPos or a norm in afterWords; with neither given the insert
 * may also open the sentence. Never inserts a word next to an identical word ("a a"),
 * after rule.notAfterWords or before rule.notBeforeWords. The inserted word must agree in
 * gender and number with the next word (opts.agreeInserted), except before
 * rule.agreementExceptions. At a sentence start the inserted word takes the capital and
 * the next word is lowercased unless it is a proper noun.
 */
function insertVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: InsertRule,
  analyze: (norm: string) => Analysis[],
  opts: VariantOptions,
): Variant[] {
  const out: Variant[] = [];
  const insNorm = pack.normalize(rule.word);
  const insAnalyses = analyze(insNorm);
  const norms = (list: readonly string[] | undefined) => (list ? new Set(list.map((w) => pack.normalize(w))) : undefined);
  const afterWords = norms(rule.afterWords);
  const notAfter = norms(rule.notAfterWords);
  const notBefore = norms(rule.notBeforeWords);
  const exceptions = norms(rule.agreementExceptions);
  const needsPrev = rule.afterPos !== undefined || afterWords !== undefined;
  const anyWord = rule.beforePos === undefined && rule.beforeLemmas === undefined;
  const matches = (x: Word) =>
    anyWord ||
    (x.pos !== undefined && rule.beforePos?.includes(x.pos) === true) ||
    (x.chosen !== undefined && rule.beforeLemmas?.includes(x.chosen.lemma) === true);
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    if (w.protected || w.norm === insNorm || notBefore?.has(w.norm)) continue;
    let target: Word | undefined = w;
    while (target && !matches(target)) {
      if (!rule.throughPos || target.pos === undefined || !rule.throughPos.includes(target.pos)) target = undefined;
      else target = adjacentNextWord(segments, words, target.index);
    }
    if (!target || target.protected) continue;
    const prev = adjacentPrevWord(segments, words, i);
    if (prev && (prev.norm === insNorm || notAfter?.has(prev.norm))) continue;
    if (needsPrev) {
      if (!prev) continue;
      const byPos = rule.afterPos !== undefined && prev.pos !== undefined && rule.afterPos.includes(prev.pos);
      const byWord = afterWords ? afterWords.has(prev.norm) : false;
      if (!byPos && !byWord) continue;
    }
    const analyses = w.chosen ? [w.chosen] : analyze(w.norm);
    if (opts.agreeInserted && !exceptions?.has(w.norm) && !agrees(insAnalyses, analyses)) continue;

    const sep = insertSeparator(segments, w.segIndex);
    const isProper = w.pos === 'PROPN' || analyze(w.norm).some((a) => a.pos === 'PROPN');
    if (atSentenceStart(segments, w.segIndex) && startsUpper(w.seg.text)) {
      const allCaps = isAllCaps(w.seg.text);
      const inserted = allCaps ? rule.word.toUpperCase() : capitalizeFirst(rule.word);
      const following = allCaps || isProper ? w.seg.text : lowercaseFirst(w.seg.text);
      out.push(makeVariant(text, rule, w.seg.start, w.seg.end, inserted + sep + following, w.index));
    } else {
      const inserted = isAllCaps(w.seg.text) ? rule.word.toUpperCase() : rule.word;
      out.push(makeVariant(text, rule, w.seg.start, w.seg.start, inserted + sep, w.index));
    }
  }
  return out;
}

/**
 * Delete: remove each unprotected word whose norm is in rule.words, together with the
 * whitespace in front of it (or after it, when nothing but punctuation precedes it). If
 * the deleted word opened the sentence with a capital, the next word takes the capital,
 * unless the next word is a protected slang word, which is never changed.
 */
function deleteVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: DeleteRule,
): Variant[] {
  const targets = new Set(rule.words.map((w) => pack.normalize(w)));
  const out: Variant[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    if (w.protected || !targets.has(w.norm)) continue;
    const before = segments[w.segIndex - 1];
    const after = segments[w.segIndex + 1];
    let start = w.seg.start;
    let end = w.seg.end;
    if (before && before.kind === 'space') start = before.start;
    else if (after && after.kind === 'space') end = after.end;
    const next = adjacentNextWord(segments, words, i);
    // A protected (slang) next word keeps its exact text, so it is not re-capitalized.
    const recap =
      next !== undefined &&
      !next.protected &&
      atSentenceStart(segments, w.segIndex) &&
      startsUpper(w.seg.text) &&
      !startsUpper(next.seg.text);
    if (recap && next) {
      // Remove the word and the spaces up to the next word, then capitalize the next word.
      const replacement = capitalizeFirst(next.seg.text);
      out.push(makeVariant(text, rule, w.seg.start, next.seg.end, replacement, w.index));
      continue;
    }
    out.push(makeVariant(text, rule, start, end, '', w.index));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate rule-made variants of `text` and report how many the cap dropped.
 *
 * Method:
 * 1. Segment with pack.segment, keep word segments and choose each word's analysis in
 *    context (lang/choose.ts). Words that are slang entries in pack.registers (single
 *    words, or every word of a matched multi-word entry) are protected: grammar rules
 *    never replace, re-inflect or delete them, and nothing is inserted in front of them.
 *    This holds in every register, except that neutral register does not protect
 *    entries marked alsoStandard (standard words too: guapo, "de una").
 * 2. Apply each rule of pack.rules, skipping rules marked streetTolerant when
 *    opts.register is "street". Swaps replace a word with the other members of its
 *    groups; inflections re-inflect the chosen reading through pack.inflect; inserts and
 *    deletes add or remove one word. Replaced words keep their capitalization.
 * 3. Order candidates by a stable priority: rule kind (swap, then inflect, then insert
 *    and delete together), then the rule's position in pack.rules, then generation
 *    order (left to right through the sentence, then the order of forms in the rule).
 * 4. Drop variants identical to the original and keep only the first variant of each
 *    distinct text, so the higher-priority rule owns a text two rules both produce.
 * 5. Keep the first opts.maxVariants; the remainder is reported as `dropped`.
 */
export function generateVariantSet(
  pack: LanguagePack,
  text: string,
  opts: Partial<VariantOptions> = {},
): VariantSet {
  const o: VariantOptions = { ...DEFAULT_VARIANT_OPTIONS, ...opts };
  if (!text) return { variants: [], generated: 0, dropped: 0 };
  const segments = pack.segment(text);
  const analysisCache = new Map<string, Analysis[]>();
  const analyze = (norm: string): Analysis[] => {
    let a = analysisCache.get(norm);
    if (!a) {
      a = pack.analyze(norm);
      analysisCache.set(norm, a);
    }
    return a;
  };
  const words = collectWords(pack, segments, analyze, o);
  if (words.length === 0) return { variants: [], generated: 0, dropped: 0 };

  const candidates: Candidate[] = [];
  let seq = 0;
  pack.rules.forEach((rule, ruleIndex) => {
    if (o.register === 'street' && rule.streetTolerant) return;
    let made: Variant[];
    switch (rule.kind) {
      case 'swap':
        made = swapVariants(pack, text, words, rule);
        break;
      case 'inflect':
        made = inflectVariants(pack, text, words, rule);
        break;
      case 'insert':
        made = insertVariants(pack, text, segments, words, rule, analyze, o);
        break;
      case 'delete':
        made = deleteVariants(pack, text, segments, words, rule);
        break;
    }
    for (const variant of made) {
      candidates.push({ variant, kindRank: KIND_PRIORITY[rule.kind], ruleIndex, seq: seq++ });
    }
  });

  candidates.sort((a, b) => a.kindRank - b.kindRank || a.ruleIndex - b.ruleIndex || a.seq - b.seq);
  const seen = new Set<string>([text]);
  const unique: Variant[] = [];
  for (const c of candidates) {
    if (seen.has(c.variant.text)) continue;
    seen.add(c.variant.text);
    unique.push(c.variant);
  }
  const cap = Math.max(0, Math.floor(o.maxVariants));
  const variants = unique.slice(0, cap);
  return { variants, generated: unique.length, dropped: unique.length - variants.length };
}

/**
 * Rule-made variants of `text`, deduplicated and capped at opts.maxVariants in the
 * stable priority order described on generateVariantSet (swaps, then inflections,
 * then inserts and deletes). Use generateVariantSet to also learn how many were dropped.
 */
export function generateVariants(pack: LanguagePack, text: string, opts: Partial<VariantOptions> = {}): Variant[] {
  return generateVariantSet(pack, text, opts).variants;
}
