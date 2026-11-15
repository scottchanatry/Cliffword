/**
 * Cliff scoring: how well each word of a story sentence works as a cliff (the point where
 * the story stops and the learner says what comes next), and how much credit a learner's
 * answer earns. The model only scores; credit comes from probability, so every natural
 * answer earns credit, not just the story's word.
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { CliffPosition, CliffResult, Credit, CreditReason, NextWord } from './types';
import {
  DEFAULT_NEXT_WORD_OPTIONS,
  nextWordsDetailed,
  wordBoundaryMass,
  type ModelCallListener,
  type NextWordOptions,
} from './nextWord';
import { alignTokensToWords } from './wordScores';
import {
  DEFAULT_ACCENT_MARKS,
  atSentenceStart,
  clampLogprob,
  contentSegments,
  firstLetterIsUpper,
  foldAccents,
  lowerFirstLetter,
  needsLeadingSpace,
  trimAnswer,
  upperFirstLetter,
} from './text';

export interface CliffOptions {
  /** An alternative counts as plausible when its probability is above this. */
  plausibleFloor: number;
  /** Alternatives returned per position (overrides nextWord.k). */
  k: number;
  /** Word indices to analyse; all words when omitted. Invalid indices are ignored. */
  positions?: readonly number[];
  /**
   * Multiply the actual word's probability by its boundary mass (one nextTokens call per
   * position), so actualLogprob is a whole-word probability on the same scale as the
   * alternatives. Without it, a word whose tokens are a prefix of longer words (" leer"
   * of " leer"+"la") is over-estimated.
   */
  actualBoundary: boolean;
  /** Token log-probabilities are clamped to this; see DEFAULT_HEAT_OPTIONS. */
  logprobFloor: number;
  /** Options for the next-word search (k and normalize are set by this module). */
  nextWord: Partial<NextWordOptions>;
  /** Called once per model call, before it is issued. */
  onModelCall?: ModelCallListener;
}

export const DEFAULT_CLIFF_OPTIONS: Readonly<CliffOptions> = {
  // set from proof/RESULTS.md
  plausibleFloor: 0.02,
  k: 10,
  actualBoundary: true,
  logprobFloor: -100,
  nextWord: {},
};

export interface CreditOptions {
  /** Full credit (likely) when P(answer) >= fullRatio * P(top alternative). */
  fullRatio: number;
  /** Full credit (likely) when P(answer) >= fullFloor regardless of the alternatives. */
  fullFloor: number;
  /** Partial credit (plausible) when P(answer) >= partialFloor. */
  partialFloor: number;
  /**
   * Multi-word answers: full credit (likely) when the answer's mean logprob per word is at
   * most this many nats below the actual continuation's mean logprob per word.
   */
  multiFullMargin: number;
  /** Multi-word answers: partial credit (plausible) within this many nats per word. */
  multiPartialMargin: number;
  /** Alternatives returned with the result (overrides nextWord.k). */
  k: number;
  /**
   * Multiply a scored answer's probability by its boundary mass (one extra nextTokens
   * call), so a prefix of a longer word (" cans") is not mistaken for a word and scores
   * are on the same scale as the alternatives.
   */
  includeBoundary: boolean;
  /**
   * When a single-word answer is not a known form as written (see knownAsWritten), score
   * its accented spelling ("reír" for "reir"): an alternative that matches it after
   * removing accents, or else the form the pack inflects from its analysis. Known forms
   * are never changed ("hablo" stays "hablo", not "habló").
   */
  restoreAccents: boolean;
  /**
   * Combining marks removed for accent-insensitive comparison; see DEFAULT_ACCENT_MARKS.
   * Used only when the pack has no foldAccents method; the pack's own folding (which
   * knows which marks are accents in its language) wins.
   */
  accentMarks: string;
  /** Token log-probabilities are clamped to this. */
  logprobFloor: number;
  /** Options for the next-word search (k and normalize are set by this module). */
  nextWord: Partial<NextWordOptions>;
  /** Called once per model call, before it is issued. */
  onModelCall?: ModelCallListener;
}

export const DEFAULT_CREDIT_OPTIONS: Readonly<CreditOptions> = {
  // set from proof/RESULTS.md
  fullRatio: 0.25,
  // set from proof/RESULTS.md
  fullFloor: 0.05,
  // set from proof/RESULTS.md
  partialFloor: 0.005,
  // set from proof/RESULTS.md
  multiFullMargin: 1.0,
  // set from proof/RESULTS.md
  multiPartialMargin: 2.5,
  k: 10,
  includeBoundary: true,
  restoreAccents: true,
  accentMarks: DEFAULT_ACCENT_MARKS,
  logprobFloor: -100,
  nextWord: {},
};

