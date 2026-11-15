/**
 * Confidence-gated corrections: score rule-made variants of a learner sentence against
 * the sentence itself, and let the winning rule supply the explanation.
 *
 * The model only scores. A variant that is clearly more probable than what the learner
 * said is asserted as a fix; one that is somewhat more probable is shown as a light
 * hint; otherwise the sentence is left alone.
 *
 * Bounded scores. A runtime that reports only top-N token lists (llama.rn by forced
 * decoding; model/topN.ts simulates it) gives a token outside the list only an upper
 * bound (TokenScore.upperBound). A margin summed over such a token is not a measurement:
 * the surprising word of an incorrect variant looks more likely than it is, which is
 * exactly how false asserts arise. Real model through top-10 lists
 * (proof/ENGINE_REAL_MODEL.md, 93 proof pairs): without this rule judgeSentence asserted
 * 4 of the 93 correct sentences (exact scores: 1, from a rule-made variant) and 4 of its
 * 39 asserts on incorrect ones had the wrong fix; with it, no false assert. So an assert
 * needs exact tokens in both compared regions; otherwise the verdict is at most a hint
 * and the Judgement says bounded: true. Hints on bounds stay unreliable (18 false hints
 * in 93 correct sentences at top-10, 2 with exact scores), so an app on such a runtime
 * should show a bounded hint lightly or not at all. See decideVerdict.
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { LanguageModel, TokenScore } from '../model/types';
import { clampLogprob } from '../scoring/text';
import { DEFAULT_VARIANT_OPTIONS, generateVariantSet } from './variants';
import type { Variant, VariantOptions } from './variants';

/** ok: leave it; hint: shade lightly and show what was expected; assert: show the fix. */
export type Verdict = 'ok' | 'hint' | 'assert';

export interface JudgeOptions extends VariantOptions {
  /** Assert a fix when the best adjusted margin (nats) is at least this. */
  assertMargin: number;
  /** Show a hint when the best adjusted margin (nats) is at least this. */
  hintMargin: number;
  /**
   * An assert becomes a hint when the runner-up comes from a different explanation
   * (explainKey) and its margin is within this many nats of the best: the model prefers
   * a change but cannot say which rule explains it.
   */
  tieMargin: number;
  /**
   * Length adjustment for insert and delete variants, in nats per token. Every token
   * costs probability, so an insert is penalised and a delete rewarded just for the
   * length change. The adjusted margin is rawMargin + lengthAdjustPerToken * tokenDelta,
   * where tokenDelta = (variant tokens) - (original tokens) in the scored rest. Swaps and
   * inflections are not adjusted.
   */
  lengthAdjustPerToken: number;
  /**
   * Inserted between a non-empty context and the sentence when neither already has
   * whitespace at the join. ' ' for languages written with spaces; '' otherwise.
   */
  contextSeparator: string;
  /**
   * Token log-probabilities are clamped to this before summing (a model may return
   * -Infinity), so one impossible token shared by both rests cannot turn every margin
   * into NaN and hide an error elsewhere in the sentence. See DEFAULT_HEAT_OPTIONS.
   */
  logprobFloor: number;
}

/**
 * Defaults. Margins from the proof test (proof/RESULTS.md, 93 minimal pairs over 9 rules,
 * Qwen3-1.7B, scored after the neutral prefix; see scoring/context.ts):
 * - margin >= 3 nats: 80% of errors caught with no false flags, so assert;
 * - 1 to 3 nats: a soft hint brings the catch to 95% with one false flag;
 * - below 1 nat: treat as acceptable.
 * The weakest rules were ser/estar, por/para and the personal a (90 to 92%).
 */
export const DEFAULT_JUDGE_OPTIONS: Readonly<JudgeOptions> = {
  ...DEFAULT_VARIANT_OPTIONS,
  assertMargin: 3,
  hintMargin: 1,
  /** Judgement call, not measured: rules within 1 nat of each other cannot be told apart. */
  tieMargin: 1,
  /**
   * 0 from the proof test: on Qwen3-1.7B a length bias for inserts and deletes (personal
   * a, articles) caught no more errors at any setting from 0.5 to 1.5 nats per token.
   * (On Qwen3-4B, 1 nat per token caught 2 more of 93 errors.)
   */
  lengthAdjustPerToken: 0,
  contextSeparator: ' ',
  logprobFloor: -100,
};

export interface ScoredVariant extends Variant {
  /**
   * True when a token of either compared region (the variant's rest or the original's
   * rest after the shared prefix) has only an upper-bound logprob, so `margin` is not a
   * measured difference. Such a variant is never asserted. Absent when both are exact.
   */
  bounded?: boolean;
  /** log P(variant sentence | context): original logprob + rawMargin. */
  logprob: number;
  /** Variant logprob minus original logprob, in nats, before length adjustment. */
  rawMargin: number;
  /** Variant tokens minus original tokens in the scored rest (after the shared prefix). */
  tokenDelta: number;
  /** rawMargin plus the length adjustment for inserts and deletes. Higher = variant preferred. */
  margin: number;
}

