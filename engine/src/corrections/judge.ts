/**
 * Confidence-gated corrections: score rule-made variants of a learner sentence against
 * the sentence itself, and let the winning rule supply the explanation.
 *
 * The model only scores. A variant that is clearly more probable than what the learner
 * said is asserted as a fix; one that is somewhat more probable is shown as a light
 * hint; otherwise the sentence is left alone.
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

/** Defaults. The margins are placeholders until the proof test measures them. */
export const DEFAULT_JUDGE_OPTIONS: Readonly<JudgeOptions> = {
  ...DEFAULT_VARIANT_OPTIONS,
  /** set from proof/RESULTS.md (margin above which >= 95% of flagged pairs are true errors). */
  assertMargin: 3,
  /** set from proof/RESULTS.md */
  hintMargin: 1,
  /** set from proof/RESULTS.md */
  tieMargin: 1,
  /** set from proof/RESULTS.md (typical cost of a short function-word token). */
  lengthAdjustPerToken: 1,
  contextSeparator: ' ',
  logprobFloor: -100,
};

export interface ScoredVariant extends Variant {
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
 */
export function decideVerdict(
  sorted: readonly Pick<ScoredVariant, 'margin' | 'explainKey'>[],
  opts: Pick<JudgeOptions, 'assertMargin' | 'hintMargin' | 'tieMargin'>,
): Verdict {
  const best = sorted[0];
  if (!best) return 'ok';
  let verdict: Verdict = best.margin >= opts.assertMargin ? 'assert' : best.margin >= opts.hintMargin ? 'hint' : 'ok';
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
}

/** Sum of token log-probabilities, each clamped to `floor`. */
function clampedSum(tokens: readonly TokenScore[], floor: number): number {
  let s = 0;
  for (const t of tokens) s += clampLogprob(t.logprob, floor);
  return s;
}

/**
 * Sum the tokens (clamped to `floor`) of a full-sentence scoring that start at or after
 * `offset`, if a token boundary falls exactly at `offset`; otherwise undefined.
 */
function restFromFull(tokens: readonly TokenScore[], offset: number, floor: number): RestScore | undefined {
  if (offset === 0) return { logprob: clampedSum(tokens, floor), tokens: tokens.length };
  const i = tokens.findIndex((t) => t.start === offset);
  if (i < 0) return undefined;
  const rest = tokens.slice(i);
  return { logprob: clampedSum(rest, floor), tokens: rest.length };
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
        orig = { logprob: clampedSum(toks, o.logprobFloor), tokens: toks.length };
      }
      originalRest.set(cut, orig);
    }

    const vt = await model.scoreContinuation(prefixContext, restLead + v.text.slice(cut));
    const variantRest = clampedSum(vt, o.logprobFloor);
    const rawMargin = finite(variantRest - orig.logprob);
    const tokenDelta = vt.length - orig.tokens;
    const lengthAdjust = v.kind === 'insert' || v.kind === 'delete' ? o.lengthAdjustPerToken * tokenDelta : 0;
    scored.push({
      ...v,
      logprob: originalLogprob + rawMargin,
      rawMargin,
      tokenDelta,
      margin: finite(rawMargin + lengthAdjust),
    });
  }

  // Array.prototype.sort is stable, so equal margins keep generation priority.
  scored.sort((a, b) => (b.margin > a.margin ? 1 : b.margin < a.margin ? -1 : 0));
  const best = scored[0] ?? null;
  const verdict = decideVerdict(scored, o);
  const flagged = verdict !== 'ok' && best !== null;
  return {
    verdict,
    originalLogprob,
    best,
    margin: best ? best.margin : null,
    variants: scored,
    explainKey: flagged ? best.explainKey : null,
    wordIndex: flagged ? best.wordIndex : null,
    droppedVariants: set.dropped,
  };
}
