/**
 * Story sentence selection: given several model-generated candidates for the next story
 * sentence, keep the one that best fits the learner.
 *
 * Method
 * ------
 * For each candidate:
 * 1. Segment with the language pack and analyze every word. A word's lexeme key is
 *    lexemeKey(pack.code, lemma) from the analysis chosen in context (lang/choose.ts:
 *    pack.chooseAnalysis with the previous word, else the first analysis; slang maps
 *    through pack.analyze, so "'tá" gets its own slang lemma). Unknown words use their
 *    normalized form as lemma. A capitalized word that does not start a sentence prefers
 *    a PROPN analysis, and when the pack does not know it at all it is taken to be a name.
 * 2. knownShare = mean pKnown(meaning) over word segments, excluding PROPN and NUM (and
 *    number segments). A sentence with no counted word has knownShare 1.
 * 3. The band is checked on bandShare, which is knownShare over the counted words that are
 *    not targets: targets are the new material the caller asked for (it paces them with
 *    newWordsPerSentence), so they must not push a sentence out of the band by themselves.
 *    With bandExcludesTargets = false the band uses knownShare as is.
 * 4. Score (higher is better) = band term + target term + length term + unknown term:
 *    - band: -(belowBandWeight x distance below knownBand.min) or
 *      -(aboveBandWeight x distance above knownBand.max); too hard costs more than too easy;
 *    - target: +targetBonus per distinct target lexeme in the sentence;
 *    - length: -lengthWeight per word outside params.sentenceWords;
 *    - unknown: -unknownPenalty per distinct unknown non-target lexeme beyond
 *      params.newWordsPerSentence (fractional allowances give fractional penalties).
 * 5. Reject: no words (empty or punctuation only), far too long, a repeat of a recent
 *    sentence (same normalized words, or nearly the same word set), prompt leakage
 *    (labels or instructions echoed), native-language words (via pair.nativeLexicon)
 *    and unbalanced quotes or brackets.
 * Accepted candidates are ranked by score (ties: earlier candidate first); rejected ones
 * follow in input order. Every candidate carries human-readable reasons for debugging.
 */
import type { Analysis, LanguagePack, Pos } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { DifficultyParams, LearnerView, Skill } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { isNativeWord } from '../gaps/capture';
import { chooseAnalysesInText } from '../lang/choose';
import {
  clamp01,
  contentSegments,
  foldForMatch,
  isCapitalized,
  isContent,
  sentenceStartFlags,
  splitSentences,
} from './text';

/** Why a candidate was rejected. */
export type RejectCode = 'empty' | 'too_long' | 'repeat' | 'prompt_leak' | 'native_words' | 'unbalanced_quotes';

/** Tunable numbers of selectSentence. */
export interface SelectOptions {
  /** Skill whose pKnown defines "known". */
  skill: Skill;
  /** A word with pKnown below this counts as unknown (a new word). */
  unknownBelow: number;
  /** Leave target words out of the band check (see the module comment). */
  bandExcludesTargets: boolean;
  /** Penalty per unit of share below knownBand.min (100 = 1 point per percentage point). */
  belowBandWeight: number;
  /** Penalty per unit of share above knownBand.max. Too easy hurts less than too hard. */
  aboveBandWeight: number;
  /** Bonus per distinct target lexeme in the sentence. */
  targetBonus: number;
  /** Penalty per word outside params.sentenceWords. */
  lengthWeight: number;
  /** Penalty per unknown non-target lexeme beyond params.newWordsPerSentence. */
  unknownPenalty: number;
  /** Reject sentences longer than this many times params.sentenceWords.max. */
  hardMaxWordsFactor: number;
  /** Reject sentences with more native-language words than this. */
  maxNativeWords: number;
  /** Treat capitalized words the pack does not know, away from a sentence start, as names. */
  capitalizedUnknownAsPropn: boolean;
  /** Parts of speech left out of knownShare and the unknown-word count. */
  excludePos: readonly Pos[];
  /** Reject as a near repeat when the word-set Jaccard overlap with a recent sentence reaches this. */
  nearRepeatJaccard: number;
  /** Patterns (tested on accent-folded, lowercased text) that reveal echoed instructions or labels. */
  leakPatterns: readonly RegExp[];
  /** A run of this many consecutive words shared with the prompt instructions is leakage. */
  leakNgram: number;
  /** Abbreviations used when splitting previous sentences. */
  abbreviations?: readonly string[];
}

