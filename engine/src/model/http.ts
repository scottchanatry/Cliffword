/**
 * LanguageModel over HTTP: the engine against a real model served by
 * proof/model_server.py (llama.cpp through llama-cpp-python), so engine code and tests
 * can run against the recommended model (Qwen3-1.7B Q4_K_M) without a phone.
 *
 * Endpoints (POST, JSON): /score {context, text} -> {tokens: [{text, start, end, logprob}]},
 * /next {context, k} -> {tokens: [{text, logprob}]}, /generate {prompt, n, maxTokens,
 * temperature, stop, seed} -> {texts}, and GET /health. JSON has no -Infinity, so a
 * logprob of null means -Infinity. Offsets are UTF-16 code units (JavaScript string
 * indices). See engine/scripts/real-model.md.
 *
 * Every answer is checked before the engine sees it: token texts must concatenate
 * exactly to the scored text with contiguous offsets, logprobs must be numbers <= 0,
 * candidate lists must be sorted and no longer than k, and generate must return n
 * strings. A violation throws HttpModelError naming the endpoint and the problem, so a
 * server bug fails loudly instead of skewing scores.
 *
 * Uses the global fetch (Node 18+, browsers, React Native) unless one is passed in.
 * No Date.now() or randomness: the timeout is a timer, and generate passes a seed
 * (default 1, as the mock) so completions are reproducible.
 */
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from './types';

/** The part of a fetch Response this adapter reads. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** The part of the fetch API this adapter uses. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: unknown },
) => Promise<FetchResponseLike>;

export interface HttpModelOptions {
  /** Server root, e.g. "http://127.0.0.1:8765". A trailing slash is ignored. */
  baseUrl: string;
  /** LanguageModel.id; defaults to "http:" + baseUrl. */
  id?: string;
  /**
   * Longest wait for one answer, in ms. 120 s: the slowest engine call is generate, about
   * 8 candidates of 60 tokens at 15 tokens/s for Qwen3-1.7B on 4 CPU cores (32 s, proof
   * speed table); the 4B model runs at half that speed. A score or next-token call takes
   * well under a second.
   */
  timeoutMs: number;
  /** fetch implementation; defaults to globalThis.fetch. Tests pass a fake. */
  fetch?: FetchLike;
}

export const DEFAULT_HTTP_MODEL_OPTIONS: Readonly<Pick<HttpModelOptions, 'timeoutMs'>> = {
  timeoutMs: 120_000,
};

/**
 * Largest positive logprob accepted as rounding noise (then clamped to 0). A log-softmax
 * computed in float64 is never above 0 by more than this; anything larger is a server bug.
 */
const LOGPROB_SLACK = 1e-6;

/** What /health reports. */
export interface HttpModelHealth {
  ok: boolean;
  /** Model file name, e.g. "Qwen3-1.7B-Q4_K_M.gguf". */
  model: string;
  n_vocab: number;
  n_ctx: number;
  /** Token ids the server puts before every context (BOS, or end-of-text for Qwen). */
  start_token: number[];
}

/** Any failure of an HTTP model call: unreachable server, timeout, HTTP error, bad answer. */
export class HttpModelError extends Error {
  /** HTTP status when the server answered with an error, else undefined. */
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpModelError';
    this.status = status;
  }
}

interface TimerGlobals {
  fetch?: FetchLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  AbortController?: new () => { signal: unknown; abort(): void };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    return cause instanceof Error ? `${e.message}: ${cause.message}` : e.message;
  }
  return String(e);
}

