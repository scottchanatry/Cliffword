/**
 * The LanguageModel contract as a reusable vitest suite.
 *
 * runLanguageModelContract(name, makeModel, opts) registers one describe block that
 * checks what the engine relies on from any adapter (the mock, TopNBoundedModel, the
 * HTTP model over a real GGUF, and later the llama.rn device adapter):
 * - scoreContinuation: token texts concatenate exactly to the text, offsets are
 *   contiguous and slice back to each token, an empty text gives no tokens;
 * - spacing: a word that follows a space is covered by a token that starts at that
 *   space (the leading-space convention of model/types.ts);
 * - every logprob is <= 0 and not NaN (-Infinity is allowed);
 * - scoreContinuation and nextTokens agree on the first token of the text, within
 *   `tolerance` (a token marked upperBound must only be at least the true value);
 * - nextTokens is sorted, most likely first, and returns at most k candidates;
 * - generate returns n strings without the stop strings, and the same seed gives the
 *   same strings; scoring twice gives the same numbers.
 *
 * The harness holds no language data: callers pass the texts as `cases` (contexts and
 * continuations in the model's language, each continuation starting with a space after
 * a word, as the engine scores them). It imports vitest, so only test files may import it;
 * it is not part of the engine's public API.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { LanguageModel, TokenScore } from './types';

export interface ContractCase {
  /** Text the continuation follows, e.g. a scoring prefix plus a sentence opening. */
  context: string;
  /** Continuation to score; should contain at least one space-separated word. */
  text: string;
}

export interface ContractGenerateCase {
  prompt: string;
  n: number;
  maxTokens: number;
  temperature: number;
  stop: string[];
  seed: number;
}

export interface ContractOptions {
  /** Texts to score. At least one; the harness holds no language data of its own. */
  cases: readonly ContractCase[];
  /**
   * Largest gap, in nats, between scoreContinuation and nextTokens for the same token.
   * 0.01: two calls on the same tokens should agree up to float32 rounding. A larger gap
   * means the calls condition on different tokens, or the runtime computes a one-token
   * evaluation on another kernel path (llama.cpp on CPU moved single tokens by up to 0.28
   * nats that way; proof/model_server.py always evaluates at least two tokens). Exact
   * adapters (the mock) can pass 1e-6.
   */
  tolerance: number;
  /**
   * How many candidates to search for the text's first token when checking agreement.
   * 50: natural continuations of the cases sit well inside the top 50 of a real model
   * (the proof's next-word lists put most of the mass in the top 10).
   */
  agreeK: number;
  /** k values for the sorted / at-most-k check. 0 checks the empty answer. */
  ks: readonly number[];
  /** Generation request; defaults to the first case's context as prompt. */
  generate: Partial<ContractGenerateCase>;
  /**
   * Per-test timeout in ms. 5000 is vitest's default and enough for in-process models;
   * a real model over HTTP needs about a minute for the agreement and generation tests.
   */
  timeoutMs: number;
}

export const DEFAULT_CONTRACT_OPTIONS: Readonly<Omit<ContractOptions, 'cases'>> = {
  tolerance: 0.01,
  agreeK: 50,
  ks: [0, 1, 5, 20],
  // Two short completions at a typical story temperature: enough to see n strings and
  // seeded reproducibility without spending seconds of generation on a real model.
  generate: { n: 2, maxTokens: 8, temperature: 0.8, stop: [], seed: 7 },
  timeoutMs: 5000,
};

/** Leading-space convention: positions where a space is followed by a letter. */
function wordStarts(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < text.length; i++) {
    if (text[i] === ' ' && /\p{L}/u.test(text[i + 1] as string)) out.push(i);
  }
  return out;
}

function expectValidLogprob(lp: number, where: string): void {
  expect(Number.isNaN(lp), `${where}: logprob is NaN`).toBe(false);
  expect(lp, `${where}: logprob ${lp} > 0`).toBeLessThanOrEqual(0);
}

function expectCovers(text: string, toks: readonly TokenScore[], where: string): void {
  expect(toks.map((t) => t.text).join(''), `${where}: token texts`).toBe(text);
  let pos = 0;
  for (const t of toks) {
    expect(t.start, `${where}: ${JSON.stringify(t.text)} start`).toBe(pos);
    expect(t.end, `${where}: ${JSON.stringify(t.text)} end`).toBe(t.start + t.text.length);
    expect(text.slice(t.start, t.end)).toBe(t.text);
    pos = t.end;
  }
  expect(pos, `${where}: covered length`).toBe(text.length);
}

/**
 * Register the contract tests for one model. `makeModel` runs once, before the tests.
 */
