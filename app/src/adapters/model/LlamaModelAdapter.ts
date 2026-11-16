/**
 * ModelAdapter over llama.rn: Qwen3-1.7B Q4_K_M on the device (see ./README.md).
 *
 * - load(path): initLlama with phone settings (2048-token window, batches of 512, one
 *   sequence, Metal for every layer on iOS, CPU on Android, no mlock, flash attention off so
 *   scores match the proof's llama.cpp setup). unload() releases the context.
 * - scoreContinuation / nextTokens: the native method of the llama.rn patch
 *   (LlamaContext.scoreText / nextTokens) when the installed llama.rn has it, else forced
 *   decoding through the completion API (./forcedDecoding.ts; tokens outside the top N are
 *   upper bounds). `info.scoring` says which. Native byte ranges become UTF-16 offsets with
 *   split characters merged (./byteTokens.ts), the rule of proof/model_server.py.
 * - generate: plain continuation of start token + prompt (no chat template, like the engine's
 *   mock and model_server.py), llama.cpp's default sampler chain written out (top-k 40,
 *   top-p 0.95, min-p 0.05, then temperature), completion i seeded with seed + i, run one after
 *   another. The texts exclude the prompt (llama.rn returns only generated text) and are cut
 *   before the first stop string; Qwen3 <think> blocks are stripped defensively.
 *
 * Calls run one at a time, in order (a promise queue), so they never meet llama.rn's
 * "Context is busy". They reject with ModelNotReadyError unless the status is 'ready'. unload()
 * (or a new load()) cancels: queued calls reject at once, a running completion is stopped, a
 * running call's result is dropped (it rejects with ModelNotReadyError), and the context is
 * released after it settles. Only one llama.rn context exists at a time: a load waits for an
 * older load's initLlama (and the release of what it made) before it starts its own. While the
 * app is in the background (setInBackground, wired to AppState on iOS) calls that have not
 * started wait, since iOS refuses GPU work from background apps.
 */
import type { GenerateOptions, TokenCandidate, TokenScore } from '@cliffword/engine';
import { Listeners, type Unsubscribe } from '../listeners';
import { checkScores, isWholePiece, tokenScoresFromBytes } from './byteTokens';
import { DEFAULT_MODEL } from './descriptor';
import { ForcedDecodingCancelled, nextTokensByCompletion, scoreByForcedDecoding } from './forcedDecoding';
import type { LlamaCompletionParams, LlamaContextHandle, LlamaInitParams, LlamaRuntime } from './llamaRuntime';
import {
  ModelNotReadyError,
  type ModelAdapter,
  type ModelInfo,
  type ModelLoadOptions,
  type ModelScoringPath,
  type ModelStatus,
} from './types';

/** Context window for Qwen3-1.7B on a phone: room for a story passage plus a sentence. */
export const LLAMA_CONTEXT_SIZE = 2048;
/** Prompt batch: a whole scoring request (context + text) is one decode. */
export const LLAMA_BATCH_SIZE = 512;
/** Top-N list length of the forced-decoding fallback (llama.rn's n_probs). */
export const FORCED_DECODING_TOP_N = 50;

/** llama.cpp's common sampler defaults, written out so a GGUF's own defaults cannot change them. */
const SAMPLING: Partial<LlamaCompletionParams> = {
  top_k: 40,
  top_p: 0.95,
  min_p: 0.05,
  typical_p: 1,
  penalty_repeat: 1,
  penalty_freq: 0,
  penalty_present: 0,
  dry_multiplier: 0,
  xtc_probability: 0,
  mirostat: 0,
  samplers: ['top_k', 'top_p', 'min_p', 'temperature'],
};

export interface LlamaModelAdapterOptions {
  /** The llama.rn module (createDeviceModel passes the real one; tests pass a fake). */
  runtime: LlamaRuntime;
  /** Model id reported in info. Default DEFAULT_MODEL.id. */
  id?: string;
  /** Picks the GPU and thread defaults. Default 'ios'. */
  platform?: 'ios' | 'android';
  /**
   * Flash attention. Default 'off': on llama.cpp's CPU backend it moved sentence scores by up to
   * 1.1 nats against the proof's setup (native-tests/scoring/README.md); off, they are identical.
   */
  flashAttention?: 'off' | 'on' | 'auto';
  /** Top-N list length of the forced-decoding fallback. Default FORCED_DECODING_TOP_N. */
  topN?: number;
  /** Ignore the native scoring method even when present (diagnostics, tests). */
  forceFallback?: boolean;
  /** Load progress, 0 to 100. */
  onLoadProgress?: (progress: number) => void;
}

