/**
 * Choose where the story stops (the cliff): which word the learner must supply next, and
 * how many words are hidden.
 *
 * Method
 * ------
 * Each scored position (from the scoring module's CliffPosition list) is checked, then
 * scored:
 * 1. Exclusions: the position must be a word segment of `ctx.text`; never the first word
 *    of the text or of a sentence (no context to guess from); never a PROPN or NUM (by
 *    the pack's analysis, or a capitalized word the pack does not know away from a
 *    sentence start); never punctuation; and the actual word must be plausible:
 *    P(actual) >= probFloor, so that guessing it is fair.
 * 2. Score = targetBonus if the word's lexeme is a target being practiced
 *          + meaningNotSpeakingWeight x pKnown(meaning) x (1 - pKnown(speaking))
 *            (words the learner understands but cannot yet produce are the best practice)
 *          + probWeight x P(actual) (natural, guessable continuations)
 *          + contextWeight x (position in its sentence / sentence length) (more context).
 * 3. The best eligible position wins (ties: higher P(actual), then later word). The cliff
 *    hides params.cliffWords words (rounded, at least 1) from there, cut at the end of
 *    the sentence and before a name or a number (the exclusions of step 1 hold for every
 *    hidden word, not only the first). Returns null when no position is eligible.
 */
import type { LanguagePack, Pos, Segment } from '../lang/types';
import type { CliffPosition } from '../scoring/types';
import type { DifficultyParams, LearnerView } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { chooseAnalysesInText } from '../lang/choose';
import {
  clamp01,
  isCapitalized,
  isContent,
  sentenceEndFlags,
  sentenceStartFlags,
  wholeAtLeast,
} from './text';

/** Tunable numbers of pickCliff. */
export interface CliffPickOptions {
  /** Minimum P(actual word | context) for a cliff position. */
  probFloor: number;
  /** Bonus when the word's lexeme is one of ctx.targets. */
  targetBonus: number;
  /** Weight of pKnown(meaning) x (1 - pKnown(speaking)). */
  meaningNotSpeakingWeight: number;
  /** Weight of P(actual word). */
  probWeight: number;
  /** Weight of the relative position in the sentence (0 at its first word, near 1 at its last). */
  contextWeight: number;
  /** Parts of speech never used as a cliff. */
  excludePos: readonly Pos[];
  /** Treat capitalized words the pack does not know, away from a sentence start, as names. */
  capitalizedUnknownAsPropn: boolean;
  abbreviations?: readonly string[];
}

export const DEFAULT_CLIFF_PICK_OPTIONS: Readonly<CliffPickOptions> = {
  // Checked against the proof test's next-word lists (Qwen3-1.7B): the tenth most likely
  // word of a standard opening has about 0.01, so 0.02 keeps a cliff word among the
  // model's real candidates. Not yet checked against learner answers.
  probFloor: 0.02,
  targetBonus: 2,
  meaningNotSpeakingWeight: 1.5,
  probWeight: 0.5,
  contextWeight: 0.3,
  excludePos: ['PROPN', 'NUM'],
  capitalizedUnknownAsPropn: true,
};

export interface CliffPickContext {
  /** The text the positions index: CliffPosition.wordIndex counts its word segments. */
  text: string;
  pack: LanguagePack;
  learner: LearnerView;
  /** Time for pKnown, ms since epoch. */
  now: number;
  /** Lexeme keys being introduced or practiced. */
  targets: readonly string[];
  /** Uses cliffWords. */
  params: DifficultyParams;
  options?: Partial<CliffPickOptions>;
}

export type CliffExclusion =
  | 'not_in_text'
  | 'punctuation'
  | 'first_word'
  | 'sentence_start'
  | 'proper_noun'
  | 'number'
  | 'implausible';

/** How one position was judged. */
export interface CliffCandidate {
  wordIndex: number;
  position: CliffPosition;
  eligible: boolean;
  excluded: CliffExclusion[];
  /** Lexeme key of the word ('' when the position is not a word of the text). */
  key: string;
  prob: number;
  score: number;
  reasons: string[];
}

export interface CliffPick {
  /** Index of the first hidden word among the word segments of ctx.text. */
  wordIndex: number;
  /** The hidden words, as written. */
  words: string[];
  /** Their segments. */
  segments: Segment[];
  /** Character span of the hidden words in ctx.text. */
  start: number;
  end: number;
  /** Lexeme key of the first hidden word. */
  key: string;
  score: number;
}

