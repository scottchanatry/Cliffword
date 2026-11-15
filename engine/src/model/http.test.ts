import { describe, expect, it } from 'vitest';
import { runLanguageModelContract } from './contract';
import { checkTokenScores, HttpLanguageModel, HttpModelError, type FetchLike, type FetchResponseLike } from './http';
import { createMockModel } from './mock';
import type { LanguageModel } from './types';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const respond = (status: number, body: unknown): FetchResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** A fake proof/model_server.py in process: the same endpoints, answered by `lm`. */
function fakeServer(lm: LanguageModel, sent: Sent[] = []): FetchLike {
  return async (url, init) => {
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    sent.push({ url, method: init.method, headers: init.headers, body });
    const path = url.replace(/^https?:\/\/[^/]+/u, '');
    const b = body ?? {};
    // JSON.stringify writes -Infinity as null, as the Python server does.
    if (path === '/score') return respond(200, { tokens: await lm.scoreContinuation(String(b.context ?? ''), String(b.text)) });
    if (path === '/next') return respond(200, { tokens: await lm.nextTokens(String(b.context ?? ''), Number(b.k)) });
    if (path === '/generate') {
      const texts = await lm.generate(String(b.prompt), {
        n: Number(b.n), maxTokens: Number(b.maxTokens), temperature: Number(b.temperature),
        stop: b.stop as string[], seed: Number(b.seed),
      });
      return respond(200, { texts });
    }
    if (path === '/health') return respond(200, { ok: true, model: 'mock.gguf', n_vocab: 3, n_ctx: 2048, start_token: [7] });
    return respond(404, { error: `unknown path ${path}` });
  };
}

/** A fake that always answers `body` with `status`. */
const fixed = (status: number, body: unknown): FetchLike => async () => respond(status, body);

const model = (fetch: FetchLike, timeoutMs?: number) =>
  new HttpLanguageModel({ baseUrl: 'http://127.0.0.1:8765/', fetch, ...(timeoutMs ? { timeoutMs } : {}) });

// The whole contract through the HTTP client, against the mock behind a fake server.
runLanguageModelContract('HttpLanguageModel(fake server over mock)', () => model(fakeServer(createMockModel())), {
  cases: [
    { context: 'Marta llegó tarde al', text: ' mercado.' },
    { context: 'Estoy', text: ' muy cansado.' },
  ],
  tolerance: 1e-6,
  generate: { prompt: 'Marta', stop: ['.'] },
});

