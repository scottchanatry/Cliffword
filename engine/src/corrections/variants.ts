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
 * pack.analyze, new forms from pack.inflect, and attached clitics from
 * pack.attachClitic and pack.splitClitics.
 */
import type {
  AgreeRule,
  Analysis,
  CliticSplit,
  ContractRule,
  CorrectionRule,
  DeleteRule,
  Features,
  InflectRule,
  InsertRule,
  LanguagePack,
  MovePosition,
  MoveRule,
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
  /**
   * Each variant costs one scoreContinuation call. Proof test speed: a ten-word sentence
   * plus six variants took 1.9 s on 4 CPU cores for Qwen3-1.7B without KV-cache reuse;
   * judgeSentence shares the prefix, so 16 should stay near interactive speed on a phone.
   * Measure on device and lower if needed.
   */
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
  /** Every analysis of the word (pack.analyze), most likely first. */
  analyses: Analysis[];
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
 * which change sentence length and are the least reliable to score. Moves rank with the
 * swaps: they fire only on words the pack's own analysis shows to be out of place (a
 * pronoun after a finite verb), so a sentence gets few of them, and the proof test found
 * them the easiest errors to score (11 of 11 pronoun placement pairs right on both
 * models), so the cap must never drop one for a speculative inflection.
 */
export const KIND_PRIORITY: Readonly<Record<CorrectionRule['kind'], number>> = {
  swap: 0,
  move: 0,
  // A contraction left apart ("a el") is almost never right, and the rule fires only there.
  contract: 0,
  inflect: 1,
  // Agreement changes one word, like an inflection, and only where a controller disagrees.
  agree: 1,
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
  /**
   * Lemmas and norms of single-word entries, for their inflected forms (bacana of bacano,
   * panas of pana, bregamos of bregar): true when every entry with that key is
   * alsoStandard (neutral register then leaves the word to the rules).
   */
  lemmas: Map<string, boolean>;
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
  const lemmas = new Map<string, boolean>();
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
      for (const key of new Set([e.lemma, e.norm])) lemmas.set(key, (lemmas.get(key) ?? true) && e.alsoStandard === true);
    }
  }
  const index = { single, phrases, alsoStandard, lemmas };
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
    words.push({
      seg,
      index: words.length,
      segIndex: c.segIndex,
      norm: c.norm,
      protected: false,
      chosen: ch,
      analyses: c.analyses,
      readings,
      pos,
      sentence,
    });
  }
  const prot = slangWordIndices(
    pack,
    words.map((w) => w.norm),
    o.register,
  );
  // Inflected slang (bacana, panas, bregamos) is protected through its chosen lemma.
  const lemmas = slangIndex(pack).lemmas;
  for (const w of words) {
    const std = w.chosen ? lemmas.get(w.chosen.lemma) : undefined;
    w.protected = prot.has(w.index) || (std !== undefined && !(std && o.register === 'neutral'));
  }
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
 * of every group that contains it, with the word's capitalization. With rule.fromWords
 * only those words are replaced; with rule.beforeWords the next word, and with
 * rule.afterWords the previous word (only spaces in between), must have one of the
 * listed norms; with rule.beforeLemmas the next word's chosen lemma, and with
 * rule.afterPos the previous word's chosen part of speech, must be listed; with
 * rule.cueWords a cue must occur earlier in the sentence. With rule.agreeNext a form is
 * proposed only when it agrees with the next word in gender and number; with
 * rule.notBeforeSlang nothing is swapped right before a protected slang word (looking
 * through rule.slangThroughPos words).
 */
function swapVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: SwapRule,
  analyze: (norm: string) => Analysis[],
): Variant[] {
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
  const norms = (list: readonly string[] | undefined) => (list ? new Set(list.map((x) => pack.normalize(x))) : undefined);
  const from = norms(rule.fromWords);
  const before = norms(rule.beforeWords);
  const after = norms(rule.afterWords);
  const cues = norms(rule.cueWords);
  const beforeLemmas = rule.beforeLemmas ? new Set(rule.beforeLemmas) : undefined;
  const slangThrough = new Set(rule.slangThroughPos ?? []);
  const out: Variant[] = [];
  for (const w of words) {
    if (w.protected) continue;
    if (from && !from.has(w.norm)) continue;
    const next = adjacentNextWord(segments, words, w.index);
    const prev = adjacentPrevWord(segments, words, w.index);
    if (before && (!next || !before.has(next.norm))) continue;
    if (after && (!prev || !after.has(prev.norm))) continue;
    if (beforeLemmas && !(next?.chosen && beforeLemmas.has(next.chosen.lemma))) continue;
    if (rule.afterPos && !(prev?.pos !== undefined && rule.afterPos.includes(prev.pos))) continue;
    if (cues && !words.some((x) => x.sentence === w.sentence && x.index < w.index && cues.has(x.norm))) continue;
    if (rule.notBeforeSlang) {
      let x = next;
      while (x && !x.protected && x.pos !== undefined && slangThrough.has(x.pos)) x = adjacentNextWord(segments, words, x.index);
      if (x?.protected) continue;
    }
    for (const form of alternatives.get(w.norm) ?? []) {
      if (rule.agreeNext && next) {
        const nextAnalyses = next.chosen ? [next.chosen] : analyze(next.norm);
        if (!agrees(analyze(pack.normalize(form)), nextAnalyses)) continue;
      }
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
 * (invariant adjectives such as "grande"), are skipped. With rule.keepAgreement, a value
 * that would break an agreement holding with an adjacent word is skipped
 * (InflectRule.keepAgreement); with rule.nextPosFor, a reading changes only before a next
 * word of the listed parts of speech.
 */
function inflectVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: InflectRule,
): Variant[] {
  const out: Variant[] = [];
  const cues = rule.cueWords ? new Set(rule.cueWords.map((c) => pack.normalize(c))) : undefined;
  const keep = rule.keepAgreement ? new Set(rule.keepAgreement) : undefined;
  for (const w of words) {
    if (w.protected) continue;
    const cued = () => words.some((x) => x.sentence === w.sentence && x.index < w.index && cues?.has(x.norm));
    const adjacent = keep
      ? [adjacentPrevWord(segments, words, w.index), adjacentNextWord(segments, words, w.index)].filter((n): n is Word => n !== undefined)
      : [];
    // Agreement with a slang word cannot be checked: its gender and number come from its
    // neutral equivalent (la guagua, una chimba), so the word next to it is left alone.
    if (adjacent.some((n) => n.protected && (n.pos === undefined || keep?.has(n.pos)))) continue;
    const neighbours = adjacent.filter((n) => n.pos !== undefined && keep?.has(n.pos) === true);
    const next = rule.nextPosFor ? adjacentNextWord(segments, words, w.index) : undefined;
    const seen = new Set<string>();
    for (const a of w.readings) {
      if (!rule.pos.includes(a.pos)) continue;
      const needNext = rule.nextPosFor?.[a.pos];
      if (needNext && (!next || (next.pos !== undefined && !needNext.includes(next.pos)))) continue;
      const current = a.features[rule.feature];
      if (current === undefined || !rule.values.includes(current)) continue;
      if (cues && (rule.cueFor === undefined || rule.cueFor.includes(current)) && !cued()) continue;
      for (const value of rule.values) {
        if (value === current) continue;
        if (neighbours.some((n) => fitsValue(n, rule.feature, current) && !fitsValue(n, rule.feature, value))) continue;
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
 * True when some reading of `w` (its chosen lexeme) carries `value` for `feature`, or
 * carries no value for it: a word without the feature, or with readings of both values
 * ("lunes" is singular and plural), agrees with any value.
 */
function fitsValue(w: Word, feature: keyof Features, value: string): boolean {
  const readings = w.readings.length ? w.readings : w.chosen ? [w.chosen] : [];
  if (readings.length === 0) return true;
  return readings.some((r) => r.features[feature] === undefined || r.features[feature] === value);
}

/**
 * Agree: re-inflect a target (AgreeRule.pos, forms, lemmas, afterWords) with the person
 * and number of its controller (see AgreeRule for how the controller is found and when
 * it does not count). No variant when some reading of the target already agrees with
 * some reading of the controller, when the controller carries none of the features, or
 * when the pack cannot produce the form.
 */
function agreeVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: AgreeRule,
): Variant[] {
  const norms = (list: readonly string[] | undefined) => new Set((list ?? []).map((w) => pack.normalize(w)));
  const through = norms(rule.throughWords);
  const ctrlWords = norms(rule.controllerWords);
  const notAfterWords = norms(rule.notAfterWords);
  const notBeforeWords = norms(rule.notBeforeWords);
  const afterWords = rule.afterWords ? norms(rule.afterWords) : undefined;
  const throughPos = new Set(rule.throughPos ?? []);
  const phrasePos = new Set(rule.phrasePos ?? []);
  const ctrlPos = new Set(rule.controllerPos ?? []);
  const notCtrl = new Set(rule.notControllerLemmas ?? []);
  const notAfterPos = new Set(rule.notAfterPos ?? []);
  const defaults: Features = rule.defaults ?? {};
  const step = (x: Word, side: 'before' | 'after') =>
    side === 'before' ? adjacentPrevWord(segments, words, x.index) : adjacentNextWord(segments, words, x.index);
  const isController = (x: Word) =>
    !x.protected &&
    (ctrlWords.has(x.norm) || (x.pos !== undefined && ctrlPos.has(x.pos))) &&
    !(x.chosen && notCtrl.has(x.chosen.lemma));
  const hasPos = (x: Word, set: ReadonlySet<Pos>) => x.analyses.some((a) => set.has(a.pos));
  const formOk = (a: Analysis) => !rule.forms || rule.forms.includes(anchorFormOf(a) ?? '');
  const valuesOf = (a: Analysis) => rule.features.map((f) => a.features[f] ?? defaults[f]);
  const out: Variant[] = [];
  for (const w of words) {
    if (w.protected) continue;
    const targets = w.readings.filter(
      (a) => rule.pos.includes(a.pos) && formOk(a) && (!rule.lemmas || rule.lemmas.includes(a.lemma)),
    );
    if (targets.length === 0) continue;
    if (afterWords) {
      const p = adjacentPrevWord(segments, words, w.index);
      if (!p || !afterWords.has(p.norm)) continue;
    }
    // Walk out from the target to the controller.
    let x = step(w, rule.side);
    let ctrl: Word | undefined;
    while (x && !x.protected) {
      if (isController(x)) {
        ctrl = x;
        break;
      }
      if (through.has(x.norm) || hasPos(x, throughPos) || hasPos(x, phrasePos)) x = step(x, rule.side);
      else break;
    }
    if (!ctrl) continue;
    if (rule.side === 'before') {
      let b = step(ctrl, 'before');
      while (b && !b.protected && hasPos(b, phrasePos) && !isController(b)) b = step(b, 'before');
      if (b && ((b.pos !== undefined && notAfterPos.has(b.pos)) || notAfterWords.has(b.norm))) continue;
    } else {
      const a = step(ctrl, 'after');
      if (a && notBeforeWords.has(a.norm)) continue;
    }
    const ctrlReadings = ctrl.readings.length ? ctrl.readings : ctrl.chosen ? [ctrl.chosen] : [];
    if (ctrlReadings.length === 0) continue;
    const wanted = ctrlReadings.map(valuesOf);
    const matches = (t: Analysis, vals: readonly (string | undefined)[]) =>
      rule.features.every((f, i) => vals[i] === undefined || t.features[f] === vals[i]);
    if (targets.some((t) => wanted.some((vals) => matches(t, vals)))) continue;
    const vals = valuesOf(ctrl.chosen ?? (ctrlReadings[0] as Analysis));
    if (vals.every((v) => v === undefined)) continue;
    const t = (w.chosen && targets.includes(w.chosen) ? w.chosen : targets[0]) as Analysis;
    const features: Features = { ...t.features };
    rule.features.forEach((f, i) => {
      const v = vals[i];
      if (v !== undefined) features[f] = v;
    });
    const form = pack.inflect(t.lemma, features);
    if (!form || pack.normalize(form) === w.norm) continue;
    out.push(makeVariant(text, rule, w.seg.start, w.seg.end, replaceCore(w.seg.text, form), w.index));
  }
  return out;
}

/** The contractions of every contract rule of the pack, normalized: [first, second, joined]. */
function contractionsOf(pack: LanguagePack): (readonly [string, string, string])[] {
  const out: (readonly [string, string, string])[] = [];
  for (const r of pack.rules) {
    if (r.kind !== 'contract') continue;
    for (const [a, b, j] of r.contractions) out.push([pack.normalize(a), pack.normalize(b), pack.normalize(j)] as const);
  }
  return out;
}

/**
 * Contract: two adjacent unprotected words that form a contraction are joined ("a el" ->
 * "al"), with the first word's capitalization, unless the second is capitalized away from
 * a sentence start (a name: "a El Salvador"). The edit spans both words.
 */
function contractVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: ContractRule,
): Variant[] {
  const out: Variant[] = [];
  const list = rule.contractions.map(([a, b, j]) => [pack.normalize(a), pack.normalize(b), j] as const);
  for (const w of words) {
    if (w.protected) continue;
    const next = adjacentNextWord(segments, words, w.index);
    if (!next || next.protected) continue;
    if (startsUpper(next.seg.text) && !isAllCaps(next.seg.text) && !atSentenceStart(segments, next.segIndex)) continue;
    for (const [a, b, joined] of list) {
      if (w.norm !== a || next.norm !== b) continue;
      const trail = EDGE_TRAIL_RE.exec(next.seg.text)?.[0] ?? '';
      const lead = EDGE_LEAD_RE.exec(w.seg.text)?.[0] ?? '';
      const core = w.seg.text.slice(lead.length, w.seg.text.length - (EDGE_TRAIL_RE.exec(w.seg.text)?.[0].length ?? 0));
      out.push(makeVariant(text, rule, w.seg.start, next.seg.end, lead + matchCase(core || w.seg.text, joined) + trail, w.index));
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
 * the next word is lowercased unless it is a proper noun. With rule.sentenceStart the
 * insert may also open a sentence; with rule.afterThroughPos the required left neighbour
 * may stand before a run of such words. An inserted word that forms a contraction with
 * the word before or after it is written contracted (ContractRule): "a" + "el" -> "al".
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
  const contractions = contractionsOf(pack);
  const afterThrough = new Set(rule.afterThroughPos ?? []);
  const needsPrev = rule.afterPos !== undefined || afterWords !== undefined;
  const leftOk = (x: Word) =>
    (rule.afterPos !== undefined && x.pos !== undefined && rule.afterPos.includes(x.pos)) || (afterWords ? afterWords.has(x.norm) : false);
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
      if (!prev) {
        if (!(rule.sentenceStart && atSentenceStart(segments, w.segIndex))) continue;
      } else if (!leftOk(prev)) {
        let x: Word | undefined = prev;
        while (x && !x.protected && !leftOk(x) && x.analyses.some((a) => afterThrough.has(a.pos))) {
          x = adjacentPrevWord(segments, words, x.index);
        }
        if (!x || x === prev || !leftOk(x)) continue;
      }
    }
    const analyses = w.chosen ? [w.chosen] : analyze(w.norm);
    if (opts.agreeInserted && !exceptions?.has(w.norm) && !agrees(insAnalyses, analyses)) continue;

    // Contracted with the word after it ("a" + "el" -> "al") or before it ("a" + "el").
    const withNext = contractions.find(([a, b]) => a === insNorm && b === w.norm);
    if (withNext) {
      out.push(makeVariant(text, rule, w.seg.start, w.seg.end, replaceCore(w.seg.text, withNext[2]), w.index));
      continue;
    }
    const withPrev = prev && !prev.protected ? contractions.find(([a, b]) => a === prev.norm && b === insNorm) : undefined;
    if (withPrev && prev) {
      out.push(makeVariant(text, rule, prev.seg.start, prev.seg.end, replaceCore(prev.seg.text, withPrev[2]), w.index));
      continue;
    }

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
 * unless the next word is a protected slang word, which is never changed. With
 * rule.fromContractions, a contraction holding one of rule.words loses that part ("al"
 * -> "el"), under the same next-word conditions.
 */
function deleteVariants(
  pack: LanguagePack,
  text: string,
  segments: readonly Segment[],
  words: readonly Word[],
  rule: DeleteRule,
): Variant[] {
  const targets = new Set(rule.words.map((w) => pack.normalize(w)));
  const notBeforeWords = new Set((rule.notBeforeWords ?? []).map((w) => pack.normalize(w)));
  // Contraction -> what is left when the rule's word comes out of it.
  const leftOver = new Map<string, string>();
  if (rule.fromContractions) {
    for (const [a, b, j] of contractionsOf(pack)) {
      if (targets.has(a)) leftOver.set(j, b);
      else if (targets.has(b)) leftOver.set(j, a);
    }
  }
  const out: Variant[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    const rest = leftOver.get(w.norm);
    if (w.protected || (!targets.has(w.norm) && rest === undefined)) continue;
    const next = adjacentNextWord(segments, words, i);
    // The word belongs to a slang phrase that follows it ("un chin"), or the next word
    // shows it is not the word the rule deletes (a pronoun before a verb, "la que").
    if (next && (next.protected || notBeforeWords.has(next.norm) || (next.pos !== undefined && rule.notBeforePos?.includes(next.pos)))) continue;
    if (rest !== undefined) {
      out.push(makeVariant(text, rule, w.seg.start, w.seg.end, replaceCore(w.seg.text, rest), w.index));
      continue;
    }
    const before = segments[w.segIndex - 1];
    const after = segments[w.segIndex + 1];
    let start = w.seg.start;
    let end = w.seg.end;
    if (before && before.kind === 'space') start = before.start;
    else if (after && after.kind === 'space') end = after.end;
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
// Move rules (object pronouns, clitics)
// ---------------------------------------------------------------------------

/** Shared state of the move rules for one sentence. */
interface MoveContext {
  pack: LanguagePack;
  text: string;
  segments: readonly Segment[];
  words: readonly Word[];
  /** Word by segment index. */
  bySeg: ReadonlyMap<number, Word>;
  /** Move rules active in this register (all of them, so each can see the others). */
  rules: readonly MoveRule[];
  /** Parts of speech that anchor some active move rule. */
  anchorPos: ReadonlySet<Pos>;
  analyze: (norm: string) => Analysis[];
  /** pack.splitClitics per word index, computed on demand. */
  splits: Map<number, CliticSplit | undefined>;
}

/** Normalized word sets of one move rule. */
interface MoveSets {
  words: Set<string>;
  homographs: Set<string>;
  notBeforePos: Set<Pos>;
  notBeforeWords: Set<string>;
  afterWords: Set<string> | undefined;
  notAfterWords: Set<string> | undefined;
  /** MoveRule.homographNotBeforePos, by normalized homograph. */
  homographPos: Map<string, Set<Pos>>;
  /** MoveRule.viaAuxiliary lemmas, or undefined. */
  auxLemmas: Set<string> | undefined;
}

const moveSetsCache = new WeakMap<MoveRule, { pack: LanguagePack; sets: MoveSets }>();

function moveSets(pack: LanguagePack, rule: MoveRule): MoveSets {
  const hit = moveSetsCache.get(rule);
  if (hit && hit.pack === pack) return hit.sets;
  const norm = (list: readonly string[] | undefined) => new Set((list ?? []).map((w) => pack.normalize(w)));
  const words = norm(rule.words);
  const sets: MoveSets = {
    words,
    homographs: new Set([...norm(rule.homographs)].filter((h) => words.has(h))),
    notBeforePos: new Set(rule.notBeforePos ?? []),
    notBeforeWords: norm(rule.notBeforeWords),
    afterWords: rule.afterWords ? norm(rule.afterWords) : undefined,
    notAfterWords: rule.notAfterWords ? norm(rule.notAfterWords) : undefined,
    homographPos: new Map(
      Object.entries(rule.homographNotBeforePos ?? {}).map(([w, list]) => [pack.normalize(w), new Set(list)] as const),
    ),
    auxLemmas: rule.viaAuxiliary ? new Set(rule.viaAuxiliary) : undefined,
  };
  moveSetsCache.set(rule, { pack, sets });
  return sets;
}

/**
 * Form class of an analysis for MoveRule.anchorForms: 'imp' for an imperative, the form
 * feature for an infinitive, gerund or participle, 'fin' for any other finite form (a
 * mood, or form 'fin'), undefined when the analysis carries neither.
 */
export function anchorFormOf(a: Analysis): string | undefined {
  const f = a.features;
  if (f.mood === 'imp') return 'imp';
  if (f.form !== undefined && f.form !== 'fin') return f.form;
  if (f.form === 'fin' || f.mood !== undefined) return 'fin';
  return undefined;
}

function anchorMatches(rule: MoveRule, a: Analysis | undefined): boolean {
  if (!a || !rule.anchorPos.includes(a.pos)) return false;
  if (!rule.anchorForms) return true;
  const form = anchorFormOf(a);
  return form !== undefined && rule.anchorForms.includes(form);
}

function splitOf(ctx: MoveContext, w: Word): CliticSplit | undefined {
  if (!ctx.pack.splitClitics || w.protected) return undefined;
  if (!ctx.splits.has(w.index)) {
    const split = ctx.pack.splitClitics(w.norm);
    ctx.splits.set(w.index, split && split.clitics.length > 0 ? split : undefined);
  }
  return ctx.splits.get(w.index);
}

/** The word's analyses plus, for a word with attached clitics, every analysis of its host. */
function readingsOf(ctx: MoveContext, w: Word): Analysis[] {
  const split = splitOf(ctx, w);
  return split ? [...w.analyses, ...ctx.analyze(split.host)] : w.analyses;
}

/** The chosen analysis, or for a word the pack does not analyze, the first analysis of its host. */
function chosenOf(ctx: MoveContext, w: Word): Analysis | undefined {
  if (w.chosen) return w.chosen;
  const split = splitOf(ctx, w);
  return split ? ctx.analyze(split.host)[0] : undefined;
}

/**
 * The readings a rule may act on: those of the chosen lexeme (Word.readings: mira is
 * both mirar 3s and the tú command, never a homograph's), or for a word the pack does
 * not analyze, those of its host's first lexeme.
 */
function lexemeReadings(ctx: MoveContext, w: Word): Analysis[] {
  if (w.chosen) return w.readings.length ? w.readings : [w.chosen];
  const split = splitOf(ctx, w);
  if (!split) return [];
  const host = ctx.analyze(split.host);
  const first = host[0];
  return first ? host.filter((a) => a.lemma === first.lemma && a.pos === first.pos) : [];
}

/**
 * The reading of `anchor` a rule acts on: the chosen analysis when it matches the rule,
 * else the first matching reading of the chosen lexeme; undefined when none matches or
 * the rule's context does not hold.
 */
function firingReading(ctx: MoveContext, rule: MoveRule, anchor: Word): Analysis | undefined {
  if (!contextHolds(ctx, rule, anchor)) return undefined;
  const chosen = chosenOf(ctx, anchor);
  if (anchorMatches(rule, chosen)) return chosen;
  return lexemeReadings(ctx, anchor).find((a) => anchorMatches(rule, a));
}

/** A word that could anchor a move: unprotected, with a reading in an active rule's anchorPos. */
function verbLike(ctx: MoveContext, w: Word | undefined): w is Word {
  return w !== undefined && !w.protected && readingsOf(ctx, w).some((a) => ctx.anchorPos.has(a.pos));
}

/** The word before an anchor, skipping the rule's words directly before it ("No [lo] haz"). */
function wordBeforeAnchor(ctx: MoveContext, sets: MoveSets, anchor: Word): Word | undefined {
  let prev = adjacentPrevWord(ctx.segments, ctx.words, anchor.index);
  while (prev && !prev.protected && sets.words.has(prev.norm)) prev = adjacentPrevWord(ctx.segments, ctx.words, prev.index);
  return prev;
}

/** MoveRule.afterWords / notAfterWords hold for this anchor. */
function contextHolds(ctx: MoveContext, rule: MoveRule, anchor: Word): boolean {
  const sets = moveSets(ctx.pack, rule);
  if (!sets.afterWords && !sets.notAfterWords) return true;
  const prev = wordBeforeAnchor(ctx, sets, anchor);
  if (sets.afterWords && !(prev && sets.afterWords.has(prev.norm))) return false;
  if (sets.notAfterWords && prev && sets.notAfterWords.has(prev.norm)) return false;
  return true;
}

/**
 * The auxiliary that takes over `anchor` for a rule with viaAuxiliary: the word before the
 * anchor (skipping a cluster of the rule's words) when its chosen lemma is listed and some
 * reading of the anchor (any lexeme: visto is also a form of vestir) matches the rule.
 */
function auxFor(ctx: MoveContext, rule: MoveRule, anchor: Word): Word | undefined {
  const sets = moveSets(ctx.pack, rule);
  if (!sets.auxLemmas) return undefined;
  const aux = wordBeforeAnchor(ctx, sets, anchor);
  if (!aux || aux.protected || !aux.chosen || !sets.auxLemmas.has(aux.chosen.lemma)) return undefined;
  return readingsOf(ctx, anchor).some((a) => anchorMatches(rule, a)) ? aux : undefined;
}

/**
 * True if clitics may stand at `position` next to `anchor` (see MoveRule): some active
 * rule whose context holds lists the position for some reading of the anchor; for
 * 'attach', also when the pack analyzes the whole word with an anchor part of speech
 * and no rule with an afterWords context that matches the chosen analysis forbids it.
 * An anchor taken over by its auxiliary (MoveRule.viaAuxiliary) allows no position.
 */
function allows(ctx: MoveContext, anchor: Word, position: MovePosition): boolean {
  // An anchor taken over by its auxiliary (a participle after haber) allows nothing.
  if (ctx.rules.some((r) => r.viaAuxiliary && auxFor(ctx, r, anchor))) return false;
  const readings = readingsOf(ctx, anchor);
  const active = ctx.rules.filter((r) => r.positions.length > 0 && contextHolds(ctx, r, anchor));
  if (active.some((r) => r.positions.includes(position) && readings.some((a) => anchorMatches(r, a)))) return true;
  if (position !== 'attach') return false;
  if (!anchor.analyses.some((a) => ctx.anchorPos.has(a.pos))) return false;
  const chosen = chosenOf(ctx, anchor);
  return !active.some((r) => r.afterWords !== undefined && anchorMatches(r, chosen) && !r.positions.includes('attach'));
}

/**
 * True if `w` is one of the rule's words that may move: unprotected, listed,
 * and for a homograph, followed by punctuation, the end, another of the rule's words, or
 * a known word whose chosen part of speech and form are not in notBeforePos and
 * notBeforeWords (see MoveRule.homographs). Opening marks are looked through.
 */
function movable(ctx: MoveContext, sets: MoveSets, w: Word): boolean {
  if (w.protected || !sets.words.has(w.norm)) return false;
  if (!sets.homographs.has(w.norm)) return true;
  let s = w.segIndex + 1;
  for (; s < ctx.segments.length; s++) {
    const seg = ctx.segments[s] as Segment;
    if (seg.kind === 'space' || (seg.kind === 'punct' && OPENING_RE.test(seg.text))) continue;
    break;
  }
  const seg = ctx.segments[s];
  if (!seg) return true;
  if (seg.kind === 'number') return false;
  if (seg.kind !== 'word') return true;
  const next = ctx.bySeg.get(s);
  if (!next) return true;
  if (sets.words.has(next.norm)) return true;
  if (sets.notBeforeWords.has(next.norm)) return false;
  if (next.pos === undefined) return false;
  const own = sets.homographPos.get(w.norm);
  if (own) return !next.analyses.some((a) => own.has(a.pos));
  return !sets.notBeforePos.has(next.pos);
}

/** Maximal runs of movable words, adjacent to each other (only spaces in between). */
function clustersOf(ctx: MoveContext, sets: MoveSets): Word[][] {
  const out: Word[][] = [];
  let run: Word[] = [];
  for (const w of ctx.words) {
    const last = run[run.length - 1];
    const ok = movable(ctx, sets, w);
    if (ok && (!last || adjacentPrevWord(ctx.segments, ctx.words, w.index) === last)) {
      run.push(w);
      continue;
    }
    if (run.length) out.push(run);
    run = ok ? [w] : [];
  }
  if (run.length) out.push(run);
  return out;
}

/** Rank of each word in rule.order, or undefined when a word has none. */
function orderRanks(ctx: MoveContext, rule: MoveRule, norms: readonly string[]): number[] | undefined {
  if (!rule.order) return undefined;
  const rank = new Map<string, number>();
  rule.order.forEach((group, i) => group.forEach((w) => rank.set(ctx.pack.normalize(w), i)));
  const ranks = norms.map((n) => rank.get(n));
  return ranks.every((r): r is number => r !== undefined) ? ranks : undefined;
}

/** Indices 0..n-1 sorted by rank (stable), or undefined when already in order. */
function reorder(ranks: readonly number[]): number[] | undefined {
  const idx = ranks.map((_, i) => i).sort((a, b) => (ranks[a] as number) - (ranks[b] as number) || a - b);
  return idx.every((v, i) => v === i) ? undefined : idx;
}

/**
 * Finish a rebuilt span: a span written all in capitals is uppercased; a span opening
 * its sentence with a capital gets a capital on its new first letter (the pieces were
 * built with the old first word lowercased).
 */
function finishCase(original: string, replacement: string, atStartCap: boolean): string {
  if (isAllCaps(original)) return replacement.toUpperCase();
  return atStartCap ? capitalizeFirst(replacement) : replacement;
}

/** Whether the span starting at word `first` opens its sentence with a capital. */
function startCap(ctx: MoveContext, first: Word): boolean {
  return atSentenceStart(ctx.segments, first.segIndex) && startsUpper(first.seg.text);
}

/** Text of a word for a rebuilt span: lowercased if it opened the sentence with a capital. */
function pieceText(w: Word, first: Word, atStartCap: boolean): string {
  return atStartCap && w === first ? lowercaseFirst(w.seg.text) : w.seg.text;
}

/**
 * The anchor's new spelling (normalized form with the case of the original word) when a
 * rule re-inflects it (MoveRule.inflectAnchor), or its host when clitics come off; the
 * word's own text otherwise. undefined when the pack cannot produce the form.
 */
function hostForm(
  ctx: MoveContext,
  rule: MoveRule,
  anchor: Word,
  reading: Analysis,
  split: CliticSplit | undefined,
  first: Word,
  atStartCap: boolean,
): { text: string; norm: string } | undefined {
  let norm = split ? split.host : anchor.norm;
  if (rule.inflectAnchor) {
    const features: Features = { ...reading.features, ...rule.inflectAnchor };
    const form = ctx.pack.inflect(reading.lemma, features);
    if (!form) return undefined;
    norm = ctx.pack.normalize(form) || form;
  }
  if (norm === anchor.norm && !split) return { text: pieceText(anchor, first, atStartCap), norm };
  const cased = atStartCap && anchor === first ? norm : matchCase(anchor.seg.text, norm);
  return { text: cased, norm };
}

/**
 * Separator for words that become separate: a space when the text has spaces or is a
 * single word (nothing shows how the language separates words, and a pack with
 * splitClitics writes clitics both ways), '' for several words written without spaces.
 */
function wordSeparator(ctx: MoveContext): string {
  return ctx.words.length < 2 || ctx.segments.some((s) => s.kind === 'space') ? ' ' : '';
}

/** Attach clitics one by one (pack.attachClitic); undefined when the pack cannot. */
function attachAll(pack: LanguagePack, host: string, clitics: readonly string[]): string | undefined {
  if (!pack.attachClitic) return undefined;
  let out = host;
  for (const c of clitics) out = pack.attachClitic(out, c);
  return out;
}

/**
 * Variants that move a separate cluster from one side of `anchor` to `to`. The edit
 * span covers the cluster and the anchor; wordIndex is the cluster's first word.
 */
function moveCluster(
  ctx: MoveContext,
  rule: MoveRule,
  cluster: readonly Word[],
  anchor: Word,
  reading: Analysis,
  from: 'before' | 'after',
  to: MovePosition,
): Variant | undefined {
  const c0 = cluster[0] as Word;
  const c1 = cluster[cluster.length - 1] as Word;
  const first = from === 'before' ? c0 : anchor;
  const last = from === 'before' ? anchor : c1;
  const start = first.seg.start;
  const end = last.seg.end;
  const original = ctx.text.slice(start, end);
  const atStartCap = startCap(ctx, first) && !isAllCaps(original);
  const host = hostForm(ctx, rule, anchor, reading, undefined, first, atStartCap);
  if (!host) return undefined;
  // Separators: inside the cluster as written; between cluster and anchor as written.
  const clusterText = pieceText(c0, first, atStartCap) + ctx.text.slice(c0.seg.end, c1.seg.end);
  const gap = from === 'before' ? ctx.text.slice(c1.seg.end, anchor.seg.start) : ctx.text.slice(anchor.seg.end, c0.seg.start);
  const sep = gap || wordSeparator(ctx);
  let replacement: string;
  if (to === 'before') replacement = clusterText + sep + host.text;
  else if (to === 'after') replacement = host.text + sep + clusterText;
  else {
    // Attached after any clitics the anchor already carries (dime + lo -> dímelo).
    const attached = attachAll(ctx.pack, host.norm, cluster.map((w) => w.norm));
    if (!attached) return undefined;
    replacement = atStartCap && anchor === first ? attached : matchCase(anchor.seg.text, attached);
  }
  return makeVariant(ctx.text, rule, start, end, finishCase(original, replacement, atStartCap), c0.index);
}

/** Variant that takes clitics attached to `anchor` off it, to `to` (before or after). */
function detachClitics(
  ctx: MoveContext,
  rule: MoveRule,
  anchor: Word,
  reading: Analysis,
  split: CliticSplit,
  to: 'before' | 'after',
): Variant | undefined {
  const original = anchor.seg.text;
  const atStartCap = startCap(ctx, anchor) && !isAllCaps(original);
  const host = hostForm(ctx, rule, anchor, reading, split, anchor, atStartCap);
  if (!host) return undefined;
  const sep = wordSeparator(ctx);
  const clitics = split.clitics.join(sep);
  const replacement = to === 'before' ? clitics + sep + host.text : host.text + sep + clitics;
  const cased = finishCase(original, replacement, atStartCap);
  return makeVariant(ctx.text, rule, anchor.seg.start, anchor.seg.end, cased, anchor.index);
}

/**
 * Variant that moves a cluster standing after an anchor taken over by its auxiliary to
 * just before the auxiliary: "Ha visto lo" -> "Lo ha visto". The span runs from the
 * auxiliary to the cluster's end.
 */
function moveBeforeAux(ctx: MoveContext, rule: MoveRule, cluster: readonly Word[], anchor: Word, aux: Word): Variant {
  const c0 = cluster[0] as Word;
  const c1 = cluster[cluster.length - 1] as Word;
  const start = aux.seg.start;
  const end = c1.seg.end;
  const original = ctx.text.slice(start, end);
  const atStartCap = startCap(ctx, aux) && !isAllCaps(original);
  const middle = ctx.text.slice(aux.seg.start, anchor.seg.end);
  const clusterText = ctx.text.slice(c0.seg.start, c1.seg.end);
  const sep = ctx.text.slice(anchor.seg.end, c0.seg.start) || wordSeparator(ctx);
  const replacement = (atStartCap ? lowercaseFirst(clusterText) : clusterText) + sep + (atStartCap ? lowercaseFirst(middle) : middle);
  return makeVariant(ctx.text, rule, start, end, finishCase(original, replacement, atStartCap), c0.index);
}

/**
 * Variants for a cluster directly before `anchor` whose words are also attached to the
 * anchor or to one of the next rule.doubledWithin words (MoveRule.doubledWithin): one
 * without the separate copies (the span runs from the cluster to the anchor), one
 * without the attached copies (the span is the word that carries them).
 */
function doubledVariants(ctx: MoveContext, rule: MoveRule, cluster: readonly Word[], anchor: Word): Variant[] {
  const out: Variant[] = [];
  const within = rule.doubledWithin ?? 0;
  let x: Word | undefined = anchor;
  for (let k = 0; k <= within && x; k++) {
    const split = x.protected ? undefined : splitOf(ctx, x);
    const doubled = split ? new Set(cluster.map((w) => w.norm).filter((c) => split.clitics.includes(c))) : new Set<string>();
    if (split && doubled.size > 0) {
      const c0 = cluster[0] as Word;
      const original = ctx.text.slice(c0.seg.start, anchor.seg.end);
      const atStartCap = startCap(ctx, c0) && !isAllCaps(original);
      const kept = cluster.filter((w) => !doubled.has(w.norm));
      const gap = ctx.text.slice((cluster[cluster.length - 1] as Word).seg.end, anchor.seg.start) || wordSeparator(ctx);
      const anchorText = anchor.seg.text;
      const replacement = kept.length
        ? kept.map((w) => pieceText(w, c0, atStartCap)).join(wordSeparator(ctx)) + gap + anchorText
        : anchorText;
      out.push(makeVariant(ctx.text, rule, c0.seg.start, anchor.seg.end, finishCase(original, replacement, atStartCap), c0.index));
      const rest = split.clitics.filter((c) => !doubled.has(c));
      const form = rest.length ? attachAll(ctx.pack, split.host, rest) : split.host;
      if (form) out.push(makeVariant(ctx.text, rule, x.seg.start, x.seg.end, matchCase(x.seg.text, form), x.index));
      break;
    }
    x = adjacentNextWord(ctx.segments, ctx.words, x.index);
  }
  return out;
}

/** Variant that puts a separate cluster's words in rule.order. */
function reorderCluster(ctx: MoveContext, rule: MoveRule, cluster: readonly Word[], order: readonly number[]): Variant {
  const c0 = cluster[0] as Word;
  const c1 = cluster[cluster.length - 1] as Word;
  const original = ctx.text.slice(c0.seg.start, c1.seg.end);
  const atStartCap = startCap(ctx, c0) && !isAllCaps(original);
  let replacement = '';
  order.forEach((from, k) => {
    replacement += pieceText(cluster[from] as Word, c0, atStartCap);
    const next = cluster[k + 1];
    if (next) replacement += ctx.text.slice((cluster[k] as Word).seg.end, next.seg.start);
  });
  return makeVariant(ctx.text, rule, c0.seg.start, c1.seg.end, finishCase(original, replacement, atStartCap), c0.index);
}

/**
 * Move: propose moving out-of-place words of rule.words next to their anchor, and with
 * rule.order, putting clusters in order. See MoveRule for when a cluster is out of
 * place. For each out-of-place separate cluster, each adjacent anchor with a reading of
 * its chosen lexeme that matches the rule (firingReading; "Mira la" gets both "La mira"
 * and "Mírala") and whose context holds gets one variant per target position other than
 * the cluster's own; attached clitics that are out of place come off before or after the
 * anchor. With rule.inflectAnchor the anchor is re-inflected in the same variant ("No
 * hazlo" -> "No lo hagas"). A cluster has at most two anchors (one on
 * each side) and Spanish rules list one position each, so an out-of-place cluster
 * yields at most two variants per rule, and a sentence without misplaced words none.
 */
function moveVariants(ctx: MoveContext, rule: MoveRule): Variant[] {
  const sets = moveSets(ctx.pack, rule);
  const out: Variant[] = [];
  const push = (v: Variant | undefined) => {
    if (v) out.push(v);
  };

  for (const cluster of clustersOf(ctx, sets)) {
    const c0 = cluster[0] as Word;
    const c1 = cluster[cluster.length - 1] as Word;
    const prev = adjacentPrevWord(ctx.segments, ctx.words, c0.index);
    const next = adjacentNextWord(ctx.segments, ctx.words, c1.index);
    const left = verbLike(ctx, prev) ? prev : undefined;
    const right = verbLike(ctx, next) ? next : undefined;
    if (!left && !right) continue;

    if (rule.order) {
      const anchored = [left, right].some((a) => a !== undefined && anchorMatches(rule, chosenOf(ctx, a)));
      const ranks = orderRanks(ctx, rule, cluster.map((w) => w.norm));
      const order = anchored && ranks ? reorder(ranks) : undefined;
      if (order) out.push(reorderCluster(ctx, rule, cluster, order));
    }
    if (rule.doubledWithin && right) out.push(...doubledVariants(ctx, rule, cluster, right));
    if (rule.positions.length === 0) continue;
    const fine = (right !== undefined && allows(ctx, right, 'before')) || (left !== undefined && allows(ctx, left, 'after'));
    if (fine) continue;
    if (rule.viaAuxiliary) {
      // Only a cluster after the anchor moves here; one between the auxiliary and the
      // anchor ("He lo visto") is moved by the rule that anchors on the auxiliary.
      const aux = left ? auxFor(ctx, rule, left) : undefined;
      if (left && aux && rule.positions.includes('before')) out.push(moveBeforeAux(ctx, rule, cluster, left, aux));
      continue;
    }
    // The cluster stands after its left anchor and before its right one.
    for (const [anchor, from] of [[left, 'after'], [right, 'before']] as const) {
      const reading = anchor && firingReading(ctx, rule, anchor);
      if (!anchor || !reading) continue;
      for (const to of rule.positions) if (to !== from) push(moveCluster(ctx, rule, cluster, anchor, reading, from, to));
    }
  }

  for (const w of ctx.words) {
    if (w.protected || sets.words.has(w.norm)) continue;
    const split = splitOf(ctx, w);
    if (!split || !split.clitics.every((c) => sets.words.has(c)) || !verbLike(ctx, w)) continue;
    if (rule.order && anchorMatches(rule, chosenOf(ctx, w))) {
      const ranks = orderRanks(ctx, rule, split.clitics);
      const order = ranks ? reorder(ranks) : undefined;
      const attached = order ? attachAll(ctx.pack, split.host, order.map((i) => split.clitics[i] as string)) : undefined;
      if (attached) {
        const atStartCap = startCap(ctx, w) && !isAllCaps(w.seg.text);
        const text = atStartCap ? attached : matchCase(w.seg.text, attached);
        out.push(makeVariant(ctx.text, rule, w.seg.start, w.seg.end, finishCase(w.seg.text, text, atStartCap), w.index));
      }
    }
    if (rule.positions.length === 0 || allows(ctx, w, 'attach')) continue;
    const reading = firingReading(ctx, rule, w);
    if (reading) for (const to of rule.positions) if (to !== 'attach') push(detachClitics(ctx, rule, w, reading, split, to));
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
 *    groups (in context, with beforeWords/afterWords); inflections re-inflect the chosen
 *    reading through pack.inflect, never breaking an agreement that holds
 *    (keepAgreement); agreement rules re-inflect a target with its controller's person
 *    and number; inserts and deletes add or remove one word, written contracted next to a
 *    contraction partner (contract rules, which also join "a el"); moves put out-of-place
 *    clitics before, after or onto their verb (pack.attachClitic, pack.splitClitics),
 *    hand a participle's clitics to its auxiliary, drop doubled clitics and reorder
 *    clusters. Inflected slang words are protected through their chosen lemma. Replaced
 *    words keep their capitalization; a move that changes the sentence's first word
 *    passes the capital on.
 * 3. Order candidates by a stable priority: rule kind (swap, move and contract, then
 *    inflect and agree, then insert and delete together), then the rule's position in
 *    pack.rules, then
 *    generation order (left to right through the sentence, then the order of forms in
 *    the rule).
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

  const active = (rule: CorrectionRule) => !(o.register === 'street' && rule.streetTolerant);
  const moveRules = pack.rules.filter((r): r is MoveRule => r.kind === 'move' && active(r));
  const moveCtx: MoveContext = {
    pack,
    text,
    segments,
    words,
    bySeg: new Map(words.map((w) => [w.segIndex, w])),
    rules: moveRules,
    anchorPos: new Set(moveRules.flatMap((r) => r.anchorPos)),
    analyze,
    splits: new Map(),
  };

  const candidates: Candidate[] = [];
  let seq = 0;
  pack.rules.forEach((rule, ruleIndex) => {
    if (!active(rule)) return;
    let made: Variant[];
    switch (rule.kind) {
      case 'swap':
        made = swapVariants(pack, text, segments, words, rule, analyze);
        break;
      case 'move':
        made = moveVariants(moveCtx, rule);
        break;
      case 'inflect':
        made = inflectVariants(pack, text, segments, words, rule);
        break;
      case 'agree':
        made = agreeVariants(pack, text, segments, words, rule);
        break;
      case 'contract':
        made = contractVariants(pack, text, segments, words, rule);
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
 * stable priority order described on generateVariantSet (swaps and moves, then
 * inflections, then inserts and deletes). Use generateVariantSet to also learn how many were dropped.
 */
export function generateVariants(pack: LanguagePack, text: string, opts: Partial<VariantOptions> = {}): Variant[] {
  return generateVariantSet(pack, text, opts).variants;
}
