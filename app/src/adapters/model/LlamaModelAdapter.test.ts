import path from 'path';
import { createMockModel, type LanguageModel, type TokenScore } from '@cliffword/engine';
import { createFakeLlamaRuntime, FAKE_START_TEXT, type FakeLlamaOptions, type FakeLlamaRuntime } from '../../testing/fakeLlamaRn';
import { TopNBoundedModel } from '../../../../engine/src/model/topN';
import { cutAtStop, LlamaModelAdapter, ModelLoadCancelledError, stripThinking, type LlamaModelAdapterOptions } from './LlamaModelAdapter';
import { ModelNotReadyError, type ModelStatus } from './types';

const MODEL_PATH = 'file:///data/models/Qwen3-1.7B-Q4_K_M.gguf';
const PREFIX = 'Frase en español:\n';
const mock: LanguageModel = createMockModel();

function setup(fake: FakeLlamaOptions = {}, opts: Partial<LlamaModelAdapterOptions> = {}) {
  const runtime = createFakeLlamaRuntime({ model: mock, ...fake });
  const adapter = new LlamaModelAdapter({ runtime, ...opts });
  const statuses: ModelStatus[] = [];
  adapter.onStatusChange((s) => statuses.push(s));
  return { runtime, adapter, statuses };
}

async function loaded(fake: FakeLlamaOptions = {}, opts: Partial<LlamaModelAdapterOptions> = {}) {
  const s = setup(fake, opts);
  await s.adapter.load(MODEL_PATH);
  return s;
}

const SENTENCES: [string, string][] = [
  [PREFIX + 'Marta llegó tarde al', ' mercado.'],
  [PREFIX, 'El niño está en la casa.'],
  [PREFIX + 'Ayer', ' compré pan en la tienda.'],
  ['', 'La niña come manzanas.'],
];

describe('LlamaModelAdapter: load settings', () => {
  it('sets up Qwen3-1.7B for a phone: 2048 tokens, batches of 512, one sequence, no mlock, flash attention off', async () => {
    const { runtime, adapter } = await loaded();
    expect(runtime.initCalls).toEqual([
      {
        model: MODEL_PATH,
        n_ctx: 2048,
        n_batch: 512,
        n_ubatch: 512,
        n_parallel: 1,
        n_gpu_layers: 99,
        use_mlock: false,
        use_mmap: true,
        no_extra_bufts: true,
        flash_attn_type: 'off',
        ctx_shift: false,
      },
    ]);
    expect(adapter.info).toEqual({ id: 'qwen3-1.7b-q4_k_m', contextSize: 2048, backend: 'llama.rn', scoring: 'native' });
  });

  it('runs on the CPU with 4 threads on Android, and takes overrides', () => {
    const { adapter } = setup({}, { platform: 'android' });
    expect(adapter.initParams('x.gguf')).toMatchObject({ n_gpu_layers: 0, n_threads: 4, no_extra_bufts: false });
    expect(adapter.initParams('x.gguf', { contextSize: 1024, threads: 6, gpuLayers: 10 })).toMatchObject({
      n_ctx: 1024,
      n_threads: 6,
      n_gpu_layers: 10,
    });
    expect(setup().adapter.initParams('x.gguf')).not.toHaveProperty('n_threads');
  });
});

