/**
 * The only way the engine talks to a language model.
 *
 * Adapters (llama.rn on device, llama.cpp in tests, the mock below) implement this.
 * All log-probabilities are natural logs.
 *
 * Spacing convention: a token that begins a new word carries its leading space.
 * Example: context "Marta llegó tarde al", text " mercado". Token texts are exact
 * substrings of the scored text and concatenate back to it.
 */
export interface TokenScore {
  /** Exact substring of the scored text covered by this token. */
  text: string;
  /** Character offset of the token in the scored text (inclusive). */
  start: number;
  /** Character offset of the token in the scored text (exclusive). */
  end: number;
  /** log P(token | context + previous tokens of the text). */
  logprob: number;
}

export interface TokenCandidate {
  text: string;
  logprob: number;
}

export interface GenerateOptions {
  /** Number of independent completions to return. */
  n: number;
  maxTokens: number;
  temperature: number;
  /** Generation stops before any of these strings. */
  stop?: string[];
  /** Base seed; completion i uses seed + i, so results are reproducible. */
  seed?: number;
}

export interface LanguageModel {
  readonly id: string;
  /**
   * Score `text` as a continuation of `context`, token by token.
   * The returned tokens concatenate exactly to `text`.
   */
  scoreContinuation(context: string, text: string): Promise<TokenScore[]>;
  /** The k most likely next tokens after `context`, most likely first. */
  nextTokens(context: string, k: number): Promise<TokenCandidate[]>;
  /** Sample completions of `prompt`. Returned strings exclude the prompt and the stop string. */
  generate(prompt: string, opts: GenerateOptions): Promise<string[]>;
}

/** Sum of token log-probabilities. */
export function totalLogprob(tokens: readonly TokenScore[]): number {
  let s = 0;
  for (const t of tokens) s += t.logprob;
  return s;
}
