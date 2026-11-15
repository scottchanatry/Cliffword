/**
 * A LanguageModel wrapper that reports token log-probabilities the way llama.rn can
 * on device: only within the top N.
 *
 * This is how the device adapter behaves without a native scoring method (docs/BRIEF.md,
 * "Not done yet"). llama.rn has no call that returns the log-probabilities of a supplied
 * text; it returns the top-N token probabilities (`n_probs`, raw softmax with
 * `post_sampling_probs: false`) for each token it decodes. Scoring by forced decoding
 * feeds the text's tokens one by one and reads that list at each step. A token inside
 * the list has its exact log-probability. A token outside it has only an upper bound:
 * it is no more likely than the N-th candidate.
 *
 * So for each token of `text`, the wrapper asks the inner model for its N most likely
 * next tokens after context + the text before the token. If the token is among them
 * (same text, or at least as likely as the N-th candidate), its exact logprob is kept.
 * Otherwise it gets the N-th candidate's logprob and `upperBound: true`. A sum over
 * bounded tokens is an upper bound on the true total: a surprising word looks less
 * surprising than it is, and a rule variant that contains it looks more likely.
 *
 * Use it to measure what forced decoding would cost the engine (accuracy, flagged
 * margins) before deciding between it and a native scoring method. nextTokens and
 * generate pass through: llama.rn returns any N for tokens it generates.
 *
 * Cost: one inner scoreContinuation plus one inner nextTokens per token. A real runtime
 * gets the lists from the same forced-decoding pass, so this is a simulation cost only.
 */
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from './types';

export interface TopNOptions {
  /**
   * Size of the top-N list per decoding step. 10: the usual n_probs setting in llama.cpp
   * front ends, and the size the proof test listed next words at. A smaller N makes
   * more tokens bounded; measure a larger one before settling on it.
   */
  n: number;
  /**
   * Slack, in nats, when comparing a token with the N-th candidate. 1e-6: the inner model
   * gives the same number through both calls up to float rounding (the mock exactly,
   * proof/model_server.py bit-identically whatever its cache holds), so only a tie with
   * the N-th candidate needs it.
   */
  epsilon: number;
}

export const DEFAULT_TOP_N_OPTIONS: Readonly<TopNOptions> = {
  n: 10,
  epsilon: 1e-6,
};

export class TopNBoundedModel implements LanguageModel {
  readonly id: string;
  readonly inner: LanguageModel;
  readonly options: Readonly<TopNOptions>;

  constructor(inner: LanguageModel, opts: Partial<TopNOptions> = {}) {
    this.inner = inner;
    this.options = { ...DEFAULT_TOP_N_OPTIONS, ...opts };
    if (!Number.isInteger(this.options.n) || this.options.n < 1) {
      throw new Error(`TopNBoundedModel: n must be a positive integer, got ${this.options.n}`);
    }
    this.id = `${inner.id}+top${this.options.n}`;
  }

  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    const exact = await this.inner.scoreContinuation(context, text);
    const { n, epsilon } = this.options;
    const out: TokenScore[] = [];
    for (const t of exact) {
      const list = await this.inner.nextTokens(context + text.slice(0, t.start), n);
      const nth = list[list.length - 1];
      // A list shorter than N holds everything the model can produce next, so the
      // runtime would have listed the token too: keep it exact.
      const inTop =
        list.length < n ||
        nth === undefined ||
        list.some((c) => c.text === t.text) ||
        t.logprob >= nth.logprob - epsilon;
      // An exact token is passed on as the inner model scored it (a bound stays a bound).
      out.push(inTop || nth === undefined ? t : { ...t, logprob: Math.max(nth.logprob, t.logprob), upperBound: true });
    }
    return out;
  }

  nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    return this.inner.nextTokens(context, k);
  }

  generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    return this.inner.generate(prompt, opts);
  }
}

/** Number of tokens whose logprob is only an upper bound. */
export function boundedCount(tokens: readonly TokenScore[]): number {
  let c = 0;
  for (const t of tokens) if (t.upperBound) c++;
  return c;
}
