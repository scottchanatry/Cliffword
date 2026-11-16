/**
 * Cliff scoring: how well each word of a story sentence works as a cliff (the point where
 * the story stops and the learner says what comes next), and how much credit a learner's
 * answer earns. The model only scores; credit comes from probability, so every natural
 * answer earns credit, not just the story's word.
 */
import type { Analysis, LanguagePack, Segment } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { CliffPosition, CliffResult, Credit, CreditReason, NextWord } from './types';
import {
  DEFAULT_NEXT_WORD_OPTIONS,
  nextWordsDetailed,
  wordBoundaryMass,
  type ModelCallListener,
  type NextWordOptions,
} from './nextWord';
import { alignTokensToWords, boundedWords } from './wordScores';
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
  // Checked against the proof test's next-word lists: 2% keeps the model's real
  // candidates (the tenth word of a standard opening has about 1%).
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
  /**
   * Lemma credit: a single-word answer that is the same inflection of the same lexeme as
   * an alternative (same lemma, part of speech and features in pack.analyze: the two
   * differ only in attached pronouns or spelling, as reír and reírse do) is credited as if
   * its probability were lemmaWeight x P(that alternative), when that earns more than its
   * own probability. 0 turns it off. See DEFAULT_CREDIT_OPTIONS for the measurement.
   */
  lemmaWeight: number;
  /**
   * Lemma credit applies only when the answer's own probability is at least this: the
   * model must find the form possible here, so a verb that needs its pronoun ("fue a su
   * cuarto a acostar" for acostarse) is not credited through the pronominal form.
   */
  lemmaFloor: number;
  /** Options for the next-word search (k and normalize are set by this module). */
  nextWord: Partial<NextWordOptions>;
  /** Called once per model call, before it is issued. */
  onModelCall?: ModelCallListener;
  /**
   * Precomputed next words at this cliff: what the next-word search after the trimmed
   * context would return with this function's k and nextWord options, such as
   * CliffPosition.alternatives from cliffPositions on the same context and sentence (see
   * alternativesReusable) or a session's cliff state. When given, no next-word search is
   * made, so an answer costs at most two model calls (a scoring call and a boundary call
   * when the answer is not among them; four for a multi-word answer), and the result is
   * the same as without it whenever the list is the same. Used as given, cut to k.
   */
  alternatives?: readonly NextWord[];
  /**
   * Precomputed log P(actual words) at this cliff, as this function scores a text (its
   * tokens plus the boundary mass when includeBoundary), such as CliffPosition.actualLogprob
   * for a single-word cliff. When given, the actual words are not scored again: an answer
   * that is the actual words reports it, and a multi-word answer is compared with it.
   */
  actualLogprob?: number;
}

export const DEFAULT_CREDIT_OPTIONS: Readonly<CreditOptions> = {
  // Credit floors. fullRatio and fullFloor are consistent with the proof test's next-word
  // lists (Qwen3-1.7B: the top word of a standard opening has 0.08 to 0.65, natural
  // runners-up 0.02 to 0.2); calibrate them from learner logs. Cliffs on slang or lyric
  // lines need answers from the pack or the lyrics: the model's lists there are useless
  // (top-10 mass 0.12).
  fullRatio: 0.25,
  fullFloor: 0.05,
  // Measured on the real model (proof/ENGINE_REAL_MODEL.md, Qwen3-1.7B, 6 story cliffs,
  // 40 natural and 23 wrong answers scored with scoreCliffAnswer): natural answers range
  // down to 2.2e-4 ("hacia la cocina"; reír 5.6e-4, nadar 7.2e-4 after "vamos a"), while
  // wrong answers stay at or below 1.0e-5 ("hacia la verde", itself grammatical as "the
  // green one"), and word-class errors at or below 2.3e-6. The former floor 0.005 gave 12
  // of the 40 natural answers no credit; every floor from 2e-4 down to 2e-5 credits all
  // 40 and none of the 23 wrong ones. 1e-4 keeps a factor of 2 below the least likely
  // natural answer and 10 above the most likely wrong one. session/cliff.ts uses this
  // value as its distractor floor, which the lower value makes safer: at 0.005 a
  // natural word such as "bailar" (3.2e-3) could have been offered as a wrong option.
  partialFloor: 1e-4,
  multiFullMargin: 1.0,
  multiPartialMargin: 2.5,
  k: 10,
  includeBoundary: true,
  restoreAccents: true,
  accentMarks: DEFAULT_ACCENT_MARKS,
  logprobFloor: -100,
  // Lemma credit, measured on the real model (proof/ENGINE_REAL_MODEL.md, "Answer speed,
  // lemma credit and session robustness"; proof/engine-measure/credit-lemma.ts): the
  // analysis cannot tell a verb whose pronoun is optional from one that needs it. "reír"
  // after "la niña empezó a" (the model expects reírse 0.13) and "levantar" after "Juan no
  // quería" (levantarse 0.15; wrong without se) are the same case to it, and their own
  // probabilities are alike (0.02 and 7e-4). Any weight that lifts reír to full credit
  // (0.38 and up) lifts levantar too (0.34 and up); the analysis has no enclitics either,
  // so a wrong pronoun (verse for vernos) would match ver like vernos does. So the weight
  // stays below what can reach full credit: 0.02 x P < fullFloor, and 0.02 < fullRatio.
  // It lifts an answer to partial when the alternative has P >= partialFloor / 0.02 =
  // 0.005. At partialFloor 1e-4 it changes no credit of the 111 measured answers (all
  // natural answers with a listed form of their lexeme already have credit); at 5e-4 it
  // keeps reír credited, at 2e-3 it would also credit levantar. lemmaFloor 2e-5: the
  // most likely wrong answer of section 4 has 1.0e-5, and pronoun-less forms the model
  // rejects sit far lower (sentar 3e-7, divertir 5e-7).
  lemmaWeight: 0.02,
  lemmaFloor: 2e-5,
  nextWord: {},
};