/** Merge options with the defaults. */
export function resolveCliffPickOptions(options?: Partial<CliffPickOptions>): CliffPickOptions {
  return { ...DEFAULT_CLIFF_PICK_OPTIONS, ...options };
}

interface TextLayout {
  segments: Segment[];
  starts: boolean[];
  ends: boolean[];
  /** Segment index of each word segment, by word index. */
  wordSegIndex: number[];
}

function layout(text: string, pack: LanguagePack, abbreviations?: readonly string[]): TextLayout {
  const segments = pack.segment(text);
  const wordSegIndex: number[] = [];
  segments.forEach((s, i) => {
    if (s.kind === 'word') wordSegIndex.push(i);
  });
  return {
    segments,
    starts: sentenceStartFlags(segments, abbreviations),
    ends: sentenceEndFlags(segments, abbreviations),
    wordSegIndex,
  };
}

/** Segment index of a position: matched by start offset, else by word index with the same text. */
function locate(pos: CliffPosition, lay: TextLayout): number | undefined {
  const byStart = lay.segments.findIndex((s) => s.start === pos.segment.start && s.kind === pos.segment.kind);
  if (byStart >= 0) return byStart;
  const byIndex = lay.wordSegIndex[pos.wordIndex];
  if (byIndex !== undefined && lay.segments[byIndex]?.text === pos.segment.text) return byIndex;
  return undefined;
}

/** Content segments of the sentence that contains segment `i`: [first, last] segment indices. */
function sentenceBounds(i: number, lay: TextLayout): { first: number; last: number } {
  let first = i;
  for (let j = i - 1; j >= 0; j--) {
    if (lay.ends[j]) break;
    if (isContent(lay.segments[j] as Segment)) first = j;
  }
  let last = i;
  for (let j = i + 1; j < lay.segments.length; j++) {
    if (lay.ends[j]) break;
    if (isContent(lay.segments[j] as Segment)) last = j;
  }
  return { first, last };
}

/**
 * The words hidden by a cliff starting at segment `i`: up to `count` word or number
 * segments, stopping at the end of the sentence and before any later segment for which
 * `stopBefore(segmentIndex)` is true (pickCliff stops before names and numbers).
 */
export function cliffSpan(
  i: number,
  count: number,
  segments: readonly Segment[],
  ends: readonly boolean[],
  stopBefore: (segIndex: number) => boolean = () => false,
): Segment[] {
  const out: Segment[] = [];
  for (let j = i; j < segments.length && out.length < count; j++) {
    if (ends[j]) break;
    const s = segments[j] as Segment;
    if (!isContent(s)) continue;
    if (j > i && stopBefore(j)) break;
    out.push(s);
  }
  return out;
}

const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();

/**
 * Judge every position: exclusions, lexeme key, probability and score with reasons
 * (see the module comment). Returned in input order.
 */