describe('LlamaModelAdapter: lifecycle and ModelNotReadyError', () => {
  it('rejects every call with ModelNotReadyError until loaded', async () => {
    const { adapter } = setup();
    expect(adapter.status).toBe('unloaded');
    await expect(adapter.scoreContinuation(PREFIX, 'Hola')).rejects.toBeInstanceOf(ModelNotReadyError);
    await expect(adapter.nextTokens(PREFIX, 3)).rejects.toMatchObject({ name: 'ModelNotReadyError', status: 'unloaded' });
    await expect(adapter.generate(PREFIX, { n: 1, maxTokens: 4, temperature: 0.8 })).rejects.toBeInstanceOf(ModelNotReadyError);
  });

  it('reports loading then ready, rejects calls while loading, and releases on unload', async () => {
    const { runtime, adapter, statuses } = setup();
    const release = runtime.holdCalls();
    const loading = adapter.load(MODEL_PATH);
    expect(adapter.status).toBe('loading');
    await expect(adapter.scoreContinuation(PREFIX, 'Hola')).rejects.toMatchObject({ status: 'loading' });
    release();
    await loading;
    expect(statuses).toEqual(['loading', 'ready']);
    await adapter.unload();
    expect(statuses).toEqual(['loading', 'ready', 'unloaded']);
    expect(runtime.contexts[0]!.released).toBe(true);
    await expect(adapter.scoreContinuation(PREFIX, 'Hola')).rejects.toMatchObject({ status: 'unloaded' });
  });

  it('moves to error with lastError when the file cannot be loaded, and recovers on the next load', async () => {
    const { runtime, adapter, statuses } = setup();
    runtime.failNextInit(new Error('bad gguf'));
    await expect(adapter.load(MODEL_PATH)).rejects.toThrow('bad gguf');
    expect(adapter.status).toBe('error');
    expect(adapter.lastError?.message).toBe('bad gguf');
    await expect(adapter.nextTokens(PREFIX, 3)).rejects.toMatchObject({ status: 'error' });
    await adapter.load(MODEL_PATH);
    expect(adapter.lastError).toBeNull();
    expect(statuses).toEqual(['loading', 'error', 'loading', 'ready']);
  });

  it('replaces the loaded model on a second load', async () => {
    const { runtime, adapter } = await loaded();
    await adapter.load(MODEL_PATH);
    expect(runtime.contexts).toHaveLength(2);
    expect(runtime.contexts[0]!.released).toBe(true);
    expect(runtime.contexts[1]!.released).toBe(false);
    expect(adapter.status).toBe('ready');
  });

  it('cancels a load overtaken by unload and releases the context it made', async () => {
    const { runtime, adapter, statuses } = setup();
    const release = runtime.holdCalls();
    const loading = adapter.load(MODEL_PATH);
    const unloading = adapter.unload();
    release();
    await expect(loading).rejects.toBeInstanceOf(ModelLoadCancelledError);
    await unloading;
    expect(adapter.status).toBe('unloaded');
    expect(statuses).toEqual(['loading', 'unloaded']);
    expect(runtime.contexts.every((c) => c.released)).toBe(true);
  });
});

describe('LlamaModelAdapter: native scoring (patched llama.rn)', () => {
  it('returns the native scores as engine TokenScores', async () => {
    const { adapter, runtime } = await loaded();
    for (const [context, text] of SENTENCES) {
      expect(await adapter.scoreContinuation(context, text)).toEqual(await mock.scoreContinuation(context, text));
    }
    expect(runtime.calls.filter((c) => c.method === 'scoreText')).toHaveLength(SENTENCES.length);
    expect(runtime.calls.some((c) => c.method === 'completion')).toBe(false);
    expect(await adapter.scoreContinuation(PREFIX, '')).toEqual([]);
  });

  it('merges byte tokens of split characters (accents, ñ, emoji) into whole characters', async () => {
    const { adapter } = await loaded({ splitBytes: (p) => /[^\x00-\x7f]/.test(p) });
    const context = PREFIX + 'Mi abuela';
    const text = ' está cansadísima en Logroño 🌞.';
    const expected = await mock.scoreContinuation(context, text);
    const toks = await adapter.scoreContinuation(context, text);
    expect(toks.map((t) => t.text).join('')).toBe(text);
    expect(toks.map((t) => [t.text, t.start, t.end])).toEqual(expected.map((t) => [t.text, t.start, t.end]));
    toks.forEach((t, i) => expect(t.logprob).toBeCloseTo(expected[i]!.logprob, 10));
    for (const t of toks) expect(text.slice(t.start, t.end)).toBe(t.text);
  });

  it('gives the native next tokens, at most k, most likely first', async () => {
    const { adapter } = await loaded();
    const context = PREFIX + 'Marta llegó tarde al';
    expect(await adapter.nextTokens(context, 5)).toEqual(await mock.nextTokens(context, 5));
    expect(await adapter.nextTokens(context, 0)).toEqual([]);
  });
});