/**
 * True when the alternatives cliffPositions finds with `cliff` options can stand in for
 * the next-word search scoreCliffAnswer makes with `credit` options at the same context
 * (the same k and next-word options), so they may be passed as CreditOptions.alternatives.
 */
export function alternativesReusable(cliff: Partial<CliffOptions> = {}, credit: Partial<CreditOptions> = {}): boolean {
  const c = { ...DEFAULT_CLIFF_OPTIONS, ...cliff };
  const r = { ...DEFAULT_CREDIT_OPTIONS, ...credit };
  if (c.k !== r.k) return false;
  const a = { ...DEFAULT_NEXT_WORD_OPTIONS, ...c.nextWord };
  const b = { ...DEFAULT_NEXT_WORD_OPTIONS, ...r.nextWord };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof NextWordOptions>;
  for (const k of keys) {
    // k, normalize and onModelCall are set by the scoring functions themselves.
    if (k === 'k' || k === 'normalize' || k === 'onModelCall') continue;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

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
 * in a word. Positions come back sorted by word index. A position whose actual word has
 * a token with only an upper-bound logprob (TokenScore.upperBound) gets bounded: true.
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
  const bounds = tokens.some((t) => t.upperBound) ? boundedWords(tokens, segments) : undefined;
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
    const pos: CliffPosition = { wordIndex, segment, actualLogprob, alternatives, plausibleCount };
    if (bounds?.[wordIndex]) pos.bounded = true;
    out.push(pos);
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

function sameFeatures(a: Analysis['features'], b: Analysis['features']): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (x !== y && !(x === undefined && y === undefined)) return false;
  }
  return true;
}

/**
 * True when `a` and `b` (normalized words) are the same inflection of the same lexeme by
 * pack.analyze: an analysis of each with the same lemma, part of speech and features.
 * They then differ only in what the analyzer looks through (attached pronouns, spelling),
 * as reír and reírse do; lee and leer (another inflection) do not match.
 */
export function sameLexemeForm(pack: LanguagePack, a: string, b: string): boolean {
  if (a === b) return true;
  const xs = pack.analyze(a);
  if (xs.length === 0) return false;
  const ys = pack.analyze(b);
  return xs.some((x) => ys.some((y) => x.lemma === y.lemma && x.pos === y.pos && sameFeatures(x.features, y.features)));
}