export interface Judgement {
  verdict: Verdict;
  /** log P(original sentence | context), natural log, tokens clamped to logprobFloor. */
  originalLogprob: number;
  /** Highest-margin variant, or null when no rule applies. */
  best: ScoredVariant | null;
  /** best.margin, or null when there is no variant. */
  margin: number | null;
  /** All scored variants, highest margin first (ties keep generation priority). */
  variants: ScoredVariant[];
  /** explainKey of the best variant when the verdict is hint or assert; null when ok. */
  explainKey: string | null;
  /** Word index (among word segments of the sentence) of the best edit when hint or assert; null when ok. */
  wordIndex: number | null;
  /** Variants generated but not scored because of maxVariants. */
  droppedVariants: number;
  /**
   * True when the best variant's margin rests on an upper-bound token logprob (see
   * ScoredVariant.bounded): the verdict is then at most 'hint', whatever the margin. An
   * 'ok' may also hide an error, because a bound in the learner's own sentence makes it
   * look more likely than it is. Absent when the deciding margin is exact.
   */
  bounded?: boolean;
}

/**
 * Where the shared prefix ends for an edit starting at `editStart`: the end of the last
 * word segment that ends at or before the edit, or 0 when no word precedes it.
 *
 * Cutting right after a word, before the whitespace, keeps the space with the next
 * token, which is how the model's tokens are spelled (a token that starts a word
 * carries its leading space). Cutting after the space instead would score the next
 * word without its space, a tokenization the full sentence never uses.
 */
export function sharedPrefixEnd(segments: readonly Segment[], editStart: number): number {
  let end = 0;
  for (const s of segments) {
    if (s.kind === 'word' && s.end <= editStart && s.end > end) end = s.end;
  }
  return end;
}

/** Margin with NaN (both sides -Infinity) treated as "no evidence for the variant". */
function finite(x: number): number {
  return Number.isNaN(x) ? -Infinity : x;
}

/**
 * Verdict from scored variants sorted by margin (highest first):
 * assert if the best margin >= assertMargin, hint if >= hintMargin, else ok. An assert
 * is downgraded to a hint when the runner-up has a different explainKey and its margin
 * is within tieMargin of the best (two explanations compete; neither is certain).
 * Variants sharing an explainKey (e.g. inserting "el" or "un") do not compete.
 *
 * A bounded best variant (its margin depends on an upper-bound token in either compared
 * region) is never asserted: its verdict is hint when the margin reaches hintMargin, else
 * ok. A bound on the variant side inflates the margin, which is how false asserts arise.
 * A bound on the original side alone would make the reported margin a lower bound, so in
 * theory an assert would still be safe; the engine does not rely on that, because the
 * bound is only valid when the adapter reads the raw softmax (llama.rn
 * post_sampling_probs: false). Probabilities taken after top-k, top-p or temperature are
 * renormalized over the kept tokens and bound nothing. So any bounded margin counts as
 * unmeasured. A bounded runner-up still counts in the tie rule at its reported margin,
 * which can only make the tie rule stricter.
 */
export function decideVerdict(
  sorted: readonly Pick<ScoredVariant, 'margin' | 'explainKey' | 'bounded'>[],
  opts: Pick<JudgeOptions, 'assertMargin' | 'hintMargin' | 'tieMargin'>,
): Verdict {
  const best = sorted[0];
  if (!best) return 'ok';
  let verdict: Verdict = best.margin >= opts.assertMargin ? 'assert' : best.margin >= opts.hintMargin ? 'hint' : 'ok';
  if (verdict === 'assert' && best.bounded) verdict = 'hint';
  if (verdict === 'assert') {
    const rival = sorted.find((v) => v.explainKey !== best.explainKey);
    if (rival && best.margin - rival.margin <= opts.tieMargin) verdict = 'hint';
  }
  return verdict;
}

/** Joining string between context and sentence (see JudgeOptions.contextSeparator). */
function contextJoin(context: string, text: string, separator: string): string {
  if (!context || /\s$/u.test(context) || /^\s/u.test(text)) return '';
  return separator;
}

interface RestScore {
  logprob: number;
  tokens: number;
  /** A token of the rest has only an upper-bound logprob. */
  bounded: boolean;
}

/** Sum of token log-probabilities, each clamped to `floor`. */
function clampedSum(tokens: readonly TokenScore[], floor: number): number {
  let s = 0;
  for (const t of tokens) s += clampLogprob(t.logprob, floor);
  return s;
}

/** True when any token's logprob is only an upper bound. */
function anyBounded(tokens: readonly TokenScore[]): boolean {
  return tokens.some((t) => t.upperBound === true);
}

/**
 * Sum the tokens (clamped to `floor`) of a full-sentence scoring that start at or after
 * `offset`, if a token boundary falls exactly at `offset`; otherwise undefined.
 */
function restFromFull(tokens: readonly TokenScore[], offset: number, floor: number): RestScore | undefined {
  if (offset === 0) return { logprob: clampedSum(tokens, floor), tokens: tokens.length, bounded: anyBounded(tokens) };
  const i = tokens.findIndex((t) => t.start === offset);
  if (i < 0) return undefined;
  const rest = tokens.slice(i);
  return { logprob: clampedSum(rest, floor), tokens: rest.length, bounded: anyBounded(rest) };
}