describe('LlamaModelAdapter: forced-decoding fallback (llama.rn without the patch)', () => {
  it.each([
    ['an unpatched llama.rn', { nativeScoring: false, jsPatched: false }],
    ['a patched JS bundle on a binary built before the patch', { nativeScoring: false, jsPatched: true }],
  ] as const)('falls back for %s and says so in info', async (_label, fake) => {
    const { adapter, runtime } = await loaded(fake);
    expect(adapter.info.scoring).toBe('forced-decoding');
    await adapter.scoreContinuation(PREFIX, 'El niño está en la casa.');
    expect(runtime.calls.some((c) => c.method === 'scoreText')).toBe(false);
    // Every step asks for raw (pre-sampling) probabilities of one token after the start token.
    const steps = runtime.calls.filter((c) => c.method === 'completion').map((c) => c.args[0] as Record<string, unknown>);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(s).toMatchObject({ n_predict: 1, n_probs: 50, post_sampling_probs: false, ignore_eos: true });
      expect(String(s.prompt).startsWith(FAKE_START_TEXT + PREFIX)).toBe(true);
    }
  });

  it('can be forced even when the native method is there', async () => {
    const { adapter } = await loaded({}, { forceFallback: true });
    expect(adapter.info.scoring).toBe('forced-decoding');
  });

  it('gives exact logprobs inside the top N and upper bounds outside, like TopNBoundedModel', async () => {
    const topN = 3;
    const { adapter } = await loaded({ nativeScoring: false }, { topN });
    const reference = new TopNBoundedModel(mock, { n: topN });
    let bounded = 0;
    for (const [context, text] of SENTENCES) {
      const exact = await mock.scoreContinuation(context, text);
      const want = await reference.scoreContinuation(context, text);
      const got = await adapter.scoreContinuation(context, text);
      expect(got.map((t) => [t.text, t.start, t.end])).toEqual(exact.map((t) => [t.text, t.start, t.end]));
      got.forEach((t, i) => {
        expect(t.logprob).toBeCloseTo(want[i]!.logprob, 9);
        // The adapter matches candidates by token id; TopNBoundedModel by text, or by a tie with
        // the N-th candidate. They differ only on such a tie (the mock lists sentence starts in
        // lower case, "la" for "La"), where both give the same number.
        const tie = Math.abs(t.logprob - exact[i]!.logprob) < 1e-9;
        if (!tie) expect(t.upperBound ?? false).toBe(want[i]!.upperBound ?? false);
        // A bound is never below the true value; an exact token is the true value.
        if (t.upperBound) {
          expect(t.logprob).toBeGreaterThanOrEqual(exact[i]!.logprob - 1e-9);
          bounded++;
        } else {
          expect(t.logprob).toBeCloseTo(exact[i]!.logprob, 9);
        }
      });
    }
    expect(bounded).toBeGreaterThan(0);
  });

  it('marks a split character as an upper bound (its later bytes cannot be prompted)', async () => {
    const { adapter } = await loaded({ nativeScoring: false, splitBytes: (p) => p.includes('ñ') });
    const toks = await adapter.scoreContinuation(PREFIX + 'Mi', ' niño come.');
    const nino = toks.find((t) => t.text === ' niño') as TokenScore;
    expect(nino.upperBound).toBe(true);
    expect(toks.map((t) => t.text).join('')).toBe(' niño come.');
    // The split token's group keeps the first part's value: never below the true total.
    const exact = (await mock.scoreContinuation(PREFIX + 'Mi', ' niño come.')).find((t) => t.text === ' niño') as TokenScore;
    expect(nino.logprob).toBeGreaterThanOrEqual(exact.logprob);
  });

  it('gives next tokens from one completion with raw probabilities', async () => {
    const { adapter, runtime } = await loaded({ nativeScoring: false });
    const context = PREFIX + 'Marta llegó tarde al';
    const got = await adapter.nextTokens(context, 5);
    const want = await mock.nextTokens(context, 5);
    expect(got.map((t) => t.text)).toEqual(want.map((t) => t.text));
    got.forEach((t, i) => expect(t.logprob).toBeCloseTo(want[i]!.logprob, 9));
    const last = runtime.calls[runtime.calls.length - 1]!;
    expect(last.args[0]).toMatchObject({ prompt: FAKE_START_TEXT + context, n_predict: 1, n_probs: 21, post_sampling_probs: false });
  });
});