/** Remove trailing whitespace; contexts are passed to the model without it. */
function trimEndSpace(s: string): string {
  return s.replace(/\s+$/u, '');
}

function normOf(pack: LanguagePack, seg: Segment): string {
  return seg.norm || pack.normalize(seg.text);
}

function nextWordOptions(
  pack: LanguagePack,
  k: number,
  base: Partial<NextWordOptions>,
  onModelCall: ModelCallListener | undefined,
): NextWordOptions {
  const o: NextWordOptions = { ...DEFAULT_NEXT_WORD_OPTIONS, ...base, k, normalize: (w) => pack.normalize(w) };
  if (onModelCall) o.onModelCall = onModelCall;
  return o;
}

/**
 * Analyse word positions of `sentence` (spoken after `context`) as cliffs.
 *
 * Method: the sentence is segmented with pack.segment and scored with ONE
 * scoreContinuation(context, sentence) call; token log-probabilities are aligned to
 * words (alignTokensToWords) to give each word's log P(word | context + sentence before
 * it). Then, only for the requested positions (opts.positions, or every word):
 * - alternatives = nextWords(context + sentence up to the word, trailing whitespace
 *   removed so the model sees the canonical "word + leading space" tokenization);
 * - if opts.actualBoundary, the actual word's logprob gets log(boundary mass) after it,
 *   so it is a whole-word probability like the alternatives (one nextTokens call);
 * - plausibleCount = alternatives with probability above opts.plausibleFloor.
 * A good cliff has a likely actual word and few plausible alternatives (or many natural
 * ones, for free answers). Pass `sentence` with its leading space when the context ends
 * in a word. Positions come back sorted by word index.
 */
export async function cliffPositions(
  model: LanguageModel,
  pack: LanguagePack,
  context: string,
  sentence: string,
  opts: Partial<CliffOptions> = {},
): Promise<CliffPosition[]> {
  const o = { ...DEFAULT_CLIFF_OPTIONS, ...opts };
  const segments = pack.segment(sentence);
  const words = segments.filter((s) => s.kind === 'word');
  const wanted =
    o.positions === undefined
      ? words.map((_, i) => i)
      : [...new Set(o.positions)].filter((i) => Number.isInteger(i) && i >= 0 && i < words.length).sort((a, b) => a - b);
  if (wanted.length === 0) return [];

  o.onModelCall?.({ method: 'scoreContinuation', context });
  const tokens = await model.scoreContinuation(context, sentence);
  const wordLps = alignTokensToWords(tokens, segments, o.logprobFloor);
  const nw = nextWordOptions(pack, o.k, o.nextWord, o.onModelCall);

  const out: CliffPosition[] = [];
  for (const wordIndex of wanted) {
    const segment = words[wordIndex] as Segment;
    const before = trimEndSpace(context + sentence.slice(0, segment.start));
    const alternatives = (await nextWordsDetailed(model, before, nw)).words;
    let actualLogprob = wordLps[wordIndex] ?? 0;
    if (o.actualBoundary) {
      const mass = await wordBoundaryMass(model, context + sentence.slice(0, segment.end), nw);
      actualLogprob += clampLogprob(Math.log(mass), o.logprobFloor);
    }
    const plausibleCount = alternatives.filter((a) => a.prob > o.plausibleFloor).length;
    out.push({ wordIndex, segment, actualLogprob, alternatives, plausibleCount });
  }
  return out;
}

/**
 * Adjust the case of an answer for its position: capitalize the first letter at a
 * sentence start; mid-sentence, lowercase a capitalized first word that the pack knows
 * and never analyses as a proper noun (phone keyboards capitalize the first letter of
 * any input). Unknown or proper-noun words keep their case.
 */
export function caseForPosition(pack: LanguagePack, context: string, text: string): string {
  if (atSentenceStart(context)) return upperFirstLetter(text);
  if (!firstLetterIsUpper(text)) return text;
  const first = contentSegments(pack.segment(text))[0];
  if (!first) return text;
  const analyses = pack.analyze(normOf(pack, first));
  if (analyses.length > 0 && analyses.every((a) => a.pos !== 'PROPN')) return lowerFirstLetter(text);
  return text;
}

/**
 * True if `norm` is a word the pack knows exactly as written. pack.analyze alone cannot
 * tell: a pack may find "reir" by ignoring accents (and return the analyses of "reír").
 * So the analyses are re-inflected: the word is known as written when one of them
 * inflects back to `norm`. When the pack can inflect none of them (uninflectable words,
 * stub packs), any analysis counts. Unknown words (no analysis) are not known.
 */
export function knownAsWritten(pack: LanguagePack, norm: string): boolean {
  const analyses = pack.analyze(norm);
  if (analyses.length === 0) return false;
  let producible = false;
  for (const a of analyses) {
    const form = pack.inflect(a.lemma, a.features);
    if (form === undefined) continue;
    producible = true;
    if (pack.normalize(form) === norm) return true;
  }
  return !producible;
}

