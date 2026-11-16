/**
 * Story sentence selection: given several model-generated candidates for the next story
 * sentence, reject the unusable ones and keep the one that best fits the learner.
 *
 * Method
 * ------
 * For each candidate:
 * 1. Segment with the language pack and analyze every word. A word's lexeme key is
 *    lexemeKey(pack.code, lemma) from the analysis chosen in context (lang/choose.ts:
 *    pack.chooseAnalysis with the previous word, else the first analysis; slang maps
 *    through pack.analyze, so "'tá" gets its own slang lemma). Unknown words use their
 *    normalized form as lemma. A word listed in ctx.names (the story's characters) is a
 *    name anywhere, sentence start included; a capitalized word that does not start a
 *    sentence prefers a PROPN analysis, and when the pack does not know it at all it is
 *    taken to be a name.
 * 2. knownShare = mean pKnown(meaning) over word segments, excluding PROPN and NUM (and
 *    number segments). A word in ctx.familiar (the zero-knowledge bridge: taught words,
 *    cognates, words already introduced) counts at least familiarCredit. A sentence with
 *    no counted word has knownShare 1.
 * 3. The band is checked on bandShare, which is knownShare over the counted words that are
 *    not targets: targets are the new material the caller asked for (it paces them with
 *    newWordsPerSentence), so they must not push a sentence out of the band by themselves.
 *    With bandExcludesTargets = false the band uses knownShare as is.
 * 4. Reject (every code is counted in Selection.rejectCounts): no words; placeholders and
 *    blanks (_ … ... [ ] < > { } in the cleaned text or the raw completion); a list or a
 *    numbered step; a heading; a bare quote (a short quotation with nothing around it);
 *    prompt leakage (model and pack leak patterns, or a run of words echoed from the
 *    prompt); meta talk (a pack meta word: grammar terms); native-language words (via
 *    pair.nativeLexicon); another language (most words unknown to the pack); no verb
 *    (unless the pack says its sentences need none); too short or too long for the
 *    level; a repeat or near repeat of a recent sentence; unbalanced quotes or brackets.
 * 5. Score accepted candidates (higher is better), in tiers so the band comes first:
 *    - band: 0 inside the band; outside, -(outOfBandPenalty + belowBandWeight x distance
 *      below or aboveBandWeight x distance above), so any in-band candidate beats any
 *      out-of-band one unless the other terms differ by more than outOfBandPenalty;
 *    - target: +targetBonus per distinct target lexeme in the sentence;
 *    - novelty: -noveltyWeight x the largest word-set overlap with a recent sentence;
 *    - continuity: +continuityBonus when the sentence names a story character or reuses
 *      a content word of the recent story, -newNamePenalty per new name;
 *    - natural: +naturalWeight x (model log-probability per token - naturalBaseline),
 *      clamped to +-naturalClamp, when the caller scored the candidate (SelectCandidate.natural);
 *      a scored candidate below naturalFloor is rejected (unnatural);
 *    - length: -lengthWeight per word outside params.sentenceWords;
 *    - unknown: -unknownPenalty per distinct unknown non-target lexeme beyond
 *      params.newWordsPerSentence (fractional allowances give fractional penalties).
 * Accepted candidates are ranked by score (ties: earlier candidate first); rejected ones
 * follow in input order. Every candidate carries human-readable reasons for debugging.
 *
 * Language-neutral: words come from pack.segment and pack.analyze; leak patterns, meta
 * words and the verb requirement come from LanguagePack.story; the punctuation checks
 * look only at punctuation.
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
export type RejectCode =
  | 'empty'
  | 'placeholder'
  | 'list'
  | 'heading'
  | 'bare_quote'
  | 'prompt_leak'
  | 'meta'
  | 'native_words'
  | 'foreign'
  | 'no_verb'
  | 'too_short'
  | 'too_long'
  | 'repeat'
  | 'unbalanced_quotes'
  | 'unnatural';

/** Every reject code, in the order rejectReasons tests them. */
export const REJECT_CODES: readonly RejectCode[] = [
  'empty', 'placeholder', 'list', 'heading', 'bare_quote', 'prompt_leak', 'meta', 'native_words', 'foreign',
  'no_verb', 'too_short', 'too_long', 'repeat', 'unbalanced_quotes', 'unnatural',
];

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
  /** Penalty for being outside the band at all (the band comes first). */
  outOfBandPenalty: number;
  /** Bonus per distinct target lexeme in the sentence. */
  targetBonus: number;
  /** Penalty per word outside params.sentenceWords. */
  lengthWeight: number;
  /** Penalty per unknown non-target lexeme beyond params.newWordsPerSentence. */
  unknownPenalty: number;
  /** Reject sentences longer than this many times params.sentenceWords.max. */
  hardMaxWordsFactor: number;
  /** Reject sentences shorter than this many times params.sentenceWords.min. */
  minWordsFactor: number;
  /** Reject sentences with more native-language words than this. */
  maxNativeWords: number;
  /** Treat capitalized words the pack does not know, away from a sentence start, as names. */
  capitalizedUnknownAsPropn: boolean;
  /** Parts of speech left out of knownShare and the unknown-word count. */
  excludePos: readonly Pos[];
  /** Reject as a near repeat when the word-set Jaccard overlap with a recent sentence reaches this. */
  nearRepeatJaccard: number;
  /**
   * Reject as a near repeat when this share of the candidate's words (at least
   * nearRepeatMinWords of them) occur, in order, inside one recent sentence ("Marta toca
   * la guitarra." after "Marta toca la guitarra y el piano.").
   */
  nearRepeatContainment: number;
  nearRepeatMinWords: number;
  /**
   * Model-level leak patterns, tested on accent-folded lowercase text: the English meta
   * talk of instruct models. Each pack adds its own (StoryLanguageData.leakPatterns).
   */
  leakPatterns: readonly RegExp[];
  /** A run of this many consecutive words shared with the prompt instructions is leakage. */
  leakNgram: number;
  /** Abbreviations used when splitting previous sentences (default: the pack's). */
  abbreviations?: readonly string[];
  /** Placeholder and blank marks, tested on the cleaned text and the raw completion. */
  placeholderPattern: RegExp;
  /** A list marker or numbered step, tested on the raw completion and the cleaned text. */
  listPattern: RegExp;
  /** A comma list: at least this many commas with mostly one-word pieces. */
  listCommas: number;
  /** Reject as another language when at least this share of the words is unknown to the pack (names aside). */
  foreignShare: number;
  /** ...and at least this many words are unknown. */
  foreignMinWords: number;
  /** Require a verb: true, false, or undefined for the pack's StoryLanguageData.requireVerb (default true). */
  requireVerb?: boolean;
  /** Parts of speech that count as a verb. */
  verbPos: readonly Pos[];
  /** A quoted candidate with fewer words than this times params.sentenceWords.min is a bare quote. */
  bareQuoteFactor: number;
  /** pKnown counted for a word in SelectContext.familiar (at least). */
  familiarCredit: number;
  /** Weight of the largest overlap with a recent sentence (0..1). */
  noveltyWeight: number;
  /** Bonus for naming a story character or reusing a recent content word. */
  continuityBonus: number;
  /** Penalty per name the story has not used yet. */
  newNamePenalty: number;
  /** Weight per nat of the model's mean log-probability per token above naturalBaseline. */
  naturalWeight: number;
  naturalBaseline: number;
  /** The natural term stays within +-naturalClamp. */
  naturalClamp: number;
  /** A scored candidate below this mean log-probability per token is rejected (unnatural). */
  naturalFloor: number;
}