/**
 * Prompt-leak patterns, matched against foldForMatch(text). They target the vocabulary of
 * buildContinuationPrompt (Spanish) and common English meta-talk of instruct models.
 */
export const DEFAULT_LEAK_PATTERNS: readonly RegExp[] = [
  /\boracion(es)?\b/,
  /\binstrucci(on|ones)\b/,
  /\b(historia|frase|respuesta|registro|palabras?|traduccion|continuacion|sentence|answer|story|translation|output)\s*:/,
  /\bmaximo\s+\d+\s+palabras\b/,
  /\b\d+\s+palabras\s+como\s+maximo\b/,
  /\b(continua|escribe|usa|responde)\s+(la|una|solo|estas|esta|las|con)\s+(historia|oracion|palabras?|frase)\b/,
  /\bregistro\s+(neutro|callejero|de\s+la\s+calle)\b/,
  /\b(next sentence|here is|here's|the sentence|translation)\b/,
];

export const DEFAULT_SELECT_OPTIONS: Readonly<SelectOptions> = {
  skill: 'meaning',
  unknownBelow: 0.5,
  bandExcludesTargets: true,
  belowBandWeight: 100,
  aboveBandWeight: 30,
  targetBonus: 3,
  lengthWeight: 1,
  unknownPenalty: 4,
  hardMaxWordsFactor: 2.5,
  maxNativeWords: 0,
  capitalizedUnknownAsPropn: true,
  excludePos: ['PROPN', 'NUM'],
  nearRepeatJaccard: 0.9,
  leakPatterns: DEFAULT_LEAK_PATTERNS,
  leakNgram: 4,
};

export interface SelectContext {
  pack: LanguagePack;
  learner: LearnerView;
  /** Time for pKnown, ms since epoch. */
  now: number;
  /** Lexeme keys to introduce or practice (form keys are reduced to their lexeme). */
  targets: readonly string[];
  params: DifficultyParams;
  /** Recent story sentences (an entry may hold several sentences). */
  previous: readonly string[];
  /** When given, its nativeLexicon is used to reject native-language words. */
  pair?: PairPack;
  /** Instruction lines of the prompt that produced the candidates, for leak detection. */
  instructions?: readonly string[];
  options?: Partial<SelectOptions>;
}

/** One word of a candidate, as the selector saw it. */
export interface WordInfo {
  /** Segment kind: a word, or a number written with digits. */
  kind: 'word' | 'number';
  text: string;
  norm: string;
  start: number;
  end: number;
  lemma: string;
  /** Part of speech of the chosen analysis; null when the pack does not know the word. */
  pos: Pos | null;
  key: string;
  /** False for PROPN, NUM and number segments: left out of knownShare. */
  counted: boolean;
  pKnown: number;
  target: boolean;
  /** Counted, not a target, and pKnown below unknownBelow. */
  unknown: boolean;
  native: boolean;
  sentenceStart: boolean;
}

export interface ScoreParts {
  band: number;
  target: number;
  length: number;
  unknown: number;
}

export interface CandidateEvaluation {
  /** Index of the candidate in the input list. */
  index: number;
  text: string;
  accepted: boolean;
  rejected: RejectCode[];
  words: WordInfo[];
  /** Number of words (word and number segments). */
  wordCount: number;
  /** Mean pKnown over counted words (1 when none). */
  knownShare: number;
  /** Share used for the band check (without targets when bandExcludesTargets). */
  bandShare: number;
  inBand: boolean;
  /** Distinct target lexeme keys found, in sentence order. */
  targetsHit: string[];
  /** Distinct unknown non-target lexeme keys, in sentence order. */
  unknownNonTargets: string[];
  /** Native-language words found (normalized). */
  nativeWords: string[];
  score: number;
  parts: ScoreParts;
  reasons: string[];
}

export interface Selection {
  /** Highest-scoring accepted candidate, or null when every candidate was rejected. */
  best: CandidateEvaluation | null;
  /** Accepted candidates by score, then rejected ones. */
  ranked: CandidateEvaluation[];
}

/** Merge options with the defaults. */
export function resolveSelectOptions(options?: Partial<SelectOptions>): SelectOptions {
  return { ...DEFAULT_SELECT_OPTIONS, ...options };
}

/**
 * Pick the analysis to use for a word without context: a PROPN analysis when the word is
 * capitalized away from a sentence start and the pack offers one, otherwise the most
 * likely one. analyzeWords and pickCliff choose in context (lang/choose.ts), which also
 * asks pack.chooseAnalysis.
 */
export function chooseAnalysis(analyses: readonly Analysis[], capitalizedMidSentence: boolean): Analysis | undefined {
  if (capitalizedMidSentence) {
    const propn = analyses.find((a) => a.pos === 'PROPN');
    if (propn) return propn;
  }
  return analyses[0];
}

/**
 * Analyze the words of a text for selection: lexeme keys, parts of speech, pKnown,
 * target and unknown flags. Number segments are NUM and never counted.
 */
export function analyzeWords(text: string, ctx: SelectContext, o: SelectOptions = resolveSelectOptions(ctx.options)): WordInfo[] {
  const { pack, learner, now, pair } = ctx;
  const targets = new Set(ctx.targets.map(lexemeOf));
  const excluded = new Set(o.excludePos);
  const segments = pack.segment(text);
  const starts = sentenceStartFlags(segments, o.abbreviations);
  const choices = new Map(chooseAnalysesInText(pack, segments, starts).map((c) => [c.segIndex, c]));
  const words: WordInfo[] = [];
  segments.forEach((seg, i) => {
    if (!isContent(seg)) return;
    const norm = seg.norm || pack.normalize(seg.text);
    const sentenceStart = starts[i] === true;
    if (seg.kind === 'number') {
      words.push({
        kind: 'number', text: seg.text, norm, start: seg.start, end: seg.end, lemma: norm, pos: 'NUM',
        key: lexemeKey(pack.code, norm), counted: false, pKnown: 1, target: false, unknown: false,
        native: false, sentenceStart,
      });
      return;
    }
    const capsMid = !sentenceStart && isCapitalized(seg.text);
    const chosen = choices.get(i)?.chosen;
    let pos: Pos | null = chosen?.pos ?? null;
    if (!chosen && capsMid && o.capitalizedUnknownAsPropn) pos = 'PROPN';
    const lemma = chosen?.lemma ?? norm;
    const key = lexemeKey(pack.code, lemma);
    const counted = !(pos !== null && excluded.has(pos));
    const pKnown = clamp01(learner.pKnown(key, o.skill, now));
    const target = targets.has(key);
    const native = pair !== undefined && !chosen && isNativeWord(norm, pack, pair);
    words.push({
      kind: 'word', text: seg.text, norm, start: seg.start, end: seg.end, lemma, pos, key, counted, pKnown, target,
      unknown: counted && !target && pKnown < o.unknownBelow, native, sentenceStart,
    });
  });
  return words;
}

/**
 * Mean pKnown over counted words (not PROPN or NUM), optionally leaving targets out;
 * 1 when no word is left (nothing in the sentence is unknown).
 */
export function knownShareOf(words: readonly WordInfo[], excludeTargets = false): number {
  const counted = words.filter((w) => w.counted && !(excludeTargets && w.target));
  if (!counted.length) return 1;
  let s = 0;
  for (const w of counted) s += w.pKnown;
  return s / counted.length;
}

/**
 * Shares within this of a band edge count as on the edge: a mean of equal values can come
 * out a few ulps below them (twelve words at 0.95 average to 0.9499999999999998).
 */
export const BAND_EPSILON = 1e-9;

/** How far a share lies below band.min and above band.max (both >= 0; 0 within BAND_EPSILON of an edge). */
export function bandDistance(share: number, band: { min: number; max: number }): { below: number; above: number } {
  const below = band.min - share;
  const above = share - band.max;
  return { below: below > BAND_EPSILON ? below : 0, above: above > BAND_EPSILON ? above : 0 };
}

/** Words outside [range.min, range.max] (0 inside). */
export function lengthDistance(n: number, range: { min: number; max: number }): number {
  return n < range.min ? range.min - n : n > range.max ? n - range.max : 0;
}

function distinct(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

/** Normalized word sequence of a text, through the pack's segmenter. */
export function normalizedWords(text: string, pack: LanguagePack): string[] {
  return contentSegments(pack.segment(text)).map((s) => s.norm || pack.normalize(s.text)).filter(Boolean);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * True when the text repeats a recent sentence: the same normalized word sequence, or a
 * word set whose Jaccard overlap with a recent sentence reaches `nearJaccard`. Previous
 * entries are split into sentences first.
 */
export function isRepeat(
  text: string,
  previous: readonly string[],
  pack: LanguagePack,
  nearJaccard: number,
  abbreviations?: readonly string[],
): boolean {
  const words = normalizedWords(text, pack);
  if (!words.length) return false;
  const joined = words.join(' ');
  for (const entry of previous) {
    for (const sentence of splitSentences(entry, abbreviations)) {
      const prev = normalizedWords(sentence, pack);
      if (!prev.length) continue;
      if (prev.join(' ') === joined) return true;
      if (jaccard(words, prev) >= nearJaccard) return true;
    }
  }
  return false;
}

/**
 * True when the text looks like echoed instructions: it matches a leak pattern (on
 * accent-folded lowercase text) or shares `ngram` consecutive words with an instruction
 * line (compared accent-folded).
 */
export function detectPromptLeak(
  text: string,
  pack: LanguagePack,
  patterns: readonly RegExp[],
  instructions: readonly string[] = [],
  ngram = 4,
): boolean {
  const folded = foldForMatch(text);
  if (patterns.some((re) => re.test(folded))) return true;
  if (ngram < 1 || !instructions.length) return false;
  const words = normalizedWords(text, pack).map(foldForMatch);
  if (words.length < ngram) return false;
  const grams = new Set<string>();
  for (const line of instructions) {
    const iw = normalizedWords(line, pack).map(foldForMatch);
    for (let i = 0; i + ngram <= iw.length; i++) grams.add(iw.slice(i, i + ngram).join(' '));
  }
  for (let i = 0; i + ngram <= words.length; i++) if (grams.has(words.slice(i, i + ngram).join(' '))) return true;
  return false;
}

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

/**
 * True when quotes or brackets do not pair up: an odd number of straight double quotes,
 * or unequal counts of “ ”, « », ‘ ’ (only when ‘ is used), ( ), [ ], or an opening
 * ¿ / ¡ without its closing ? / !. Straight single quotes are apostrophes ('tá, pa') and
 * are ignored; a ? or ! without ¿ / ¡ is allowed (informal writing).
 */
export function hasUnbalancedQuotes(text: string): boolean {
  if (count(text, '"') % 2 !== 0) return true;
  const pairs: [string, string][] = [['“', '”'], ['«', '»'], ['(', ')'], ['[', ']']];
  for (const [open, close] of pairs) if (count(text, open) !== count(text, close)) return true;
  if (count(text, '‘') > 0 && count(text, '‘') !== count(text, '’')) return true;
  if (count(text, '¿') > count(text, '?')) return true;
  if (count(text, '¡') > count(text, '!')) return true;
  return false;
}

/** Rejection codes for a candidate (empty list = accepted). */
export function rejectReasons(text: string, words: readonly WordInfo[], ctx: SelectContext, o: SelectOptions): RejectCode[] {
  const out: RejectCode[] = [];
  if (!words.some((w) => w.kind === 'word')) {
    out.push('empty');
    return out;
  }
  if (words.length > o.hardMaxWordsFactor * ctx.params.sentenceWords.max) out.push('too_long');
  if (isRepeat(text, ctx.previous, ctx.pack, o.nearRepeatJaccard, o.abbreviations)) out.push('repeat');
  if (detectPromptLeak(text, ctx.pack, o.leakPatterns, ctx.instructions, o.leakNgram)) out.push('prompt_leak');
  if (words.filter((w) => w.native).length > o.maxNativeWords) out.push('native_words');
  if (hasUnbalancedQuotes(text)) out.push('unbalanced_quotes');
  return out;
}

const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();

/**
 * Evaluate one candidate: analysis, shares, score parts, rejections and reasons.
 * See the module comment for the scoring method.
 */
export function evaluateCandidate(text: string, index: number, ctx: SelectContext, o: SelectOptions = resolveSelectOptions(ctx.options)): CandidateEvaluation {
  const words = analyzeWords(text, ctx, o);
  const counted = words.filter((w) => w.counted);
  const knownShare = knownShareOf(words, false);
  const bandShare = knownShareOf(words, o.bandExcludesTargets);
  const band = ctx.params.knownBand;
  const dist = bandDistance(bandShare, band);
  const inBand = dist.below === 0 && dist.above === 0;
  const targetsHit = distinct(words.filter((w) => w.target).map((w) => w.key));
  const unknownNonTargets = distinct(words.filter((w) => w.unknown).map((w) => w.key));
  const nativeWords = distinct(words.filter((w) => w.native).map((w) => w.norm));
  const lenOff = lengthDistance(words.length, ctx.params.sentenceWords);
  const excessUnknown = Math.max(0, unknownNonTargets.length - Math.max(0, ctx.params.newWordsPerSentence));
  const parts: ScoreParts = {
    band: -(o.belowBandWeight * dist.below + o.aboveBandWeight * dist.above),
    target: o.targetBonus * targetsHit.length,
    length: -o.lengthWeight * lenOff,
    unknown: -o.unknownPenalty * excessUnknown,
  };
  const score = parts.band + parts.target + parts.length + parts.unknown;
  const rejected = rejectReasons(text, words, ctx, o);

  const reasons: string[] = [];
  for (const r of rejected) reasons.push(`rejected: ${r}`);
  reasons.push(
    `known share ${fmt(knownShare)} over ${counted.length} counted words; band share ${fmt(bandShare)} vs band ${fmt(band.min)}..${fmt(band.max)}` +
      (inBand ? ' (in band)' : dist.below > 0 ? ` (below by ${fmt(dist.below)}, ${fmt(parts.band)})` : ` (above by ${fmt(dist.above)}, ${fmt(parts.band)})`),
  );
  if (targetsHit.length) reasons.push(`targets hit: ${targetsHit.join(', ')} (+${fmt(parts.target)})`);
  else if (ctx.targets.length) reasons.push('no target hit');
  reasons.push(
    `length ${words.length} words vs ${fmt(ctx.params.sentenceWords.min)}..${fmt(ctx.params.sentenceWords.max)}` +
      (lenOff ? ` (${fmt(parts.length)})` : ''),
  );
  if (unknownNonTargets.length) {
    reasons.push(
      `unknown non-targets: ${unknownNonTargets.join(', ')}; allowance ${fmt(ctx.params.newWordsPerSentence)}` +
        (excessUnknown ? ` (${fmt(parts.unknown)})` : ''),
    );
  }
  if (nativeWords.length) reasons.push(`native words: ${nativeWords.join(', ')}`);

  return {
    index, text, accepted: rejected.length === 0, rejected, words, wordCount: words.length, knownShare,
    bandShare, inBand, targetsHit, unknownNonTargets, nativeWords, score, parts, reasons,
  };
}

/**
 * Choose the candidate sentence that best fits the learner (see the module comment).
 * Deterministic: the same inputs always give the same ranking.
 */
export function selectSentence(candidates: readonly string[], ctx: SelectContext): Selection {
  const o = resolveSelectOptions(ctx.options);
  const evals = candidates.map((c, i) => evaluateCandidate(c, i, ctx, o));
  const accepted = evals.filter((e) => e.accepted).sort((a, b) => b.score - a.score || a.index - b.index);
  const rejected = evals.filter((e) => !e.accepted);
  return { best: accepted[0] ?? null, ranked: [...accepted, ...rejected] };
}
