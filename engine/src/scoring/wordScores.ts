/**
 * Word-level surprise scoring: turn the model's token log-probabilities for a text into
 * one score per word, and a heat level (0 to 3) that drives the amber shading of the
 * learner's own sentences.
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { LanguageModel, TokenScore } from '../model/types';
import type { Heat, WordScore } from './types';
import { clampLogprob, isSpace } from './text';

/**
 * Returns how much of a word's surprisal (in nats) is explained by the word itself rather
 * than by the context, e.g. because it is rare. It is subtracted from the surprisal
 * before the heat thresholds apply, so rare-but-correct words are not over-shaded.
 * Non-finite results count as 0. Negative results raise the heat (allowed on purpose,
 * e.g. for words the learner is known to confuse).
 */
export type SurprisalBaseline = (norm: string, segment: Segment) => number;

export interface HeatOptions {
  /**
   * Three ascending surprisal thresholds in nats. heat = how many of them the
   * (baseline-adjusted) surprisal reaches: below the first is 0, at or above the
   * third is 3.
   */
  thresholds: readonly [number, number, number];
  /**
   * Token log-probabilities below this (including -Infinity or NaN from an adapter) are
   * clamped to it, so word scores and sums stay finite and comparable.
   */
  logprobFloor: number;
  /** Optional typical-surprisal hook; see SurprisalBaseline and frequencyBaseline(). */
  baseline?: SurprisalBaseline;
}

export const DEFAULT_HEAT_OPTIONS: Readonly<HeatOptions> = {
  // set from proof/RESULTS.md. Placeholders: heat 1 below p = 1.8% (4 nats),
  // heat 2 below p = 0.09% (7 nats), heat 3 below p = 0.005% (10 nats).
  thresholds: [4, 7, 10],
  logprobFloor: -100,
};

export interface FrequencyBaselineOptions {
  /** Lemmas at or above this frequency rank (more common) get no baseline. */
  commonRank: number;
  /**
   * Nats subtracted per natural-log unit of rank beyond commonRank. Under Zipf's law a
   * word's unigram surprisal grows by about 1 nat per e-fold of rank, so 1 would remove
   * all of the rarity and 0 none of it.
   */
  natsPerLogRank: number;
  /** Upper bound on the baseline in nats, so no word becomes unshadeable. */
  maxBaseline: number;
}

export const DEFAULT_BASELINE_OPTIONS: Readonly<FrequencyBaselineOptions> = {
  // set from proof/RESULTS.md
  commonRank: 500,
  // set from proof/RESULTS.md
  natsPerLogRank: 0.5,
  // set from proof/RESULTS.md
  maxBaseline: 4,
};

/**
 * Map a surprisal (nats) to a heat level by counting how many of the three thresholds it
 * reaches. Thresholds should be ascending; the count is monotonic in surprisal either way.
 * NaN maps to 0.
 */
export function heatFor(surprisal: number, thresholds: readonly [number, number, number]): Heat {
  let n = 0;
  for (const t of thresholds) if (surprisal >= t) n++;
  return Math.min(n, 3) as Heat;
}

/**
 * Build a baseline hook from the pack's frequency list. A word's lemma is the first
 * analysis of its normalized form (or the form itself when unknown). Its baseline is
 * natsPerLogRank * max(0, ln(rank) - ln(commonRank)), capped at maxBaseline. Words whose
 * lemma has no rank get 0: an unknown word may be a mistake and must stay shadeable.
 */
export function frequencyBaseline(
  pack: LanguagePack,
  opts: Partial<FrequencyBaselineOptions> = {},
): SurprisalBaseline {
  const o = { ...DEFAULT_BASELINE_OPTIONS, ...opts };
  return (norm: string) => {
    const lemma = pack.analyze(norm)[0]?.lemma ?? norm;
    const rank = pack.frequencyRank(lemma);
    if (rank === undefined || !(rank > 0)) return 0;
    const excess = Math.log(rank) - Math.log(Math.max(1, o.commonRank));
    return Math.min(o.maxBaseline, Math.max(0, o.natsPerLogRank * excess));
  };
}

/**
 * Distribute token log-probabilities over the word segments of the scored text.
 *
 * Method: every character of the text is mapped to the word segment containing it (or to
 * none for spaces, punctuation and numbers). For each token, its non-space characters are
 * counted per word:
 * - all of them in one word (the usual case, including tokens like "ado." whose other
 *   characters are punctuation): the whole logprob goes to that word, i.e. a token
 *   belongs to the word containing its first non-space word character;
 * - spread over two or more words (a token spanning a word boundary, e.g. when the
 *   pack splits clitics or the script has no spaces): the logprob is split in proportion
 *   to the number of characters in each word;
 * - none (whitespace-only or punctuation-only tokens): attached to no word.
 *
 * Note the consequence of the spacing convention: a word's leading-space token also
 * carries the model's decision that the previous word ended, and a punctuation token's
 * logprob (e.g. a surprising full stop) is not attributed to any word.
 *
 * Returns one summed logprob per word segment, indexed by word index. Token offsets are
 * clamped to the text; token logprobs are clamped to `logprobFloor`.
 */