/**
 * The pack's own spelling of `norm` when it differs only in accents: the first analysis
 * whose inflection normalizes to a different form with the same folded spelling ("reir"
 * gives "reír"). Undefined when there is none.
 */
export function accentedForm(pack: LanguagePack, norm: string, fold: (s: string) => string): string | undefined {
  const key = fold(norm);
  for (const a of pack.analyze(norm)) {
    const form = pack.inflect(a.lemma, a.features);
    if (form === undefined) continue;
    const n = pack.normalize(form);
    if (n && n !== norm && fold(n) === key) return n;
  }
  return undefined;
}

/** True if the two words share a lemma according to pack.analyze. */
function sharesLemma(pack: LanguagePack, a: string, b: string): boolean {
  const la = new Set(pack.analyze(a).map((x) => x.lemma));
  if (la.size === 0) return false;
  return pack.analyze(b).some((x) => la.has(x.lemma));
}

/**
 * Credit for a learner's answer at a cliff.
 *
 * Preparation: whitespace and trailing punctuation are removed from the answer and from
 * `actual` (via pack.segment); the context loses trailing whitespace, and the answer is
 * scored with a leading space when the context ends in a word or other non-opening
 * character (needsLeadingSpace). Case is adjusted for the position (caseForPosition).
 * Alternatives are always computed with nextWords at the cliff and returned.
 *
 * Single-word answer and single-word actual:
 * - the actual word, compared by pack.normalize or accent-insensitively (foldAccents),
 *   is always full credit, reason 'actual';
 * - P(answer): taken from the alternatives when its normalized form is among them (so it
 *   is on exactly the same scale), otherwise scored with scoreContinuation, times the
 *   boundary mass when includeBoundary; a missing accent on a form the pack does not
 *   know as written (knownAsWritten) is restored when restoreAccents, from a matching
 *   alternative or else from the pack's own spelling (accentedForm), which is scored;
 * - full credit, 'likely', if P >= fullRatio * P(top alternative) or P >= fullFloor;
 * - partial, 'plausible', if P >= partialFloor;
 * - partial, 'form', if the answer shares a lemma with the actual word (pack.analyze)
 *   but the form differs;
 * - otherwise none, 'unlikely'.
 *
 * Multi-word answer or actual (cliffs that span several words): the answer and the
 * actual continuation are each scored (with boundary mass) and compared by mean logprob
 * per word: identical word sequences (normalized or accent-insensitive) are 'actual';
 * within multiFullMargin nats per word of the actual is full 'likely'; within
 * multiPartialMargin is partial 'plausible'; every answer word sharing a lemma with the
 * actual word in the same place is partial 'form'; else none. An answer with fewer words
 * than the cliff is compared with the same number of actual words (its first ones; not
 * scored again when the answer is exactly those words) and earns at most partial
 * 'plausible': it does not cover the cliff, and the first words of a continuation are
 * usually its most predictable ones. An empty `actual` is replaced by the top
 * alternative's logprob as the reference.
 *
 * rank is the 1-based position of a single-word answer among the alternatives, else null.
 * An answer with no words (empty, punctuation only) gets none with logprob = logprobFloor.
 * `scored` reports the text that was scored or matched (trimmed, case-adjusted, accent
 * restored); accent folding uses pack.foldAccents when the pack has it, else
 * opts.accentMarks.
 */
