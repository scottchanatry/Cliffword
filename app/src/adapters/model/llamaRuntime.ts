/**
 * The part of llama.rn that LlamaModelAdapter uses, as structural types.
 *
 * The adapter never imports llama.rn itself: createDeviceModel.ts (native only) passes the real
 * module, tests pass src/testing/fakeLlamaRn.ts. So the adapter, and everything that imports it,
 * stays free of the native package, and it works with llama.rn with or without the Cliffword
 * patch (app/patches/llama.rn+0.13.0-rc.11.patch): `scoreText`, `nextTokens` and
 * `isTextScoringAvailable` exist only in the patched package (see ./README.md).
 */

/** initLlama parameters the adapter sets (a subset of llama.rn's ContextParams). */
export interface LlamaInitParams {
  model: string;
  n_ctx?: number;
  n_batch?: number;
  n_ubatch?: number;
  n_parallel?: number;
  n_threads?: number;
  n_gpu_layers?: number;
  use_mlock?: boolean;
  use_mmap?: boolean;
  no_extra_bufts?: boolean;
  flash_attn_type?: string;
  ctx_shift?: boolean;
}

/** completion parameters the adapter sets (a subset of llama.rn's CompletionParams). */
export interface LlamaCompletionParams {
  prompt: string;
  n_predict?: number;
  n_probs?: number;
  post_sampling_probs?: boolean;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  typical_p?: number;
  penalty_repeat?: number;
  penalty_freq?: number;
  penalty_present?: number;
  dry_multiplier?: number;
  xtc_probability?: number;
  mirostat?: number;
  samplers?: string | string[];
  seed?: number;
  stop?: string[];
  ignore_eos?: boolean;
}

export interface LlamaTokenProb {
  tok_id: number;
  /** Display form of the piece: a lone byte reads "byte: \\xNN", control tokens render as text. */
  tok_str: string;
  prob: number;
}

export interface LlamaCompletionResult {
  text: string;
  interrupted?: boolean;
  completion_probabilities?: { content: string; probs: LlamaTokenProb[] }[];
}

/** One token of LlamaContext.scoreText (patched llama.rn). */
export interface LlamaScoredToken {
  id: number;
  /** Byte range of the token's piece in the UTF-8 of the scored text. */
  byte_start: number;
  byte_end: number;
  logprob: number;
}

export interface LlamaEvalStats {
  prefix_tokens: number;
  reused_tokens: number;
  evaluated_tokens: number;
}

export interface LlamaScoreTextResult extends LlamaEvalStats {
  tokens: LlamaScoredToken[];
}

export interface LlamaNextTokensResult extends LlamaEvalStats {
  tokens: { id: number; text: string; logprob: number }[];
}

/** A loaded llama.rn context (LlamaContext). */
export interface LlamaContextHandle {
  readonly id: number;
  /** Whether a GPU (Metal on iOS) runs the model. */
  readonly gpu?: boolean;
  /** Model details; `metadata` holds the GGUF key/values as strings. */
  readonly model?: unknown;
  completion(params: LlamaCompletionParams): Promise<LlamaCompletionResult>;
  stopCompletion(): Promise<void>;
  tokenize(text: string): Promise<{ tokens: number[] }>;
  detokenize(tokens: number[]): Promise<string>;
  release(): Promise<void>;
  /** Patched llama.rn only. */
  scoreText?(contextText: string, text: string): Promise<LlamaScoreTextResult>;
  /** Patched llama.rn only. */
  nextTokens?(contextText: string, k: number): Promise<LlamaNextTokensResult>;
}

/** The llama.rn module (or a fake of it). */
export interface LlamaRuntime {
  initLlama(params: LlamaInitParams, onProgress?: (progress: number) => void): Promise<LlamaContextHandle>;
  /** Patched llama.rn only: whether the native library has the scoring calls. */
  isTextScoringAvailable?: () => boolean;
}