export function rankCliffPositions(positions: readonly CliffPosition[], ctx: CliffPickContext): CliffCandidate[] {
  const o = resolveCliffPickOptions(ctx.options);
  const lay = layout(ctx.text, ctx.pack, o.abbreviations ?? ctx.pack.abbreviations);
  const choices = new Map(chooseAnalysesInText(ctx.pack, lay.segments, lay.starts).map((c) => [c.segIndex, c]));
  const targets = new Set(ctx.targets.map(lexemeOf));
  const excludedPos = new Set(o.excludePos);
  return positions.map((position) => {
    const excluded: CliffExclusion[] = [];
    const reasons: string[] = [];
    const prob = Number.isFinite(position.actualLogprob) ? Math.exp(position.actualLogprob) : 0;
    const idx = locate(position, lay);
    const seg = idx === undefined ? undefined : lay.segments[idx];
    if (idx === undefined || !seg) {
      return { wordIndex: position.wordIndex, position, eligible: false, excluded: ['not_in_text'], key: '', prob, score: -Infinity, reasons: ['position not found in text'] };
    }
    if (seg.kind === 'punct' || seg.kind === 'space') excluded.push('punctuation');
    if (seg.kind === 'number') excluded.push('number');
    if (position.wordIndex === 0 || lay.wordSegIndex[0] === idx) excluded.push('first_word');
    else if (lay.starts[idx]) excluded.push('sentence_start');

    const norm = seg.norm || ctx.pack.normalize(seg.text);
    const capsMid = !lay.starts[idx] && isCapitalized(seg.text);
    const analysis = seg.kind === 'word' ? choices.get(idx)?.chosen : undefined;
    let pos: Pos | null = analysis?.pos ?? null;
    if (!analysis && capsMid && o.capitalizedUnknownAsPropn && seg.kind === 'word') pos = 'PROPN';
    if (pos !== null && excludedPos.has(pos)) excluded.push(pos === 'NUM' ? 'number' : 'proper_noun');
    if (prob < o.probFloor) excluded.push('implausible');

    const key = lexemeKey(ctx.pack.code, analysis?.lemma ?? norm);
    const isTarget = targets.has(key);
    const pMeaning = clamp01(ctx.learner.pKnown(key, 'meaning', ctx.now));
    const pSpeaking = clamp01(ctx.learner.pKnown(key, 'speaking', ctx.now));
    const { first, last } = sentenceBounds(idx, lay);
    let sentenceWords = 0;
    let before = 0;
    for (let j = first; j <= last; j++) {
      if (!isContent(lay.segments[j] as Segment)) continue;
      sentenceWords++;
      if (j < idx) before++;
    }
    const rel = sentenceWords > 0 ? before / sentenceWords : 0;
    const parts = {
      target: isTarget ? o.targetBonus : 0,
      gap: o.meaningNotSpeakingWeight * pMeaning * (1 - pSpeaking),
      prob: o.probWeight * prob,
      context: o.contextWeight * rel,
    };
    const score = parts.target + parts.gap + parts.prob + parts.context;
    for (const e of excluded) reasons.push(`excluded: ${e}`);
    reasons.push(`P(actual) ${fmt(prob)} vs floor ${fmt(o.probFloor)}`);
    if (isTarget) reasons.push(`target ${key} (+${fmt(parts.target)})`);
    reasons.push(`meaning ${fmt(pMeaning)}, speaking ${fmt(pSpeaking)} (+${fmt(parts.gap)})`);
    reasons.push(`context ${before}/${sentenceWords} (+${fmt(parts.context)})`);
    const unique = [...new Set(excluded)];
    return { wordIndex: position.wordIndex, position, eligible: unique.length === 0, excluded: unique, key, prob, score, reasons };
  });
}

/**
 * Choose the cliff: the best eligible position and the words it hides (see the module
 * comment). Returns null when no position is eligible.
 */
export function pickCliff(positions: readonly CliffPosition[], ctx: CliffPickContext): CliffPick | null {
  const o = resolveCliffPickOptions(ctx.options);
  const ranked = rankCliffPositions(positions, ctx)
    .filter((c) => c.eligible)
    .sort((a, b) => b.score - a.score || b.prob - a.prob || b.wordIndex - a.wordIndex);
  const best = ranked[0];
  if (!best) return null;
  const lay = layout(ctx.text, ctx.pack, o.abbreviations ?? ctx.pack.abbreviations);
  const idx = locate(best.position, lay);
  if (idx === undefined) return null;
  // The rest of the span obeys the same exclusions as its first word: no names, no numbers.
  const choices = new Map(chooseAnalysesInText(ctx.pack, lay.segments, lay.starts).map((c) => [c.segIndex, c]));
  const excludedPos = new Set(o.excludePos);
  const stopBefore = (j: number): boolean => {
    const seg = lay.segments[j] as Segment;
    if (seg.kind === 'number') return true;
    const c = choices.get(j);
    if (!c) return false;
    if (c.chosen) return excludedPos.has(c.chosen.pos);
    return o.capitalizedUnknownAsPropn && c.capitalizedMidSentence && excludedPos.has('PROPN');
  };
  const span = cliffSpan(idx, wholeAtLeast(ctx.params.cliffWords), lay.segments, lay.ends, stopBefore);
  const first = span[0];
  const last = span[span.length - 1];
  if (!first || !last) return null;
  return {
    wordIndex: best.wordIndex,
    words: span.map((s) => s.text),
    segments: span,
    start: first.start,
    end: last.end,
    key: best.key,
    score: best.score,
  };
}
