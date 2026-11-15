/**
 * Scoring through llama.rn's completion API, for a llama.rn without the Cliffword patch (or a
 * binary built before it): the fallback of LlamaModelAdapter (see ./README.md).
 *
 * llama.rn reports, for each token it generates, the top N candidates of a softmax over the raw
 * logits (`n_probs`, `post_sampling_probs: false`). Forced decoding extends the prompt one token
 * of the text at a time and reads that list before each token:
 * - a token inside the top N gets its exact logprob;
 * - a token outside gets the smallest reported logprob and `upperBound: true` (the true value
 *   is lower), the rule of the engine's TopNBoundedModel;
 * - a token that starts inside a character (the second byte token of a split character) cannot
 *   be reached by a string prompt; its group keeps the first token's value as an upper bound.
 * Each step is one completion of one token (`n_predict: 1`, greedy, `ignore_eos` so the step is
 * always recorded); llama.rn reuses the KV cache of the shared prompt prefix, so a step
 * evaluates about one new token. Numbers can differ slightly from the native scorer: every
 * token is evaluated as a one-token batch, and the prompt string is tokenized as a whole.
 */
import type { TokenCandidate, TokenScore } from '@cliffword/engine';
import { isWholePiece } from './byteTokens';
import type { LlamaCompletionParams, LlamaContextHandle, LlamaTokenProb } from './llamaRuntime';

/** One-step completion that only reads the next-token list. */
function stepParams(prompt: string, nProbs: number): LlamaCompletionParams {
  return {
    prompt,
    n_predict: 1,
    n_probs: nProbs,
    post_sampling_probs: false,
    temperature: 0,
    ignore_eos: true,
  };
}

async function topCandidates(ctx: LlamaContextHandle, prompt: string, nProbs: number): Promise<LlamaTokenProb[]> {
  const res = await ctx.completion(stepParams(prompt, nProbs));
  const probs = res.completion_probabilities?.[0]?.probs ?? [];
  // llama.rn lists them most likely first; sort anyway (stable) so the last one is the smallest.
  return [...probs].sort((a, b) => b.prob - a.prob);
}

/** A token group: tokens [first, last] of the text cover characters [start, end). */
interface Group {
  first: number;
  last: number;
  start: number;
  end: number;
}

/**
 * Splits `text` into groups of its tokens that end on character boundaries, using llama.rn's
 * detokenize (a piece that ends inside a character decodes with U+FFFD and fails the prefix
 * test, so it joins the next).
 */
async function tokenGroups(ctx: LlamaContextHandle, text: string, ids: readonly number[], cancelled: () => boolean): Promise<Group[]> {
  const groups: Group[] = [];
  let first = 0;
  let start = 0;
  for (let i = 0; i < ids.length; i++) {
    if (cancelled()) throw new ForcedDecodingCancelled();
    const piece = await ctx.detokenize(ids.slice(first, i + 1));
    if (piece !== '' && !piece.includes('�') && text.startsWith(piece, start)) {
      groups.push({ first, last: i, start, end: start + piece.length });
      first = i + 1;
      start += piece.length;
    }
  }
  if (first !== ids.length || start !== text.length) {
    throw new Error(`forced decoding: the tokens of ${JSON.stringify(text)} do not spell it`);
  }
  return groups;
}

/** Thrown between steps when the adapter was unloaded meanwhile. */
export class ForcedDecodingCancelled extends Error {
  constructor() {
    super('forced decoding cancelled');
    this.name = 'ForcedDecodingCancelled';
  }
}

/**
 * Scores `text` after `startText + context` by forced decoding with top-`nProbs` lists.
 * `startText` renders the start token (e.g. "<|im_end|>" for Qwen3, parsed as a special token
 * by llama.rn's prompt tokenizer), or is "" when llama.rn adds a BOS itself.
 */
export async function scoreByForcedDecoding(
  ctx: LlamaContextHandle,
  startText: string,
  context: string,
  text: string,
  nProbs: number,
  cancelled: () => boolean = () => false,
): Promise<TokenScore[]> {
  if (text === '') return [];
  const { tokens: ids } = await ctx.tokenize(text);
  if (ids.length === 0) throw new Error(`forced decoding: ${JSON.stringify(text)} has no tokens`);
  const groups = await tokenGroups(ctx, text, ids, cancelled);
  const out: TokenScore[] = [];
  for (const g of groups) {
    if (cancelled()) throw new ForcedDecodingCancelled();
    const list = await topCandidates(ctx, startText + context + text.slice(0, g.start), nProbs);
    const id = ids[g.first] as number;
    const hit = list.find((c) => c.tok_id === id);
    const smallest = list[list.length - 1];
    let logprob: number;
    let upperBound = false;
    if (hit) {
      logprob = Math.log(hit.prob);
    } else {
      // Outside the list: no more likely than its last entry (no list at all: log 1 = 0).
      logprob = smallest ? Math.log(smallest.prob) : 0;
      upperBound = true;
    }
    // The other tokens of a split character can only lower the value.
    if (g.last > g.first) upperBound = true;
    const score: TokenScore = { text: text.slice(g.start, g.end), start: g.start, end: g.end, logprob: Math.min(0, logprob) };
    if (upperBound) score.upperBound = true;
    out.push(score);
  }
  return out;
}

/** llama.rn renders control tokens in the candidate list (e.g. "<|im_end|>"); they are not text. */
function isControlPiece(piece: string): boolean {
  return /^<\|[^\s|]*\|>$/.test(piece) || piece === '<UNKNOWN>';
}

/**
 * The k most likely next tokens after `startText + context`, from one one-token completion
 * with a top list a little longer than k (pieces that are part of a character or control
 * tokens are skipped and do not count, as in model_server.py).
 */
export async function nextTokensByCompletion(
  ctx: LlamaContextHandle,
  startText: string,
  context: string,
  k: number,
): Promise<TokenCandidate[]> {
  if (k <= 0) return [];
  const list = await topCandidates(ctx, startText + context, k + 16);
  const out: TokenCandidate[] = [];
  for (const c of list) {
    if (out.length >= k) break;
    if (!isWholePiece(c.tok_str) || isControlPiece(c.tok_str)) continue;
    out.push({ text: c.tok_str, logprob: Math.min(0, Math.log(c.prob)) });
  }
  return out;
}