/**
 * Model-level leak patterns, matched against foldForMatch(text): the English meta talk
 * of instruct models ("Here is the next sentence"), whatever the language of the prompt.
 * Language packs add the vocabulary of their prompts (StoryLanguageData.leakPatterns).
 */
export const DEFAULT_LEAK_PATTERNS: readonly RegExp[] = [
  /\b(sentence|answer|story|translation|output|response)\s*:/u,
  /\b(next sentence|here is|here's|the sentence|translation)\b/u,
];

/** Placeholder and blank marks: underscores, ellipses, brackets, angle brackets, braces. */
export const DEFAULT_PLACEHOLDER_PATTERN = /_|…|\.\.|\[|\]|<|>|\{|\}|\(\s*\)/u;

/** List markers and numbered steps: "1.", "2)", "(1)", "- ", "* ", "• ", or a lone number before a colon. */
export const DEFAULT_LIST_PATTERN = /^\s*(?:[-*•+]\s|\(?\d+[.)]\s|\(\d+\))|\(\d+\)|\b\p{L}+\s+\d+\s*:/u;

export const DEFAULT_SELECT_OPTIONS: Readonly<SelectOptions> = {
  skill: 'meaning',
  unknownBelow: 0.5,
  bandExcludesTargets: true,
  belowBandWeight: 100,
  aboveBandWeight: 30,
  // The other terms rarely add up to 20 (two targets 6, novelty 2, continuity 1, natural 2).
  outOfBandPenalty: 20,
  targetBonus: 3,
  lengthWeight: 1,
  unknownPenalty: 4,
  // Measured on Qwen3-1.7B: run-ons cut at maxTokens and two-clause sentences past 1.5
  // times the maximum read as a paragraph; 2.5 let them through.
  hardMaxWordsFactor: 1.6,
  // Below 60% of the minimum: one- and two-word answers for beginners ("¿Qué?", "El.").
  minWordsFactor: 0.6,
  maxNativeWords: 0,
  capitalizedUnknownAsPropn: true,
  excludePos: ['PROPN', 'NUM'],
  nearRepeatJaccard: 0.9,
  nearRepeatContainment: 0.85,
  nearRepeatMinWords: 3,
  leakPatterns: DEFAULT_LEAK_PATTERNS,
  leakNgram: 4,
  placeholderPattern: DEFAULT_PLACEHOLDER_PATTERN,
  listPattern: DEFAULT_LIST_PATTERN,
  listCommas: 3,
  // Unknown to the pack is not foreign (the shipped Spanish lexicon has 1788 lemmas), so
  // only a sentence of mostly unknown words is; English is caught by native_words.
  foreignShare: 0.75,
  foreignMinWords: 3,
  verbPos: ['VERB', 'AUX'],
  bareQuoteFactor: 1,
  // The top of the known-word band: a familiar word never pulls a sentence out of it.
  familiarCredit: 0.98,
  noveltyWeight: 2,
  continuityBonus: 1,
  newNamePenalty: 1,
  // Measured on Qwen3-1.7B after a two-sentence story with the scoring prefix (mean
  // log-probability per token): fluent beginner sentences -1.9 to -2.9 (one at -4.2),
  // degenerate ones from a locked story ("El más es el que es más.", "El grupo está ver.")
  // -4.1 to -6.2; per word the two groups overlapped far more. The floor rejects 6 of 10
  // degenerate sentences and none of 10 fluent ones.
  naturalWeight: 1,
  naturalBaseline: -3,
  naturalClamp: 2,
  naturalFloor: -4.4,
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
  /** Instruction or header lines of the prompt that produced the candidates, for leak detection. */
  instructions?: readonly string[];
  /** The story's characters: names anywhere in a candidate, sentence start included. */
  names?: readonly string[];
  /** Lexeme keys counted at least familiarCredit (the zero-knowledge bridge). */
  familiar?: Iterable<string>;
  options?: Partial<SelectOptions>;
}

/** A candidate with what the selector may know beyond its cleaned text. */
export interface SelectCandidate {
  /** The cleaned sentence. */
  text: string;
  /** The model's raw completion (placeholders, lists and headings show there). */
  raw?: string;
  /** Model mean log-probability per token of the sentence in the story context (see generateNextSentence). */
  natural?: number;
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
  /** The pack has an analysis for the word. */
  analyzed: boolean;
}

export interface ScoreParts {
  band: number;
  target: number;
  length: number;
  unknown: number;
  novelty: number;
  continuity: number;
  natural: number;
}

export interface CandidateEvaluation {
  /** Index of the candidate in the input list. */
  index: number;
  text: string;
  /** The raw completion, when the caller gave it. */
  raw?: string;
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
  /** Largest word-set overlap (Jaccard) with a recent sentence. */
  overlap: number;
  /** Story names used, and names the story has not used yet (normalized). */
  namesUsed: string[];
  newNames: string[];
  /** Model mean log-probability per token, when scored. */
  natural: number | null;
  score: number;
  parts: ScoreParts;
  reasons: string[];
}

export interface Selection {
  /** Highest-scoring accepted candidate, or null when every candidate was rejected. */
  best: CandidateEvaluation | null;
  /** Accepted candidates by score, then rejected ones. */
  ranked: CandidateEvaluation[];
  /** How many candidates each reject code hit (a candidate can hit several). */
  rejectCounts: Partial<Record<RejectCode, number>>;
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

function abbreviationsOf(ctx: SelectContext, o: SelectOptions): readonly string[] {
  return o.abbreviations ?? ctx.pack.abbreviations ?? [];
}

/**
 * Analyze the words of a text for selection: lexeme keys, parts of speech, pKnown,
 * target and unknown flags. Number segments are NUM and never counted.
 */
export function analyzeWords(text: string, ctx: SelectContext, o: SelectOptions = resolveSelectOptions(ctx.options)): WordInfo[] {
  const { pack, learner, now, pair } = ctx;
  const targets = new Set(ctx.targets.map(lexemeOf));
  const familiar = new Set([...(ctx.familiar ?? [])].map(lexemeOf));
  const names = new Set((ctx.names ?? []).map((n) => pack.normalize(n)).filter(Boolean));
  const excluded = new Set(o.excludePos);
  const segments = pack.segment(text);
  const starts = sentenceStartFlags(segments, abbreviationsOf(ctx, o));
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
        native: false, sentenceStart, analyzed: false,
      });
      return;
    }
    const capsMid = !sentenceStart && isCapitalized(seg.text);
    const named = names.has(norm) && isCapitalized(seg.text);
    const chosen = named ? undefined : choices.get(i)?.chosen;
    let pos: Pos | null = named ? 'PROPN' : chosen?.pos ?? null;
    if (!chosen && !named && capsMid && o.capitalizedUnknownAsPropn) pos = 'PROPN';
    const lemma = chosen?.lemma ?? norm;
    const key = lexemeKey(pack.code, lemma);
    const counted = !(pos !== null && excluded.has(pos));
    let pKnown = clamp01(learner.pKnown(key, o.skill, now));
    if (familiar.has(key)) pKnown = Math.max(pKnown, clamp01(o.familiarCredit));
    const target = targets.has(key);
    const native = pair !== undefined && !chosen && !named && isNativeWord(norm, pack, pair);
    words.push({
      kind: 'word', text: seg.text, norm, start: seg.start, end: seg.end, lemma, pos, key, counted, pKnown, target,
      unknown: counted && !target && pKnown < o.unknownBelow, native, sentenceStart, analyzed: chosen !== undefined || named,
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

/** Share of `a`'s words matched in order inside `b` (longest common subsequence / |a|). */
function containment(a: readonly string[], b: readonly string[]): number {
  if (!a.length) return 0;
  const dp = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j] as number;
      dp[j] = x === b[j - 1] ? prev + 1 : Math.max(dp[j] as number, dp[j - 1] as number);
      prev = tmp;
    }
  }
  return (dp[b.length] as number) / a.length;
}