describe('HttpLanguageModel', () => {
  it('posts JSON to the endpoints under baseUrl and returns the answers', async () => {
    const sent: Sent[] = [];
    const m = model(fakeServer(createMockModel(), sent));
    expect(m.id).toBe('http:http://127.0.0.1:8765');
    const toks = await m.scoreContinuation('Estoy', ' muy cansado.');
    expect(toks.map((t) => t.text).join('')).toBe(' muy cansado.');
    await m.nextTokens('Estoy', 3);
    await m.generate('Marta', { n: 2, maxTokens: 5, temperature: 0.5 });
    expect(sent.map((s) => [s.method, s.url])).toEqual([
      ['POST', 'http://127.0.0.1:8765/score'],
      ['POST', 'http://127.0.0.1:8765/next'],
      ['POST', 'http://127.0.0.1:8765/generate'],
    ]);
    expect(sent[0]!.headers['content-type']).toBe('application/json');
    expect(sent[0]!.body).toEqual({ context: 'Estoy', text: ' muy cansado.' });
    expect(sent[1]!.body).toEqual({ context: 'Estoy', k: 3 });
    // No stop list means none; no seed means seed 1, as the mock, so calls reproduce.
    expect(sent[2]!.body).toEqual({ prompt: 'Marta', n: 2, maxTokens: 5, temperature: 0.5, stop: [], seed: 1 });
  });

  it('takes its id from the options', () => {
    expect(new HttpLanguageModel({ baseUrl: 'http://x', id: 'qwen3-1.7b', fetch: fixed(200, {}) }).id).toBe('qwen3-1.7b');
  });

  it('reads /health with GET', async () => {
    const sent: Sent[] = [];
    const h = await model(fakeServer(createMockModel(), sent)).health();
    expect(h).toEqual({ ok: true, model: 'mock.gguf', n_vocab: 3, n_ctx: 2048, start_token: [7] });
    expect(sent[0]!.method).toBe('GET');
  });

  it('skips the request for an empty text or k <= 0', async () => {
    const sent: Sent[] = [];
    const m = model(fakeServer(createMockModel(), sent));
    expect(await m.scoreContinuation('Estoy', '')).toEqual([]);
    expect(await m.nextTokens('Estoy', 0)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('maps a null logprob to -Infinity', async () => {
    const m = model(fixed(200, { tokens: [{ text: ' a', start: 0, end: 2, logprob: null }] }));
    expect((await m.scoreContinuation('', ' a'))[0]!.logprob).toBe(-Infinity);
    const n = model(fixed(200, { tokens: [{ text: ' a', logprob: -1 }, { text: ' b', logprob: null }] }));
    expect((await n.nextTokens('', 2)).map((t) => t.logprob)).toEqual([-1, -Infinity]);
  });

  describe('rejects answers that break the contract', () => {
    const tok = (text: string, start: number, end: number, logprob = -1) => ({ text, start, end, logprob });
    const cases: [string, unknown, RegExp][] = [
      ['texts that do not concatenate', { tokens: [tok(' a', 0, 2), tok('x', 2, 3)] }, /\/score: token 1: text "x" != scored text/],
      ['a gap in the offsets', { tokens: [tok(' a', 0, 2), tok('b', 3, 4)] }, /token 1 "b" starts at 3, expected 2/],
      ['an end that does not match the length', { tokens: [tok(' ab', 0, 2)] }, /end 2 != start \+ length 3/],
      ['tokens that stop short', { tokens: [tok(' a', 0, 2)] }, /tokens cover 2 of 3 characters/],
      ['a positive logprob', { tokens: [tok(' ab', 0, 3, 0.5)] }, /logprob 0.5 is above 0/],
      ['a missing tokens array', { error: 'nope' }, /tokens is not an array/],
    ];
    for (const [what, answer, re] of cases) {
      it(what, async () => {
        const err = await model(fixed(200, answer)).scoreContinuation('', ' ab').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(HttpModelError);
        expect((err as Error).message).toMatch(re);
        expect((err as Error).message).toContain('HttpLanguageModel(http://127.0.0.1:8765)');
      });
    }

    it('unsorted or too many next tokens', async () => {
      const unsorted = { tokens: [{ text: 'a', logprob: -2 }, { text: 'b', logprob: -1 }] };
      await expect(model(fixed(200, unsorted)).nextTokens('', 2)).rejects.toThrow(/candidate 1 is more likely than candidate 0/);
      await expect(model(fixed(200, unsorted)).nextTokens('', 1)).rejects.toThrow(/2 candidates for k = 1/);
    });

    it('the wrong number of generated texts', async () => {
      await expect(model(fixed(200, { texts: ['a'] })).generate('', { n: 2, maxTokens: 1, temperature: 0 })).rejects.toThrow(
        /\/generate: 1 texts for n = 2/,
      );
      await expect(model(fixed(200, { texts: [1, 2] })).generate('', { n: 2, maxTokens: 1, temperature: 0 })).rejects.toThrow(
        /a text is not a string/,
      );
    });
  });

  it('reports the server error and status of a failed call', async () => {
    const err = await model(fixed(400, { error: "'text' must be a string" })).scoreContinuation('', ' a').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpModelError);
    expect((err as HttpModelError).status).toBe(400);
    expect((err as Error).message).toMatch(/\/score: HTTP 400: 'text' must be a string/);
  });

  it('reports an answer that is not JSON', async () => {
    await expect(model(fixed(502, '<html>Bad gateway</html>')).nextTokens('', 1)).rejects.toThrow(
      /HTTP 502, answer is not JSON: "<html>Bad gateway<\/html>"/,
    );
  });

  it('says how to start the server when it cannot be reached', async () => {
    const refused: FetchLike = async () => {
      throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:8765') });
    };
    await expect(model(refused).nextTokens('', 1)).rejects.toThrow(
      /cannot reach http:\/\/127\.0\.0\.1:8765\/next \(fetch failed: connect ECONNREFUSED 127\.0\.0\.1:8765\); is proof\/model_server\.py running\?/,
    );
  });

  it('gives up after timeoutMs and aborts the request', async () => {
    let signal: { aborted?: boolean } | undefined;
    const hang: FetchLike = (_url, init) => {
      signal = init.signal as { aborted?: boolean };
      return new Promise(() => {});
    };
    await expect(model(hang, 20).nextTokens('', 1)).rejects.toThrow(/\/next: no answer within 20 ms/);
    expect(signal?.aborted).toBe(true);
  });
});

describe('checkTokenScores', () => {
  it('accepts a valid scoring and keeps an upperBound flag', () => {
    const toks = checkTokenScores(' ab', [
      { text: ' a', start: 0, end: 2, logprob: -1 },
      { text: 'b', start: 2, end: 3, logprob: -2, upperBound: true },
    ]);
    expect(toks).toEqual([
      { text: ' a', start: 0, end: 2, logprob: -1 },
      { text: 'b', start: 2, end: 3, logprob: -2, upperBound: true },
    ]);
  });

  it('counts offsets in UTF-16 code units, as JavaScript strings do', () => {
    const text = ' 🙂 ñ';
    expect(() =>
      checkTokenScores(text, [
        { text: ' 🙂', start: 0, end: 3, logprob: -3 },
        { text: ' ñ', start: 3, end: 5, logprob: -1 },
      ]),
    ).not.toThrow();
  });

  it('rejects an empty token', () => {
    expect(() => checkTokenScores('', [{ text: '', start: 0, end: 0, logprob: 0 }])).toThrow(/non-empty string/);
  });
});