export function alignTokensToWords(
  tokens: readonly TokenScore[],
  segments: readonly Segment[],
  logprobFloor: number = DEFAULT_HEAT_OPTIONS.logprobFloor,
): number[] {
  const words = segments.filter((s) => s.kind === 'word');
  const sums = words.map(() => 0);
  if (words.length === 0) return sums;
  let textEnd = 0;
  for (const s of segments) textEnd = Math.max(textEnd, s.end);
  for (const t of tokens) textEnd = Math.max(textEnd, t.end);
  const owner = new Int32Array(textEnd).fill(-1);
  words.forEach((w, wi) => {
    for (let i = Math.max(0, w.start); i < Math.min(w.end, owner.length); i++) owner[i] = wi;
  });
  for (const tok of tokens) {
    const lp = clampLogprob(tok.logprob, logprobFloor);
    const counts = new Map<number, number>();
    let total = 0;
    const start = Math.max(0, tok.start);
    const end = Math.min(owner.length, tok.end);
    for (let i = start; i < end; i++) {
      const wi = owner[i] ?? -1;
      if (wi < 0) continue;
      const ch = tok.text[i - tok.start];
      if (ch !== undefined && isSpace(ch)) continue;
      counts.set(wi, (counts.get(wi) ?? 0) + 1);
      total++;
    }
    if (total === 0) continue;
    for (const [wi, c] of counts) sums[wi] = (sums[wi] ?? 0) + (lp * c) / total;
  }
  return sums;
}

/**
 * Pure part of scoreWords: build WordScores from already computed tokens and segments.
 * surprisal = -logprob; heat = heatFor(surprisal - baseline(norm, segment)).
 */
export function wordScoresFromTokens(
  tokens: readonly TokenScore[],
  segments: readonly Segment[],
  opts: Partial<HeatOptions> = {},
): WordScore[] {
  const o = { ...DEFAULT_HEAT_OPTIONS, ...opts };
  const sums = alignTokensToWords(tokens, segments, o.logprobFloor);
  const words = segments.filter((s) => s.kind === 'word');
  return words.map((segment, wordIndex) => {
    const logprob = sums[wordIndex] ?? 0;
    const surprisal = 0 - logprob;
    let adjusted = surprisal;
    if (o.baseline) {
      const b = o.baseline(segment.norm, segment);
      if (Number.isFinite(b)) adjusted -= b;
    }
    return { segment, wordIndex, logprob, surprisal, heat: heatFor(adjusted, o.thresholds) };
  });
}

/**
 * Score every word of `text` as a continuation of `context`.
 *
 * Method: one model.scoreContinuation(context, text) call; the text is segmented with
 * pack.segment (never by spaces); tokens are aligned to word segments as described in
 * alignTokensToWords; each word's surprisal is turned into a heat level with the
 * thresholds in `opts` (defaults in DEFAULT_HEAT_OPTIONS), after subtracting the
 * optional baseline. Spacing follows the model convention: pass " palabra" (with its
 * leading space) when the context ends in a word.
 */
export async function scoreWords(
  model: LanguageModel,
  pack: LanguagePack,
  context: string,
  text: string,
  opts: Partial<HeatOptions> = {},
): Promise<WordScore[]> {
  const segments = pack.segment(text);
  if (!segments.some((s) => s.kind === 'word')) return [];
  const tokens = await model.scoreContinuation(context, text);
  return wordScoresFromTokens(tokens, segments, opts);
}

/**
 * Total log-probability of `text` as a continuation of `context` (one scoreContinuation
 * call). Every token counts, punctuation included; each token is clamped to
 * `logprobFloor` first so the sum stays finite.
 */
export async function sentenceLogprob(
  model: LanguageModel,
  context: string,
  text: string,
  logprobFloor: number = DEFAULT_HEAT_OPTIONS.logprobFloor,
): Promise<number> {
  if (text.length === 0) return 0;
  const tokens = await model.scoreContinuation(context, text);
  let s = 0;
  for (const t of tokens) s += clampLogprob(t.logprob, logprobFloor);
  return s;
}

/**
 * Mean log-probability per token, a length-neutral fluency measure for comparing texts
 * that tokenize to different lengths. Tokens are clamped to `logprobFloor`. Returns 0
 * for an empty token list (the log-probability of the empty text).
 */
export function meanTokenLogprob(
  tokens: readonly TokenScore[],
  logprobFloor: number = DEFAULT_HEAT_OPTIONS.logprobFloor,
): number {
  if (tokens.length === 0) return 0;
  let s = 0;
  for (const t of tokens) s += clampLogprob(t.logprob, logprobFloor);
  return s / tokens.length;
}