function previousSentenceWords(previous: readonly string[], pack: LanguagePack, abbreviations?: readonly string[]): string[][] {
  const out: string[][] = [];
  for (const entry of previous) {
    for (const sentence of splitSentences(entry, abbreviations ?? pack.abbreviations ?? [])) {
      const w = normalizedWords(sentence, pack);
      if (w.length) out.push(w);
    }
  }
  return out;
}

/**
 * True when the text repeats a recent sentence: the same normalized word sequence, a
 * word set whose Jaccard overlap with a recent sentence reaches `nearJaccard`, or (with
 * `nearContainment` > 0) at least that share of its words, and at least `minWords`
 * words, inside one recent sentence in order. Previous entries are split into sentences
 * first.
 */
export function isRepeat(
  text: string,
  previous: readonly string[],
  pack: LanguagePack,
  nearJaccard: number,
  abbreviations?: readonly string[],
  nearContainment = 0,
  minWords = 3,
): boolean {
  const words = normalizedWords(text, pack);
  if (!words.length) return false;
  const joined = words.join(' ');
  for (const prev of previousSentenceWords(previous, pack, abbreviations)) {
    if (prev.join(' ') === joined) return true;
    if (jaccard(words, prev) >= nearJaccard) return true;
    if (nearContainment > 0 && words.length >= minWords && containment(words, prev) >= nearContainment) return true;
  }
  return false;
}