export async function scoreCliffAnswer(
  model: LanguageModel,
  pack: LanguagePack,
  contextBeforeCliff: string,
  answer: string,
  actual: string,
  opts: Partial<CreditOptions> = {},
): Promise<CliffResult> {
  const o = { ...DEFAULT_CREDIT_OPTIONS, ...opts };
  const ctx = trimEndSpace(contextBeforeCliff);
  const lead = needsLeadingSpace(ctx) ? ' ' : '';
  const nw = nextWordOptions(pack, o.k, o.nextWord, o.onModelCall);
  const fold = (s: string): string => (pack.foldAccents ? pack.foldAccents(s) : foldAccents(s, o.accentMarks));

  const alternatives: NextWord[] = (await nextWordsDetailed(model, ctx, nw)).words;
  let scored = '';
  const result = (logprob: number, rank: number | null, credit: Credit, reason: CreditReason): CliffResult => ({
    answer,
    scored,
    logprob,
    prob: Math.exp(logprob),
    rank,
    credit,
    reason,
    alternatives,
  });

  const ans = trimAnswer(pack, answer);
  const act = trimAnswer(pack, actual);
  const ansWords = contentSegments(pack.segment(ans));
  const actWords = contentSegments(pack.segment(act));
  if (ansWords.length === 0) return result(o.logprobFloor, null, 'none', 'unlikely');
  /** The form shown for a text: as it would be scored at this position, without the leading space. */
  const shown = (text: string): string => caseForPosition(pack, ctx, text);

  const ansNorms = ansWords.map((s) => normOf(pack, s));
  const actNorms = actWords.map((s) => normOf(pack, s));
  const sameWord = (a: string, b: string): boolean => a === b || fold(a) === fold(b);
  const isActual =
    actNorms.length > 0 && ansNorms.length === actNorms.length && ansNorms.every((n, i) => sameWord(n, actNorms[i] as string));

  const scoreText = async (text: string): Promise<number> => {
    const full = lead + caseForPosition(pack, ctx, text);
    o.onModelCall?.({ method: 'scoreContinuation', context: ctx });
    const toks = await model.scoreContinuation(ctx, full);
    let lp = 0;
    for (const t of toks) lp += clampLogprob(t.logprob, o.logprobFloor);
    if (o.includeBoundary) {
      const mass = await wordBoundaryMass(model, ctx + full, nw);
      lp += clampLogprob(Math.log(mass), o.logprobFloor);
    }
    return lp;
  };

  // Rank (and an exact probability) for a single-word answer from the alternatives. A
  // missing accent is restored from a matching alternative, else from the pack's own
  // spelling (accentedForm), which is then scored.
  let rankIdx = -1;
  let restored: string | undefined;
  if (ansNorms.length === 1) {
    const target = isActual ? (actNorms[0] as string) : (ansNorms[0] as string);
    rankIdx = alternatives.findIndex((a) => a.norm === target);
    if (rankIdx < 0 && !isActual && o.restoreAccents && !knownAsWritten(pack, target)) {
      rankIdx = alternatives.findIndex((a) => fold(a.norm) === fold(target));
      if (rankIdx < 0) restored = accentedForm(pack, target, fold);
    }
  }
  const rank = rankIdx >= 0 ? rankIdx + 1 : null;

  if (ansNorms.length === 1 && actNorms.length <= 1) {
    const alt = rankIdx >= 0 ? alternatives[rankIdx] : undefined;
    const text = isActual ? act : (restored ?? ans);
    scored = alt ? alt.word : shown(text);
    const logprob = alt ? alt.logprob : await scoreText(text);
    if (isActual) return result(logprob, rank, 'full', 'actual');
    const prob = Math.exp(logprob);
    const top = alternatives[0]?.prob ?? 0;
    if ((top > 0 && prob >= o.fullRatio * top) || prob >= o.fullFloor) return result(logprob, rank, 'full', 'likely');
    if (prob >= o.partialFloor) return result(logprob, rank, 'partial', 'plausible');
    const actNorm = actNorms[0];
    // After accent restoration the restored form is the one the learner meant.
    const ansNorm = alt ? alt.norm : (restored ?? (ansNorms[0] as string));
    if (actNorm !== undefined && sharesLemma(pack, ansNorm, actNorm)) {
      return result(logprob, rank, 'partial', 'form');
    }
    return result(logprob, rank, 'none', 'unlikely');
  }

  // Multi-word comparison by mean logprob per word.
  scored = shown(isActual ? act : ans);
  const ansLp = await scoreText(isActual ? act : ans);
  if (isActual) return result(ansLp, rank, 'full', 'actual');
  const ansMean = ansLp / ansWords.length;
  // An answer shorter than the cliff is compared with the same number of actual words
  // (the first words of a continuation are usually its most predictable ones, so a
  // per-word mean over all of them would favour stopping early), and it can earn at
  // most partial credit: it does not cover the cliff.
  const shorter = actWords.length > ansWords.length;
  const refWords = shorter ? ansWords.length : actWords.length;
  let actMean: number;
  if (actWords.length === 0) actMean = alternatives[0]?.logprob ?? o.logprobFloor;
  else if (shorter && ansNorms.every((n, i) => sameWord(n, actNorms[i] as string))) actMean = ansMean;
  else {
    const ref = shorter ? act.slice(0, (actWords[refWords - 1] as Segment).end) : act;
    actMean = (await scoreText(ref)) / refWords;
  }
  const diff = ansMean - actMean;
  if (diff >= -o.multiFullMargin) return result(ansLp, rank, shorter ? 'partial' : 'full', shorter ? 'plausible' : 'likely');
  if (diff >= -o.multiPartialMargin) return result(ansLp, rank, 'partial', 'plausible');
  const formMatch =
    ansNorms.length <= actNorms.length &&
    ansNorms.every((n, i) => {
      const a = actNorms[i] as string;
      return sameWord(n, a) || sharesLemma(pack, n, a);
    });
  if (formMatch) return result(ansLp, rank, 'partial', 'form');
  return result(ansLp, rank, 'none', 'unlikely');
}