/**
 * Judge a learner sentence: generate rule-made variants, score each against the
 * original, and decide whether to assert a fix, show a hint, or leave it.
 *
 * Prefix sharing. A variant differs from the original only from its edit onward, so
 * both sentences share the prefix P = text before the edit (cut after the last word
 * before it; see sharedPrefixEnd). By the chain rule,
 *   log P(P + R | C) = log P(P | C) + log P(R | C + P)
 * for context C and rest R. The first term is identical for the original rest R_o and
 * the variant rest R_v, so
 *   log P(P + R_v | C) - log P(P + R_o | C) = log P(R_v | C + P) - log P(R_o | C + P),
 * i.e. scoreContinuation(C + P, R_v) minus scoreContinuation(C + P, R_o). Tokens of P
 * are never summed again, and an adapter with prefix caching evaluates C + P once for
 * both. This is exact when the tokenizer splits the full sentence at the cut, which
 * holds for tokenizers that attach the leading space to a word's first token; when it
 * does not, both rests are still scored under the same context, so the comparison
 * stays consistent.
 *
 * Calls: one scoreContinuation for the whole original (its logprob), one per variant
 * for the variant's rest. The original's rest at each cut is read off the full scoring
 * when a token boundary falls at the cut (by the same chain rule) and is otherwise
 * scored once per distinct cut and cached.
 *
 * Every token log-probability is clamped to opts.logprobFloor before summing.
 *
 * Margin = variant logprob - original logprob (nats), plus opts.lengthAdjustPerToken
 * times the token-count difference for inserts and deletes. Variants are sorted by
 * margin; the verdict follows decideVerdict.
 *
 * Bounded tokens: a variant is bounded when a token of its rest or of the original's
 * rest at the same cut has TokenScore.upperBound. Variants keep their reported margins
 * and order (best is still the highest reported margin), but a bounded best is at most a
 * hint, and the Judgement carries bounded: true. With exact scores nothing changes.
 */
export async function judgeSentence(
  model: LanguageModel,
  pack: LanguagePack,
  context: string,
  text: string,
  opts: Partial<JudgeOptions> = {},
): Promise<Judgement> {
  const o: JudgeOptions = { ...DEFAULT_JUDGE_OPTIONS, ...opts };
  const sep = contextJoin(context, text, o.contextSeparator);
  const fullTokens = text ? await model.scoreContinuation(context, sep + text) : [];
  const originalLogprob = clampedSum(fullTokens, o.logprobFloor);

  const set = generateVariantSet(pack, text, o);
  const segments = set.variants.length ? pack.segment(text) : [];
  const originalRest = new Map<number, RestScore>();

  const scored: ScoredVariant[] = [];
  for (const v of set.variants) {
    const cut = sharedPrefixEnd(segments, v.start);
    const prefixContext = cut === 0 ? context : context + sep + text.slice(0, cut);
    const restLead = cut === 0 ? sep : '';

    let orig = originalRest.get(cut);
    if (!orig) {
      orig = restFromFull(fullTokens, cut === 0 ? 0 : sep.length + cut, o.logprobFloor);
      if (!orig) {
        const toks = await model.scoreContinuation(prefixContext, restLead + text.slice(cut));
        orig = { logprob: clampedSum(toks, o.logprobFloor), tokens: toks.length, bounded: anyBounded(toks) };
      }
      originalRest.set(cut, orig);
    }

    const vt = await model.scoreContinuation(prefixContext, restLead + v.text.slice(cut));
    const variantRest = clampedSum(vt, o.logprobFloor);
    const rawMargin = finite(variantRest - orig.logprob);
    const tokenDelta = vt.length - orig.tokens;
    const lengthAdjust = v.kind === 'insert' || v.kind === 'delete' ? o.lengthAdjustPerToken * tokenDelta : 0;
    const sv: ScoredVariant = {
      ...v,
      logprob: originalLogprob + rawMargin,
      rawMargin,
      tokenDelta,
      margin: finite(rawMargin + lengthAdjust),
    };
    // Set only when true, so exact judgements keep their shape.
    if (orig.bounded || anyBounded(vt)) sv.bounded = true;
    scored.push(sv);
  }

  // Array.prototype.sort is stable, so equal margins keep generation priority.
  scored.sort((a, b) => (b.margin > a.margin ? 1 : b.margin < a.margin ? -1 : 0));
  const best = scored[0] ?? null;
  const verdict = decideVerdict(scored, o);
  const flagged = verdict !== 'ok' && best !== null;
  const judgement: Judgement = {
    verdict,
    originalLogprob,
    best,
    margin: best ? best.margin : null,
    variants: scored,
    explainKey: flagged ? best.explainKey : null,
    wordIndex: flagged ? best.wordIndex : null,
    droppedVariants: set.dropped,
  };
  if (best?.bounded) judgement.bounded = true;
  return judgement;
}