/** Leak patterns of a pack (StoryLanguageData.leakPatterns compiled with the "u" flag; bad sources are skipped). */
export function packLeakPatterns(pack: Pick<LanguagePack, 'story'>): RegExp[] {
  const out: RegExp[] = [];
  for (const src of pack.story?.leakPatterns ?? []) {
    try {
      out.push(new RegExp(src, 'u'));
    } catch {
      // A pattern that does not compile is ignored rather than failing every selection.
    }
  }
  return out;
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

const QUOTE_OPEN = `"“«„‘「『`;
const QUOTE_CLOSE = `"”»“’」』`;

/** True when the whole raw completion is one quotation: it opens with a quote mark and closes with one (end punctuation aside). */
function isWholeQuote(raw: string): boolean {
  const s = raw.trim().replace(/[\s.!?…。！？]+$/u, '');
  return s.length >= 2 && QUOTE_OPEN.includes(s[0] as string) && QUOTE_CLOSE.includes(s[s.length - 1] as string);
}

/** True for a heading: a markdown heading, a line ending in a colon, or a short title without end punctuation. */
function isHeading(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/^#{1,6}\s/u.test(s) || /[:：]$/u.test(s)) return true;
  if (/[.!?…。！？"”»'’)]$/u.test(s)) return false;
  const words = s.split(/\s+/u).filter((w) => /\p{L}/u.test(w));
  if (!words.length || words.length > 4) return false;
  return words.every((w) => isCapitalized(w)) || s === s.toUpperCase();
}

/** True for a comma list of single words ("el, que, lo, que, el"). */
function isCommaList(text: string, minCommas: number): boolean {
  const pieces = text.split(/[,،、，]/u);
  if (pieces.length - 1 < minCommas) return false;
  const single = pieces.filter((p) => p.trim().split(/\s+/u).filter(Boolean).length <= 1).length;
  return single / pieces.length >= 0.6;
}

/** Rejection codes for a candidate (empty list = accepted). `raw` is the model's completion when known. */
export function rejectReasons(
  text: string,
  words: readonly WordInfo[],
  ctx: SelectContext,
  o: SelectOptions,
  raw?: string,
  natural?: number | null,
): RejectCode[] {
  const out: RejectCode[] = [];
  if (!words.some((w) => w.kind === 'word')) {
    out.push('empty');
    return out;
  }
  const story = ctx.pack.story;
  const rawText = raw ?? text;
  if (o.placeholderPattern.test(text) || o.placeholderPattern.test(rawText)) out.push('placeholder');
  if (o.listPattern.test(rawText) || o.listPattern.test(text) || isCommaList(text, o.listCommas)) out.push('list');
  if (raw !== undefined && isHeading(raw)) out.push('heading');
  if (raw !== undefined && isWholeQuote(raw) && words.length < o.bareQuoteFactor * ctx.params.sentenceWords.min) out.push('bare_quote');
  if (detectPromptLeak(text, ctx.pack, [...o.leakPatterns, ...packLeakPatterns(ctx.pack)], ctx.instructions, o.leakNgram)) out.push('prompt_leak');
  const meta = new Set((story?.metaWords ?? []).map(foldForMatch));
  if (meta.size && words.some((w) => meta.has(foldForMatch(w.norm)))) out.push('meta');
  if (words.filter((w) => w.native).length > o.maxNativeWords) out.push('native_words');
  const letters = words.filter((w) => w.kind === 'word' && w.pos !== 'PROPN');
  const unknownToPack = letters.filter((w) => !w.analyzed).length;
  if (unknownToPack >= o.foreignMinWords && letters.length && unknownToPack / letters.length >= o.foreignShare) out.push('foreign');
  const requireVerb = o.requireVerb ?? story?.requireVerb ?? true;
  if (requireVerb && !words.some((w) => w.pos !== null && o.verbPos.includes(w.pos))) out.push('no_verb');
  if (words.length < o.minWordsFactor * ctx.params.sentenceWords.min) out.push('too_short');
  if (words.length > o.hardMaxWordsFactor * ctx.params.sentenceWords.max) out.push('too_long');
  if (isRepeat(text, ctx.previous, ctx.pack, o.nearRepeatJaccard, abbreviationsOf(ctx, o), o.nearRepeatContainment, o.nearRepeatMinWords)) out.push('repeat');
  if (hasUnbalancedQuotes(text)) out.push('unbalanced_quotes');
  if (natural !== undefined && natural !== null && Number.isFinite(natural) && natural < o.naturalFloor) out.push('unnatural');
  return out;
}

const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();

const CONTENT_POS: readonly Pos[] = ['NOUN', 'VERB', 'ADJ', 'ADV'];

/** Names the recent story uses and its content lemmas, for continuity. */
function storyMemory(ctx: SelectContext, o: SelectOptions): { names: Set<string>; content: Set<string> } {
  const names = new Set((ctx.names ?? []).map((n) => ctx.pack.normalize(n)).filter(Boolean));
  const content = new Set<string>();
  for (const entry of ctx.previous) {
    const words = analyzeWords(entry, { ...ctx, targets: [], familiar: [], pair: undefined }, o);
    for (const w of words) {
      if (w.pos === 'PROPN') names.add(w.norm);
      else if (w.pos !== null && CONTENT_POS.includes(w.pos)) content.add(w.key);
    }
  }
  return { names, content };
}

function evaluateWith(
  cand: SelectCandidate,
  index: number,
  ctx: SelectContext,
  o: SelectOptions,
  memory: { names: Set<string>; content: Set<string> },
  prevWords: string[][],
): CandidateEvaluation {
  const { text, raw } = cand;
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
  const norms = normalizedWords(text, ctx.pack);
  let overlap = 0;
  for (const p of prevWords) overlap = Math.max(overlap, jaccard(norms, p));
  const propns = distinct(words.filter((w) => w.pos === 'PROPN' && w.kind === 'word').map((w) => w.norm));
  const namesUsed = propns.filter((n) => memory.names.has(n));
  const newNames = propns.filter((n) => !memory.names.has(n));
  const reusesContent = words.some((w) => w.pos !== null && CONTENT_POS.includes(w.pos) && memory.content.has(w.key));
  const natural = typeof cand.natural === 'number' && Number.isFinite(cand.natural) ? cand.natural : null;
  const parts: ScoreParts = {
    band: inBand ? 0 : -(o.outOfBandPenalty + o.belowBandWeight * dist.below + o.aboveBandWeight * dist.above),
    target: o.targetBonus * targetsHit.length,
    length: -o.lengthWeight * lenOff,
    unknown: -o.unknownPenalty * excessUnknown,
    novelty: -o.noveltyWeight * overlap,
    continuity: (namesUsed.length || reusesContent ? o.continuityBonus : 0) - o.newNamePenalty * newNames.length,
    natural: natural === null ? 0 : Math.max(-o.naturalClamp, Math.min(o.naturalClamp, o.naturalWeight * (natural - o.naturalBaseline))),
  };
  const score = parts.band + parts.target + parts.length + parts.unknown + parts.novelty + parts.continuity + parts.natural;
  const rejected = rejectReasons(text, words, ctx, o, raw, natural);

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
  if (overlap > 0) reasons.push(`overlap with a recent sentence ${fmt(overlap)} (${fmt(parts.novelty)})`);
  if (parts.continuity !== 0) reasons.push(`continuity ${fmt(parts.continuity)}${newNames.length ? ` (new names: ${newNames.join(', ')})` : ''}`);
  if (natural !== null) reasons.push(`natural ${fmt(natural)} nats per token (${fmt(parts.natural)})`);

  const out: CandidateEvaluation = {
    index, text, accepted: rejected.length === 0, rejected, words, wordCount: words.length, knownShare,
    bandShare, inBand, targetsHit, unknownNonTargets, nativeWords, overlap, namesUsed, newNames, natural, score, parts, reasons,
  };
  if (raw !== undefined) out.raw = raw;
  return out;
}

function asCandidate(c: string | SelectCandidate): SelectCandidate {
  return typeof c === 'string' ? { text: c } : c;
}

/**
 * Evaluate one candidate: analysis, shares, score parts, rejections and reasons.
 * See the module comment for the scoring method.
 */
export function evaluateCandidate(
  candidate: string | SelectCandidate,
  index: number,
  ctx: SelectContext,
  o: SelectOptions = resolveSelectOptions(ctx.options),
): CandidateEvaluation {
  return evaluateWith(asCandidate(candidate), index, ctx, o, storyMemory(ctx, o), previousSentenceWords(ctx.previous, ctx.pack, abbreviationsOf(ctx, o)));
}

/** Count reject codes over evaluations. */
export function countRejects(evals: readonly Pick<CandidateEvaluation, 'rejected'>[]): Partial<Record<RejectCode, number>> {
  const out: Partial<Record<RejectCode, number>> = {};
  for (const e of evals) for (const c of e.rejected) out[c] = (out[c] ?? 0) + 1;
  return out;
}

/** Rank evaluations: accepted by score (ties: input order), then rejected in input order. */
export function rankEvaluations(evals: readonly CandidateEvaluation[]): Selection {
  const accepted = evals.filter((e) => e.accepted).sort((a, b) => b.score - a.score || a.index - b.index);
  const rejected = evals.filter((e) => !e.accepted).sort((a, b) => a.index - b.index);
  return { best: accepted[0] ?? null, ranked: [...accepted, ...rejected], rejectCounts: countRejects(evals) };
}

/**
 * Choose the candidate sentence that best fits the learner (see the module comment).
 * Candidates are cleaned sentences, or SelectCandidate objects that also carry the raw
 * completion and a natural score. Deterministic: the same inputs always give the same
 * ranking.
 */
export function selectSentence(candidates: readonly (string | SelectCandidate)[], ctx: SelectContext): Selection {
  const o = resolveSelectOptions(ctx.options);
  const memory = storyMemory(ctx, o);
  const prevWords = previousSentenceWords(ctx.previous, ctx.pack, abbreviationsOf(ctx, o));
  return rankEvaluations(candidates.map((c, i) => evaluateWith(asCandidate(c), i, ctx, o, memory, prevWords)));
}