/** A load() that was overtaken by unload() or another load(). */
export class ModelLoadCancelledError extends Error {
  constructor() {
    super('The model load was cancelled by a later unload() or load().');
    this.name = 'ModelLoadCancelledError';
  }
}

type CallKind = 'completion' | 'score';

const noop = () => {};

/** Removes Qwen3 thinking blocks: whole <think>…</think> blocks, an unclosed tail, stray tags. */
export function stripThinking(text: string): string {
  let s = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const open = s.indexOf('<think>');
  if (open >= 0) s = s.slice(0, open);
  return s.replace(/<\/think>\s*/g, '');
}

/** Cuts `text` before the first occurrence of any stop string. */
export function cutAtStop(text: string, stop: readonly string[] = []): string {
  let end = text.length;
  for (const s of stop) {
    if (!s) continue;
    const i = text.indexOf(s);
    if (i >= 0 && i < end) end = i;
  }
  return text.slice(0, end);
}

/** GGUF metadata from llama.rn's model details ({ metadata: { key: string } }). */
function metadataOf(model: unknown): Record<string, unknown> {
  if (typeof model !== 'object' || model === null) return {};
  const meta = (model as { metadata?: unknown }).metadata;
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
}

export class LlamaModelAdapter implements ModelAdapter {
  readonly id: string;
  private readonly runtime: LlamaRuntime;
  private readonly platform: 'ios' | 'android';
  private readonly flashAttention: 'off' | 'on' | 'auto';
  private readonly topN: number;
  private readonly forceFallback: boolean;
  private readonly onLoadProgress?: (progress: number) => void;

  private current: ModelStatus = 'unloaded';
  private error: Error | null = null;
  private ctx: LlamaContextHandle | null = null;
  private contextSize = LLAMA_CONTEXT_SIZE;
  private scoring: ModelScoringPath = 'native';
  /** Text that the prompt tokenizer turns into the start token ('' when llama.rn adds a BOS). */
  private startText = '';
  /** Bumped by every load() and unload(); a call or load from an older session is stale. */
  private session = 0;
  private tail: Promise<unknown> = Promise.resolve();
  /** The last load's initLlama and setup; settles only after a cancelled load released its context. */
  private loading: Promise<void> = Promise.resolve();
  private active:{ kind: CallKind; ctx: LlamaContextHandle } | null = null;
  private readonly statusListeners = new Listeners<ModelStatus>();
  /** setInBackground(true): calls that have not started wait (iOS may not run Metal then). */
  private inBackground = false;
  private wakeWaiters: (() => void)[] = [];

  constructor(opts: LlamaModelAdapterOptions) {
    this.runtime = opts.runtime;
    this.id = opts.id ?? DEFAULT_MODEL.id;
    this.platform = opts.platform ?? 'ios';
    this.flashAttention = opts.flashAttention ?? 'off';
    this.topN = opts.topN ?? FORCED_DECODING_TOP_N;
    this.forceFallback = opts.forceFallback ?? false;
    this.onLoadProgress = opts.onLoadProgress;
  }

  get status(): ModelStatus {
    return this.current;
  }

  get info(): ModelInfo {
    return { id: this.id, contextSize: this.contextSize, backend: 'llama.rn', scoring: this.scoring };
  }

  get lastError(): Error | null {
    return this.error;
  }

  onStatusChange(listener: (status: ModelStatus) => void): Unsubscribe {
    return this.statusListeners.add(listener);
  }

  /**
   * The app went to the background (true) or came back (false). iOS does not let a background
   * app submit GPU work, so a Metal decode started then fails: while in the background, calls
   * that have not started yet wait (in order) and run when the app is back. A call already
   * running is left to finish or fail; a load() waits too before it creates the context.
   * unload() and load() still cancel waiting calls at once.
   * createDeviceModel wires this to AppState on iOS.
   */
  setInBackground(background: boolean): void {
    this.inBackground = background;
    if (!background) this.wake();
  }