/** A logprob from JSON: a number <= 0, or null for -Infinity. */
function readLogprob(v: unknown, where: string): number {
  if (v === null) return -Infinity;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${where}: logprob ${JSON.stringify(v)} is not a number`);
  if (v > LOGPROB_SLACK) throw new Error(`${where}: logprob ${v} is above 0`);
  return Math.min(v, 0);
}

/**
 * Check that `tokens` are a valid scoring of `text` under the LanguageModel contract:
 * contiguous offsets from 0 to text.length, each token's text equal to its slice, texts
 * concatenating exactly to `text`, logprobs <= 0. Throws an Error naming the first
 * problem; returns the tokens with null logprobs mapped to -Infinity.
 */
export function checkTokenScores(text: string, tokens: unknown): TokenScore[] {
  if (!Array.isArray(tokens)) throw new Error('tokens is not an array');
  const out: TokenScore[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    const where = `token ${i}`;
    if (!isRecord(t)) throw new Error(`${where} is not an object`);
    const { text: tt, start, end } = t;
    if (typeof tt !== 'string' || tt === '') throw new Error(`${where}: text must be a non-empty string`);
    if (typeof start !== 'number' || typeof end !== 'number') throw new Error(`${where}: start and end must be numbers`);
    if (start !== pos) throw new Error(`${where} ${JSON.stringify(tt)} starts at ${start}, expected ${pos}`);
    if (end !== start + tt.length) throw new Error(`${where} ${JSON.stringify(tt)}: end ${end} != start + length ${start + tt.length}`);
    if (text.slice(start, end) !== tt) {
      throw new Error(`${where}: text ${JSON.stringify(tt)} != scored text at ${start}..${end} ${JSON.stringify(text.slice(start, end))}`);
    }
    const score: TokenScore = { text: tt, start, end, logprob: readLogprob(t.logprob, where) };
    if (t.upperBound === true) score.upperBound = true;
    out.push(score);
    pos = end;
  });
  if (pos !== text.length) {
    throw new Error(`tokens cover ${pos} of ${text.length} characters of ${JSON.stringify(text)}`);
  }
  return out;
}

export class HttpLanguageModel implements LanguageModel {
  readonly id: string;
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchLike;
  private readonly g: TimerGlobals;

  constructor(opts: Pick<HttpModelOptions, 'baseUrl'> & Partial<Omit<HttpModelOptions, 'baseUrl'>>) {
    const o = { ...DEFAULT_HTTP_MODEL_OPTIONS, ...stripUndefined(opts) };
    this.baseUrl = o.baseUrl.replace(/\/+$/u, '');
    this.id = o.id ?? `http:${this.baseUrl}`;
    this.timeoutMs = o.timeoutMs;
    this.g = globalThis as unknown as TimerGlobals;
    const f = o.fetch ?? this.g.fetch;
    if (!f) throw new HttpModelError('HttpLanguageModel: no fetch available; pass opts.fetch');
    this.fetchFn = f;
  }

  /** Model name and limits from GET /health. */
  async health(): Promise<HttpModelHealth> {
    const r = await this.call('/health');
    if (!isRecord(r) || typeof r.model !== 'string' || typeof r.n_ctx !== 'number') {
      throw this.bad('/health', 'answer lacks model or n_ctx');
    }
    return {
      ok: r.ok === true,
      model: r.model,
      n_vocab: typeof r.n_vocab === 'number' ? r.n_vocab : 0,
      n_ctx: r.n_ctx,
      start_token: Array.isArray(r.start_token) ? r.start_token.filter((x): x is number => typeof x === 'number') : [],
    };
  }

  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    if (text === '') return [];
    const r = await this.call('/score', { context, text });
    if (!isRecord(r)) throw this.bad('/score', 'answer is not an object');
    try {
      return checkTokenScores(text, r.tokens);
    } catch (e) {
      throw this.bad('/score', errorText(e));
    }
  }

  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    if (k <= 0) return [];
    const r = await this.call('/next', { context, k: Math.floor(k) });
    if (!isRecord(r) || !Array.isArray(r.tokens)) throw this.bad('/next', 'answer lacks a tokens array');
    if (r.tokens.length > k) throw this.bad('/next', `${r.tokens.length} candidates for k = ${k}`);
    const out: TokenCandidate[] = [];
    try {
      r.tokens.forEach((t, i) => {
        if (!isRecord(t) || typeof t.text !== 'string') throw new Error(`candidate ${i} has no text`);
        const logprob = readLogprob(t.logprob, `candidate ${i}`);
        const prev = out[out.length - 1];
        if (prev && logprob > prev.logprob) throw new Error(`candidate ${i} is more likely than candidate ${i - 1}`);
        out.push({ text: t.text, logprob });
      });
    } catch (e) {
      throw this.bad('/next', errorText(e));
    }
    return out;
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    const body = {
      prompt,
      n: opts.n,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      stop: opts.stop ?? [],
      seed: opts.seed ?? 1,
    };
    const r = await this.call('/generate', body);
    if (!isRecord(r) || !Array.isArray(r.texts)) throw this.bad('/generate', 'answer lacks a texts array');
    if (r.texts.length !== opts.n) throw this.bad('/generate', `${r.texts.length} texts for n = ${opts.n}`);
    if (!r.texts.every((t): t is string => typeof t === 'string')) throw this.bad('/generate', 'a text is not a string');
    return r.texts;
  }

  // ---------- transport ----------

  private bad(path: string, problem: string, status?: number): HttpModelError {
    return new HttpModelError(`HttpLanguageModel(${this.baseUrl}) ${path}: ${problem}`, status);
  }

  /** One request with a timeout; resolves to the parsed JSON answer. */
  private async call(path: string, body?: unknown): Promise<unknown> {
    const controller = this.g.AbortController ? new this.g.AbortController() : undefined;
    let timer: unknown;
    const timeout = new Promise<never>((_, reject) => {
      timer = this.g.setTimeout(() => {
        controller?.abort();
        reject(this.bad(path, `no answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([this.exchange(path, body, controller?.signal), timeout]);
    } finally {
      this.g.clearTimeout(timer);
    }
  }

  private async exchange(path: string, body: unknown, signal: unknown): Promise<unknown> {
    const url = this.baseUrl + path;
    let res: FetchResponseLike;
    let raw: string;
    try {
      res = await this.fetchFn(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      });
      raw = await res.text();
    } catch (e) {
      throw this.bad(path, `cannot reach ${url} (${errorText(e)}); is proof/model_server.py running?`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const snippet = raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
      throw this.bad(path, `HTTP ${res.status}, answer is not JSON: ${JSON.stringify(snippet)}`, res.ok ? undefined : res.status);
    }
    if (!res.ok) {
      const msg = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : raw;
      throw this.bad(path, `HTTP ${res.status}: ${msg}`, res.status);
    }
    return parsed;
  }
}

function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