describe('LlamaModelAdapter: generate', () => {
  it('continues start token + prompt, seeds completion i with seed + i, and runs them one after another', async () => {
    const { adapter, runtime } = await loaded();
    const prompt = PREFIX + 'Marta llegó tarde al';
    const opts = { n: 3, maxTokens: 6, temperature: 0.8, stop: ['\n'], seed: 11 };
    const texts = await adapter.generate(prompt, opts);
    expect(texts).toHaveLength(3);
    expect(texts).toEqual(await mock.generate(prompt, { ...opts }));
    const params = runtime.calls.filter((c) => c.method === 'completion').map((c) => c.args[0] as Record<string, unknown>);
    expect(params.map((p) => p.seed)).toEqual([11, 12, 13]);
    expect(params[0]).toMatchObject({
      prompt: FAKE_START_TEXT + prompt,
      n_predict: 6,
      temperature: 0.8,
      stop: ['\n'],
      top_k: 40,
      top_p: 0.95,
      min_p: 0.05,
      samplers: ['top_k', 'top_p', 'min_p', 'temperature'],
    });
    expect(runtime.maxActive).toBe(1);
    expect(await adapter.generate(prompt, opts)).toEqual(texts);
  });

  it('strips thinking blocks and cuts at the first stop string', () => {
    expect(stripThinking('<think>\nhmm\n</think>\n\nHola.')).toBe('Hola.');
    expect(stripThinking('Hola <think>sin cerrar')).toBe('Hola ');
    expect(stripThinking('a</think>b')).toBe('ab');
    expect(cutAtStop('uno. dos\ntres', ['\n', '.'])).toBe('uno');
    expect(cutAtStop('uno', [''])).toBe('uno');
  });
});