  /** The initLlama parameters load() uses (exported for tests and the README). */
  initParams(modelPath: string, opts: ModelLoadOptions = {}): LlamaInitParams {
    const params: LlamaInitParams = {
      model: modelPath,
      n_ctx: opts.contextSize ?? LLAMA_CONTEXT_SIZE,
      n_batch: LLAMA_BATCH_SIZE,
      n_ubatch: LLAMA_BATCH_SIZE,
      // One sequence: no parallel slots, so the whole window belongs to it.
      n_parallel: 1,
      // iOS: Metal runs all 28 layers (99 = all); llama.rn falls back to the CPU where Metal is
      // missing (simulator). Android: CPU; llama.rn pins the threads to the fastest cores.
      n_gpu_layers: opts.gpuLayers ?? (this.platform === 'ios' ? 99 : 0),
      use_mlock: false,
      use_mmap: true,
      // iOS: no CPU weight repacking. With every layer on Metal it changes nothing; where Metal is
      // missing (simulator) it avoids llama.cpp's repacked q4_K CPU kernels, reported to SIGILL
      // with the prebuilt framework (docs/OUTLINE.md 3.1).
      no_extra_bufts: this.platform === 'ios',
      flash_attn_type: this.flashAttention,
      ctx_shift: false,
    };
    // Android: 4 threads on the 4 fastest cores (llama.rn's set_best_cores). iOS: llama.rn's
    // default (half the CPU's math cores); the GPU does the work there.
    const threads = opts.threads ?? (this.platform === 'android' ? 4 : undefined);
    if (threads !== undefined) params.n_threads = threads;
    return params;
  }

  async load(modelPath: string, opts: ModelLoadOptions = {}): Promise<void> {
    const session = ++this.session;
    this.wake();
    this.setStatus('loading');
    await this.releaseContext();
    // One context in memory at a time (the model alone is about 1.2 GB): an older load whose
    // initLlama is still running finishes, and releases what it made, before this one starts.
    await this.loading;
    // Background (iOS): wait for the foreground. A background app has a far lower memory limit
    // (1.2 GB more would get it killed) and may not run llama.cpp's Metal warmup.
    await this.whileInBackground(() => session !== this.session);
    if (session !== this.session) throw new ModelLoadCancelledError();
    const attempt = this.loadContext(session, modelPath, opts);
    this.loading = attempt.then(noop, noop);
    return attempt;
  }

  private async loadContext(session: number, modelPath: string, opts: ModelLoadOptions): Promise<void> {
    let ctx: LlamaContextHandle;
    try {
      ctx = await this.runtime.initLlama(this.initParams(modelPath, opts), this.onLoadProgress);
    } catch (e) {
      if (session !== this.session) throw new ModelLoadCancelledError();
      return this.fail(e);
    }
    if (session !== this.session) {
      await ctx.release().catch(noop);
      throw new ModelLoadCancelledError();
    }
    try {
      const startText = await this.resolveStartText(ctx);
      if (session !== this.session) {
        await ctx.release().catch(noop);
        throw new ModelLoadCancelledError();
      }
      this.ctx = ctx;
      this.startText = startText;
      this.contextSize = opts.contextSize ?? LLAMA_CONTEXT_SIZE;
      this.scoring = this.nativeScoring(ctx) ? 'native' : 'forced-decoding';
      this.error = null;
      this.setStatus('ready');
    } catch (e) {
      if (e instanceof ModelLoadCancelledError) throw e;
      await ctx.release().catch(noop);
      if (session !== this.session) throw new ModelLoadCancelledError();
      return this.fail(e);
    }
  }

