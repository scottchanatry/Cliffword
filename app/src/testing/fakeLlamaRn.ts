/**
 * A fake of the llama.rn module for tests (__mocks__/llama.rn.ts uses one; tests build their own
 * with createFakeLlamaRuntime and pass it to LlamaModelAdapter as `runtime`).
 *
 * It runs the engine's n-gram mock model behind llama.rn's surface:
 * - scoreText / nextTokens (the Cliffword patch) report the mock's tokens as UTF-8 byte ranges
 *   with token ids, the way CliffwordScore.cpp does; `splitBytes` cuts chosen pieces inside
 *   their multi-byte characters (the logprob spread evenly over the parts), like Qwen3's
 *   byte-level BPE does with some characters, so the adapter's merging can be tested;
 * - completion with n_probs reports the mock's top list with ids (forced decoding), and without
 *   it generates with the mock (seeded);
 * - tokenize / detokenize use the same pieces; detokenizing a cut character gives U+FFFD;
 * - the model metadata names <|im_end|> (151645) as EOS and no BOS, like Qwen3's GGUF.
 * Test controls: `nativeScoring` / `jsPatched` (which llama.rn it imitates), holdCalls() to keep
 * calls pending, failNextInit(), and records of contexts, calls and the most calls ever running
 * at once.
 */
import { createMockModel, type LanguageModel, type TokenScore } from '@cliffword/engine';
import { TextDecoder, TextEncoder } from 'util';
import type {
  LlamaCompletionParams,
  LlamaCompletionResult,
  LlamaContextHandle,
  LlamaInitParams,
  LlamaNextTokensResult,
  LlamaRuntime,
  LlamaScoreTextResult,
} from '../adapters/model/llamaRuntime';

export const FAKE_START_TEXT = '<|im_end|>';
export const FAKE_EOS_ID = 151645;

let sharedModel: LanguageModel | undefined;

export interface FakeLlamaOptions {
  /** The model behind the fake. Default: one shared createMockModel(). */
  model?: LanguageModel;
  /** The native library has the Cliffword scoring calls. Default true. */
  nativeScoring?: boolean;
  /**
   * The JS wrapper is patched (contexts have scoreText / nextTokens, isTextScoringAvailable
   * exists). Default: same as nativeScoring. jsPatched without nativeScoring imitates a patched
   * JS bundle on a binary built before the patch.
   */
  jsPatched?: boolean;
  /** Pieces to cut inside their multi-byte characters. Default: none. */
  splitBytes?: (piece: string) => boolean;
}

export interface FakeCall {
  method: 'completion' | 'scoreText' | 'nextTokens' | 'tokenize' | 'detokenize';
  args: unknown[];
}

export interface FakeLlamaRuntime extends LlamaRuntime {
  readonly options: Required<Omit<FakeLlamaOptions, 'splitBytes'>> & Pick<FakeLlamaOptions, 'splitBytes'>;
  readonly contexts: FakeLlamaContext[];
  readonly initCalls: LlamaInitParams[];
  readonly calls: FakeCall[];
  /** Calls running right now, and the most ever running at once. */
  active: number;
  maxActive: number;
  /** The next initLlama rejects with `error`. */
  failNextInit(error: Error): void;
  /** Keeps every call (and initLlama) pending until the returned function is called. */
  holdCalls(): () => void;
  /** Resolves once `n` calls are pending in holdCalls(). */
  whenPending(n: number): Promise<void>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** The fake's vocabulary: one id per distinct piece (bytes), the EOS token fixed. */
class Vocab {
  private readonly ids = new Map<string, number>([[FAKE_START_TEXT, FAKE_EOS_ID]]);
  private readonly pieces = new Map<number, Uint8Array>([[FAKE_EOS_ID, encoder.encode(FAKE_START_TEXT)]]);
  private next = 1000;

  id(piece: Uint8Array): number {
    const key = Array.from(piece).join(',');
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(key, id);
      this.pieces.set(id, piece);
    }
    return id;
  }

  idOfText(text: string): number {
    if (text === FAKE_START_TEXT) return FAKE_EOS_ID;
    return this.id(encoder.encode(text));
  }

  piece(id: number): Uint8Array {
    const p = this.pieces.get(id);
    if (!p) throw new Error(`fake llama.rn: unknown token ${id}`);
    return p;
  }
}