describe('LlamaModelAdapter: serialization and unload', () => {
  async function heldAdapter(fake: FakeLlamaOptions = {}): Promise<{ runtime: FakeLlamaRuntime; adapter: LlamaModelAdapter; release: () => void }> {
    const { runtime, adapter } = await loaded(fake);
    return { runtime, adapter, release: runtime.holdCalls() };
  }

  it('runs one call at a time, in order', async () => {
    const { runtime, adapter, release } = await heldAdapter();
    const order: string[] = [];
    const a = adapter.scoreContinuation(PREFIX, 'El niño.').then(() => order.push('a'));
    const b = adapter.nextTokens(PREFIX, 3).then(() => order.push('b'));
    const c = adapter.generate(PREFIX, { n: 2, maxTokens: 3, temperature: 0.8, seed: 1 }).then(() => order.push('c'));
    await runtime.whenPending(1);
    expect(runtime.active).toBe(1);
    release();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(runtime.maxActive).toBe(1);
  });

  it('a failed call does not block the queue', async () => {
    const { runtime, adapter } = await loaded();
    runtime.contexts[0]!.scoreText = () => Promise.reject(new Error('Context is busy'));
    await expect(adapter.scoreContinuation(PREFIX, 'Hola.')).rejects.toThrow('Context is busy');
    expect(await adapter.nextTokens(PREFIX, 2)).toHaveLength(2);
  });

  it('unload during a scoring call: the call rejects with ModelNotReadyError, queued calls too, then the context is released', async () => {
    const { runtime, adapter, release } = await heldAdapter();
    const running = adapter.scoreContinuation(PREFIX, 'El niño está en la casa.');
    const queued = adapter.nextTokens(PREFIX, 3);
    await runtime.whenPending(1);
    const unloading = adapter.unload();
    expect(adapter.status).toBe('unloaded');
    await expect(adapter.scoreContinuation(PREFIX, 'Hola.')).rejects.toMatchObject({ status: 'unloaded' });
    expect(runtime.contexts[0]!.released).toBe(false); // waits for the running call
    release();
    await expect(running).rejects.toBeInstanceOf(ModelNotReadyError);
    await expect(queued).rejects.toBeInstanceOf(ModelNotReadyError);
    await unloading;
    expect(runtime.contexts[0]!.released).toBe(true);
  });

  it('unload during generate stops the completion', async () => {
    const { runtime, adapter, release } = await heldAdapter();
    const generating = adapter.generate(PREFIX, { n: 3, maxTokens: 8, temperature: 0.8, seed: 3 });
    await runtime.whenPending(1);
    const unloading = adapter.unload();
    await expect(generating).rejects.toBeInstanceOf(ModelNotReadyError);
    await unloading;
    release();
    expect(runtime.contexts[0]!.stopRequests).toBe(1);
    expect(runtime.contexts[0]!.released).toBe(true);
    // Only the first of the three completions ran.
    expect(runtime.calls.filter((c) => c.method === 'completion')).toHaveLength(1);
  });

  it('unload during fallback scoring stops between steps', async () => {
    const { runtime, adapter, release } = await heldAdapter({ nativeScoring: false });
    const running = adapter.scoreContinuation(PREFIX, 'El niño está en la casa con su perro.');
    await runtime.whenPending(1);
    const unloading = adapter.unload();
    release();
    await expect(running).rejects.toBeInstanceOf(ModelNotReadyError);
    await unloading;
    expect(runtime.contexts[0]!.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine's LanguageModel contract (engine/src/model/contract.ts, a vitest suite) run in Jest
// against the adapter over the fake llama.rn: once with the native method, once with the
// forced-decoding fallback. Jest's expect takes one argument, vitest's an optional message.
// ---------------------------------------------------------------------------------------------
type ContractModule = {
  runLanguageModelContract: (
    name: string,
    makeModel: () => Promise<LanguageModel>,
    opts: { cases: { context: string; text: string }[]; tolerance?: number },
  ) => void;
};
const vitestShim = () => ({ describe, it, beforeAll, expect: (actual: unknown) => expect(actual) });
const contractPath = path.resolve(__dirname, '../../../../engine/src/model/contract');
let engineVitest: string | null = null;
try {
  engineVitest = require.resolve('vitest', { paths: [path.dirname(contractPath)] });
} catch {
  engineVitest = null;
}
if (engineVitest) jest.doMock(engineVitest, vitestShim);
else jest.doMock('vitest', vitestShim, { virtual: true });
const { runLanguageModelContract } = jest.requireActual<ContractModule>(contractPath);

const CONTRACT_CASES = SENTENCES.map(([context, text]) => ({ context, text }));

runLanguageModelContract('LlamaModelAdapter, native scoring', async () => (await loaded()).adapter, {
  cases: CONTRACT_CASES,
  tolerance: 1e-9,
});
runLanguageModelContract('LlamaModelAdapter, forced decoding', async () => (await loaded({ nativeScoring: false })).adapter, {
  cases: CONTRACT_CASES,
  tolerance: 1e-9,
});