  async unload(): Promise<void> {
    this.session++;
    this.wake();
    this.setStatus('unloaded');
    await this.releaseContext();
  }

  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    return this.enqueue('score', async (ctx, cancelled) => {
      if (text === '') return [];
      if (this.scoring === 'native' && ctx.scoreText) {
        const res = await ctx.scoreText(context, text);
        return checkScores(text, tokenScoresFromBytes(text, res.tokens));
      }
      return checkScores(text, await scoreByForcedDecoding(ctx, this.startText, context, text, this.topN, cancelled));
    });
  }

  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    return this.enqueue('score', async (ctx) => {
      const n = Math.floor(k);
      if (!(n > 0)) return [];
      if (this.scoring === 'native' && ctx.nextTokens) {
        const res = await ctx.nextTokens(context, n);
        return res.tokens
          .filter((t) => isWholePiece(t.text))
          .slice(0, n)
          .map((t) => ({ text: t.text, logprob: Math.min(0, t.logprob) }));
      }
      return nextTokensByCompletion(ctx, this.startText, context, n);
    });
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    return this.enqueue('completion', async (ctx, cancelled) => {
      const texts: string[] = [];
      const seed = opts.seed ?? 1;
      for (let i = 0; i < opts.n; i++) {
        if (cancelled()) throw new ForcedDecodingCancelled();
        const res = await ctx.completion({
          ...SAMPLING,
          prompt: this.startText + prompt,
          n_predict: Math.max(0, Math.floor(opts.maxTokens)),
          temperature: Math.max(0, opts.temperature),
          seed: seed + i,
          stop: opts.stop ?? [],
        });
        texts.push(cutAtStop(stripThinking(res.text), opts.stop));
      }
      return texts;
    });
  }

  // ---------- internals ----------

  private nativeScoring(ctx: LlamaContextHandle): boolean {
    if (this.forceFallback) return false;
    if (typeof ctx.scoreText !== 'function' || typeof ctx.nextTokens !== 'function') return false;
    return this.runtime.isTextScoringAvailable ? this.runtime.isTextScoringAvailable() : false;
  }

  /**
   * The start token as prompt text, for completions: model_server.py scores and generates after
   * BOS, or after the end-of-text token for models without one (Qwen3: <|im_end|>). llama.rn adds
   * a BOS itself when the model wants one; otherwise the EOS token's text is prepended, which
   * llama.rn's prompt tokenizer (special tokens parsed) turns back into that token. Checked by a
   * round trip; '' when anything does not match.
   */
  private async resolveStartText(ctx: LlamaContextHandle): Promise<string> {
    const meta = metadataOf(ctx.model);
    if (String(meta['tokenizer.ggml.add_bos_token']) === 'true') return '';
    const eos = Number(meta['tokenizer.ggml.eos_token_id']);
    if (!Number.isInteger(eos) || eos < 0) return '';
    const text = await ctx.detokenize([eos]);
    if (!text) return '';
    const back = await ctx.tokenize(text);
    return back.tokens.length === 1 && back.tokens[0] === eos ? text : '';
  }

  private fail(e: unknown): never {
    const error = e instanceof Error ? e : new Error(String(e));
    this.error = error;
    this.setStatus('error');
    throw error;
  }

  /** Waits for the running call (stopping a completion), then releases the context. */
  private async releaseContext(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = null;
    if (!ctx) return;
    if (this.active?.ctx === ctx && this.active.kind === 'completion') {
      await ctx.stopCompletion().catch(noop);
    }
    await this.tail.catch(noop);
    await ctx.release().catch(noop);
  }

  private enqueue<T>(kind: CallKind, fn: (ctx: LlamaContextHandle, cancelled: () => boolean) => Promise<T>): Promise<T> {
    if (this.current !== 'ready' || !this.ctx) return Promise.reject(new ModelNotReadyError(this.current));
    const session = this.session;
    const cancelled = () => session !== this.session;
    const run = async (): Promise<T> => {
      await this.whileInBackground(cancelled);
      const ctx = this.ctx;
      if (cancelled() || !ctx || this.current !== 'ready') throw new ModelNotReadyError(this.current);
      this.active = { kind, ctx };
      try {
        const result = await fn(ctx, cancelled);
        if (cancelled()) throw new ModelNotReadyError(this.current);
        return result;
      } catch (e) {
        if (cancelled()) throw new ModelNotReadyError(this.current);
        throw e;
      } finally {
        this.active = null;
      }
    };
    const p = this.tail.then(run, run);
    this.tail = p.then(noop, noop);
    return p;
  }

  private async whileInBackground(cancelled: () => boolean): Promise<void> {
    while (this.inBackground && !cancelled()) {
      await new Promise<void>((resolve) => this.wakeWaiters.push(resolve));
    }
  }

  private wake(): void {
    const waiters = this.wakeWaiters;
    this.wakeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private setStatus(status: ModelStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.statusListeners.emit(status);
  }
}