interface FakeToken {
  id: number;
  bytes: Uint8Array;
  logprob: number;
}

export class FakeLlamaContext implements LlamaContextHandle {
  readonly id: number;
  readonly gpu = false;
  readonly model = {
    desc: 'fake qwen3 1.7B Q4_K_M',
    metadata: { 'tokenizer.ggml.add_bos_token': 'false', 'tokenizer.ggml.eos_token_id': String(FAKE_EOS_ID) },
  };
  released = false;
  stopRequests = 0;
  scoreText?: (contextText: string, text: string) => Promise<LlamaScoreTextResult>;
  nextTokens?: (contextText: string, k: number) => Promise<LlamaNextTokensResult>;
  private stopWaiters: (() => void)[] = [];

  constructor(
    id: number,
    private readonly rt: FakeRuntimeImpl,
  ) {
    this.id = id;
    if (rt.options.jsPatched) {
      this.scoreText = (contextText, text) =>
        this.call('scoreText', [contextText, text], async () => {
          if (!rt.options.nativeScoring) throw new Error('[RNLlama] Text scoring is not available');
          return this.nativeScore(contextText, text);
        });
      this.nextTokens = (contextText, k) =>
        this.call('nextTokens', [contextText, k], async () => {
          if (!rt.options.nativeScoring) throw new Error('[RNLlama] Text scoring is not available');
          const list = await rt.options.model.nextTokens(stripStart(contextText), k);
          return { ...stats(), tokens: list.map((c) => ({ id: rt.vocab.idOfText(c.text), text: c.text, logprob: c.logprob })) };
        });
    }
  }

  completion(params: LlamaCompletionParams): Promise<LlamaCompletionResult> {
    return this.call('completion', [params], async () => {
      const prompt = stripStart(params.prompt);
      if ((params.n_probs ?? 0) > 0) {
        const list = await this.rt.options.model.nextTokens(prompt, params.n_probs as number);
        const probs = list.map((c) => ({ tok_id: this.rt.vocab.idOfText(c.text), tok_str: c.text, prob: Math.exp(c.logprob) }));
        return { text: list[0]?.text ?? '', completion_probabilities: [{ content: list[0]?.text ?? '', probs }] };
      }
      const [text] = await this.rt.options.model.generate(prompt, {
        n: 1,
        maxTokens: params.n_predict ?? 16,
        temperature: params.temperature ?? 0.8,
        stop: params.stop,
        seed: params.seed,
      });
      return { text: text ?? '' };
    }, true);
  }

  async stopCompletion(): Promise<void> {
    this.stopRequests++;
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    waiters.forEach((w) => w());
  }

  tokenize(text: string): Promise<{ tokens: number[] }> {
    return this.call('tokenize', [text], async () => {
      if (text === FAKE_START_TEXT) return { tokens: [FAKE_EOS_ID] };
      return { tokens: (await this.tokens('', text)).map((t) => t.id) };
    });
  }

  detokenize(tokens: number[]): Promise<string> {
    return this.call('detokenize', [tokens], async () => {
      const parts = tokens.map((id) => this.rt.vocab.piece(id));
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let off = 0;
      for (const p of parts) {
        all.set(p, off);
        off += p.length;
      }
      return decoder.decode(all); // a cut character becomes U+FFFD, as through JSI
    });
  }

  async release(): Promise<void> {
    this.released = true;
  }