/**
 * Credit for a learner's answer at a cliff.
 *
 * Preparation: whitespace and trailing punctuation are removed from the answer and from
 * `actual` (via pack.segment); the context loses trailing whitespace, and the answer is
 * scored with a leading space when the context ends in a word or other non-opening
 * character (needsLeadingSpace). Case is adjusted for the position (caseForPosition).
 * Alternatives are computed with nextWords at the cliff, or taken from
 * opts.alternatives when the caller already has them (cliffPositions found them for the
 * same cliff), and returned.
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
 * - lemma credit: when the answer is the same inflection of the same lexeme as an
 *   alternative (sameLexemeForm: reír for reírse) and P >= lemmaFloor, the two rules
 *   above are applied to lemmaWeight x P(alternative) as well, and the better credit wins
 *   (reason 'likely' or 'plausible', lemmaMatch names the alternative);
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
 * Bounded probabilities. A runtime that reports only top-N token lists (llama.rn by
 * forced decoding; model/topN.ts) gives a token outside its list only an upper bound
 * (TokenScore.upperBound). Credit never rises because of such a bound: when the scored
 * answer has a bounded token, P(answer) is at most the reported value, which can show an
 * answer is unlikely but never that it is likely, so the 'likely' and 'plausible' rules
 * are skipped and the answer gets 'form' (shares a lemma with the actual word) or 'none',
 * exactly what it would get with an exact probability below every floor. The result
 * carries bounded: true so the app can treat it as unscored rather than wrong. This only
 * touches answers outside the alternatives: those come from nextTokens lists, which a
 * top-N runtime reports exactly, so every natural answer the model ranks keeps its
 * credit. In the multi-word comparison only a bound on the answer side counts: a bound
 * on the actual continuation raises the reference and can only lower the credit. Lemma
 * credit needs P(answer) >= lemmaFloor, which a bound cannot show, so a bounded answer
 * never gets it.
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

  const alternatives: NextWord[] =
    o.alternatives !== undefined
      ? o.k < 1
        ? []
        : o.alternatives.slice(0, o.k).map((a) => ({ ...a }))
      : (await nextWordsDetailed(model, ctx, nw)).words;
  /** The caller's log P(actual words), when it has one. */
  const knownActual = o.actualLogprob !== undefined && Number.isFinite(o.actualLogprob) ? clampLogprob(o.actualLogprob, o.logprobFloor) : undefined;
  let scored = '';
  /** The alternative whose lexeme credited the answer (lemma credit). */
  let lemmaVia: NextWord | undefined;
  /** The answer's probability came from a scoring with an upper-bound token. */
  let bounded = false;
  const result = (logprob: number, rank: number | null, credit: Credit, reason: CreditReason): CliffResult => {
    const r: CliffResult = {
      answer,
      scored,
      logprob,
      prob: Math.exp(logprob),
      rank,
      credit,
      reason,
      alternatives,
    };
    // Set only when true, so exact results keep their shape.
    if (bounded) r.bounded = true;
    if (lemmaVia) r.lemmaMatch = { word: lemmaVia.word, prob: lemmaVia.prob };
    return r;
  };

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

  /** log P(text) at the cliff, with boundary mass; bounded when a token is only an upper bound. */
  const scoreText = async (text: string): Promise<{ logprob: number; bounded: boolean }> => {
    const full = lead + caseForPosition(pack, ctx, text);
    o.onModelCall?.({ method: 'scoreContinuation', context: ctx });
    const toks = await model.scoreContinuation(ctx, full);
    let lp = 0;
    for (const t of toks) lp += clampLogprob(t.logprob, o.logprobFloor);
    if (o.includeBoundary) {
      const mass = await wordBoundaryMass(model, ctx + full, nw);
      lp += clampLogprob(Math.log(mass), o.logprobFloor);
    }
    return { logprob: lp, bounded: toks.some((t) => t.upperBound === true) };
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
    let logprob: number;
    if (alt) logprob = alt.logprob;
    else if (isActual && knownActual !== undefined) logprob = knownActual;
    else ({ logprob, bounded } = await scoreText(text));
    if (isActual) return result(logprob, rank, 'full', 'actual');
    const prob = Math.exp(logprob);
    const top = alternatives[0]?.prob ?? 0;
    /** 2: likely (full), 1: plausible (partial), 0: neither. */
    const levelOf = (p: number): number => ((top > 0 && p >= o.fullRatio * top) || p >= o.fullFloor ? 2 : p >= o.partialFloor ? 1 : 0);
    // A bounded probability is only an upper bound: it never earns likely or plausible.
    let level = bounded ? 0 : levelOf(prob);
    // After accent restoration the restored form is the one the learner meant.
    const ansNorm = alt ? alt.norm : (restored ?? (ansNorms[0] as string));
    if (level < 2 && !bounded && o.lemmaWeight > 0 && prob >= o.lemmaFloor) {
      // The most likely alternative of the same lexeme and inflection gives the most credit.
      const via = alternatives.find((a) => a.norm !== ansNorm && sameLexemeForm(pack, ansNorm, a.norm));
      if (via && levelOf(o.lemmaWeight * via.prob) > level) {
        level = levelOf(o.lemmaWeight * via.prob);
        lemmaVia = via;
      }
    }
    if (level === 2) return result(logprob, rank, 'full', 'likely');
    if (level === 1) return result(logprob, rank, 'partial', 'plausible');
    const actNorm = actNorms[0];
    if (actNorm !== undefined && sharesLemma(pack, ansNorm, actNorm)) {
      return result(logprob, rank, 'partial', 'form');
    }
    return result(logprob, rank, 'none', 'unlikely');
  }

  // Multi-word comparison by mean logprob per word.
  scored = shown(isActual ? act : ans);
  if (isActual && knownActual !== undefined) return result(knownActual, rank, 'full', 'actual');
  const ansScore = await scoreText(isActual ? act : ans);
  const ansLp = ansScore.logprob;
  bounded = ansScore.bounded;
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
  else if (!shorter && knownActual !== undefined) actMean = knownActual / refWords;
  else {
    const ref = shorter ? act.slice(0, (actWords[refWords - 1] as Segment).end) : act;
    // A bound here raises the reference, which can only lower the answer's credit.
    actMean = (await scoreText(ref)).logprob / refWords;
  }
  const diff = ansMean - actMean;
  // A bounded answer score is an upper bound, so diff is too: it never earns credit.
  if (!bounded) {
    if (diff >= -o.multiFullMargin) return result(ansLp, rank, shorter ? 'partial' : 'full', shorter ? 'plausible' : 'likely');
    if (diff >= -o.multiPartialMargin) return result(ansLp, rank, 'partial', 'plausible');
  }
  const formMatch =
    ansNorms.length <= actNorms.length &&
    ansNorms.every((n, i) => {
      const a = actNorms[i] as string;
      return sameWord(n, a) || sharesLemma(pack, n, a);
    });
  if (formMatch) return result(ansLp, rank, 'partial', 'form');
  return result(ansLp, rank, 'none', 'unlikely');
}