export function runLanguageModelContract(
  name: string,
  makeModel: () => LanguageModel | Promise<LanguageModel>,
  opts: Partial<ContractOptions> & Pick<ContractOptions, 'cases'>,
): void {
  const o: ContractOptions = { ...DEFAULT_CONTRACT_OPTIONS, ...opts };
  if (o.cases.length === 0) throw new Error('runLanguageModelContract: pass at least one case');
  const first = o.cases[0] as ContractCase;
  const gen: ContractGenerateCase = {
    ...(DEFAULT_CONTRACT_OPTIONS.generate as Omit<ContractGenerateCase, 'prompt'>),
    prompt: first.context,
    ...o.generate,
  };
  const label = (c: ContractCase) => JSON.stringify(c.context.slice(-24) + '|' + c.text);

  describe(`LanguageModel contract: ${name}`, () => {
    let model: LanguageModel;
    beforeAll(async () => {
      model = await makeModel();
    }, o.timeoutMs);

    it('has an id', () => {
      expect(typeof model.id).toBe('string');
      expect(model.id.length).toBeGreaterThan(0);
    });

    it('scores tokens that concatenate to the text with contiguous offsets', async () => {
      for (const c of o.cases) {
        const toks = await model.scoreContinuation(c.context, c.text);
        expect(toks.length, label(c)).toBeGreaterThan(0);
        expectCovers(c.text, toks, label(c));
      }
      expect(await model.scoreContinuation(first.context, '')).toEqual([]);
    }, o.timeoutMs);

    it('puts the leading space on the token that starts a word', async () => {
      let checked = 0;
      for (const c of o.cases) {
        const toks = await model.scoreContinuation(c.context, c.text);
        for (const p of wordStarts(c.text)) {
          const tok = toks.find((t) => t.start === p);
          expect(tok, `${label(c)}: no token starts at the space before offset ${p + 1}`).toBeDefined();
          expect(tok!.end, `${label(c)}: the space at ${p} is a token of its own`).toBeGreaterThan(p + 1);
          checked++;
        }
      }
      expect(checked, 'cases contain no space-separated word').toBeGreaterThan(0);
    }, o.timeoutMs);

    it('returns logprobs <= 0', async () => {
      for (const c of o.cases) {
        for (const t of await model.scoreContinuation(c.context, c.text)) {
          expectValidLogprob(t.logprob, `${label(c)} ${JSON.stringify(t.text)}`);
        }
        for (const t of await model.nextTokens(c.context, 10)) {
          expectValidLogprob(t.logprob, `${label(c)} next ${JSON.stringify(t.text)}`);
        }
      }
    }, o.timeoutMs);

    it('agrees between scoreContinuation and nextTokens on the first token', async () => {
      let matched = 0;
      for (const c of o.cases) {
        const list = await model.nextTokens(c.context, o.agreeK);
        // The text's own first token, if the list holds it.
        const firstTok = (await model.scoreContinuation(c.context, c.text))[0] as TokenScore;
        const cand = list.find((x) => x.text === firstTok.text);
        if (cand) {
          if (firstTok.upperBound) expect(firstTok.logprob).toBeGreaterThanOrEqual(cand.logprob - o.tolerance);
          else expect(Math.abs(firstTok.logprob - cand.logprob), label(c)).toBeLessThanOrEqual(o.tolerance);
          matched++;
        }
        // The most likely candidate, scored as a text. A candidate whose text the model
        // tokenizes differently on its own (several tokens) cannot be compared.
        const top = list[0];
        if (!top) continue;
        const scored = await model.scoreContinuation(c.context, top.text);
        if (scored.length === 1) {
          const s = scored[0] as TokenScore;
          expect(s.upperBound ?? false, `${label(c)}: the top candidate is bounded`).toBe(false);
          expect(Math.abs(s.logprob - top.logprob), `${label(c)} top ${JSON.stringify(top.text)}`).toBeLessThanOrEqual(o.tolerance);
          matched++;
        }
      }
      expect(matched, 'no first token could be compared').toBeGreaterThan(0);
    }, o.timeoutMs);

    it('returns next tokens sorted, most likely first, at most k', async () => {
      for (const k of o.ks) {
        const list = await model.nextTokens(first.context, k);
        expect(list.length).toBeLessThanOrEqual(k);
        if (k > 0) expect(list.length).toBeGreaterThan(0);
        for (let i = 1; i < list.length; i++) {
          expect(list[i]!.logprob).toBeLessThanOrEqual(list[i - 1]!.logprob);
        }
        for (const t of list) expect(typeof t.text).toBe('string');
      }
    }, o.timeoutMs);

    it('generates n strings without the stop strings', async () => {
      const texts = await model.generate(gen.prompt, gen);
      expect(texts).toHaveLength(gen.n);
      for (const t of texts) {
        expect(typeof t).toBe('string');
        for (const s of gen.stop) if (s) expect(t.includes(s), `${JSON.stringify(t)} contains ${JSON.stringify(s)}`).toBe(false);
      }
    }, o.timeoutMs);

    it('is deterministic: same seed, same completions; same text, same scores', async () => {
      const a = await model.generate(gen.prompt, gen);
      const b = await model.generate(gen.prompt, gen);
      expect(b).toEqual(a);
      const c = o.cases[o.cases.length - 1] as ContractCase;
      const s1 = await model.scoreContinuation(c.context, c.text);
      const s2 = await model.scoreContinuation(c.context, c.text);
      expect(s2.map((t) => t.text)).toEqual(s1.map((t) => t.text));
      s1.forEach((t, i) => expect(Math.abs(s2[i]!.logprob - t.logprob)).toBeLessThanOrEqual(o.tolerance));
    }, o.timeoutMs);
  });
}