  /** The mock's tokens of `text` after `context`, as byte pieces with ids. */
  private async tokens(context: string, text: string): Promise<FakeToken[]> {
    const scored: TokenScore[] = await this.rt.options.model.scoreContinuation(context, text);
    const out: FakeToken[] = [];
    for (const t of scored) {
      const bytes = encoder.encode(t.text);
      if (this.rt.options.splitBytes?.(t.text) && bytes.length > 1) {
        // Cut after every byte of a multi-byte character but its last, the way byte-level BPE
        // can split a character: every cut lands inside a character.
        const parts: Uint8Array[] = [];
        let from = 0;
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i] as number;
          const next = bytes[i + 1];
          if (b >= 0x80 && next !== undefined && (next & 0xc0) === 0x80) {
            parts.push(bytes.slice(from, i + 1));
            from = i + 1;
          }
        }
        parts.push(bytes.slice(from));
        for (const p of parts) out.push({ id: this.rt.vocab.id(p), bytes: p, logprob: t.logprob / parts.length });
      } else {
        out.push({ id: this.rt.vocab.id(bytes), bytes, logprob: t.logprob });
      }
    }
    return out;
  }

  private async nativeScore(contextText: string, text: string): Promise<LlamaScoreTextResult> {
    const toks = await this.tokens(stripStart(contextText), text);
    let off = 0;
    const tokens = toks.map((t) => {
      const r = { id: t.id, byte_start: off, byte_end: off + t.bytes.length, logprob: t.logprob };
      off += t.bytes.length;
      return r;
    });
    return { ...stats(), tokens };
  }

  private async call<T>(method: FakeCall['method'], args: unknown[], fn: () => Promise<T>, stoppable = false): Promise<T> {
    if (this.released) throw new Error('Context not found');
    this.rt.calls.push({ method, args });
    this.rt.active++;
    this.rt.maxActive = Math.max(this.rt.maxActive, this.rt.active);
    try {
      if (this.rt.gate) {
        this.rt.pending++;
        this.rt.notifyPending();
        const stopped = stoppable ? new Promise<'stopped'>((resolve) => this.stopWaiters.push(() => resolve('stopped'))) : null;
        const outcome = await Promise.race(stopped ? [this.rt.gate, stopped] : [this.rt.gate]);
        this.rt.pending--;
        if (outcome === 'stopped') return { text: '', interrupted: true } as T;
      }
      if (this.released) throw new Error('Context not found');
      return await fn();
    } finally {
      this.rt.active--;
    }
  }
}

function stripStart(prompt: string): string {
  return prompt.startsWith(FAKE_START_TEXT) ? prompt.slice(FAKE_START_TEXT.length) : prompt;
}

function stats() {
  return { prefix_tokens: 0, reused_tokens: 0, evaluated_tokens: 0 };
}

class FakeRuntimeImpl implements FakeLlamaRuntime {
  readonly options: FakeLlamaRuntime['options'];
  readonly vocab = new Vocab();
  readonly contexts: FakeLlamaContext[] = [];
  readonly initCalls: LlamaInitParams[] = [];
  readonly calls: FakeCall[] = [];
  active = 0;
  maxActive = 0;
  gate: Promise<void> | null = null;
  pending = 0;
  isTextScoringAvailable?: () => boolean;
  private initFailure: Error | null = null;
  private nextId = 1;
  private pendingWaiters: { n: number; resolve: () => void }[] = [];

  constructor(opts: FakeLlamaOptions) {
    const nativeScoring = opts.nativeScoring ?? true;
    sharedModel ??= createMockModel();
    this.options = {
      model: opts.model ?? sharedModel,
      nativeScoring,
      jsPatched: opts.jsPatched ?? nativeScoring,
      splitBytes: opts.splitBytes,
    };
    if (this.options.jsPatched) this.isTextScoringAvailable = () => this.options.nativeScoring;
  }

  initLlama = async (params: LlamaInitParams, onProgress?: (progress: number) => void): Promise<LlamaContextHandle> => {
    this.initCalls.push(params);
    onProgress?.(0);
    if (this.gate) {
      this.pending++;
      this.notifyPending();
      await this.gate;
      this.pending--;
    }
    const failure = this.initFailure;
    this.initFailure = null;
    if (failure) throw failure;
    if (!params.model || params.model.startsWith('missing:')) throw new Error(`Failed to load model ${params.model}`);
    onProgress?.(100);
    const ctx = new FakeLlamaContext(this.nextId++, this);
    this.contexts.push(ctx);
    return ctx;
  };

  failNextInit(error: Error): void {
    this.initFailure = error;
  }

  holdCalls(): () => void {
    let open!: () => void;
    this.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => {
      this.gate = null;
      open();
    };
  }

  whenPending(n: number): Promise<void> {
    if (this.pending >= n) return Promise.resolve();
    return new Promise((resolve) => this.pendingWaiters.push({ n, resolve }));
  }

  notifyPending(): void {
    const ready = this.pendingWaiters.filter((w) => this.pending >= w.n);
    this.pendingWaiters = this.pendingWaiters.filter((w) => this.pending < w.n);
    ready.forEach((w) => w.resolve());
  }
}

export function createFakeLlamaRuntime(opts: FakeLlamaOptions = {}): FakeLlamaRuntime {
  return new FakeRuntimeImpl(opts);
}
