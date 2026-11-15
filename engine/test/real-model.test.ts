/**
 * The engine against a real model: proof/model_server.py serving a GGUF (normally the
 * recommended Qwen3-1.7B Q4_K_M) over HTTP. Skipped unless CLIFFWORD_MODEL_URL is set;
 * `npm run test:real` sets it. How to start the server: engine/scripts/real-model.md.
 *
 * - the LanguageModel contract against HttpLanguageModel and TopNBoundedModel over it;
 * - parity: sentence totals after the scoring prefix equal the proof's "neutral" totals
 *   (proof/raw_<model>.json, punctuation tokens included) within 0.05 nats;
 * - accuracy: the correct sentence of a proof minimal pair outscores the incorrect one
 *   for at least 95% of the 93 pairs (the proof measured 97% for both models);
 * - an end-to-end judgement and next-word list through the engine's own functions;
 * - with CLIFFWORD_REAL_TOPN=10 (or "5,10,40"): the same pairs under top-N forced
 *   decoding, i.e. llama.rn without a native scoring method.
 *
 * Timings and results are printed with a "[real-model]" prefix.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import raw17 from '../../proof/raw_qwen3-1.7b.json';
import raw4 from '../../proof/raw_qwen3-4b.json';
import { judgeSentence } from '../src/corrections/judge';
import { SPANISH_SCORING_PREFIX } from '../src/lang/es';
import { runLanguageModelContract, type ContractCase } from '../src/model/contract';
import { HttpLanguageModel, type HttpModelHealth } from '../src/model/http';
import { boundedCount, TopNBoundedModel } from '../src/model/topN';
import { totalLogprob, type LanguageModel } from '../src/model/types';
import { createDefaultSpanishPack } from '../src/packs';
import { nextWords } from '../src/scoring/nextWord';
import { scoringContext } from '../src/scoring/context';

interface ProofPair {
  id: number;
  rule: string;
  correct: string;
  incorrect: string;
  /** Totals after "Frase en español:\n": c = correct, i = incorrect. */
  neutral: { c: number; i: number };
}
interface ProofRaw {
  model: string;
  pairs: ProofPair[];
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const BASE_URL = env.CLIFFWORD_MODEL_URL;
const TOPN = (env.CLIFFWORD_REAL_TOPN ?? '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();
const out = (globalThis as unknown as { console: { log(...args: unknown[]): void } }).console;
const log = (...args: unknown[]): void => out.log('[real-model]', ...args);

/** Proof raw files by model file name, as /health reports it. */
const PROOF: Record<string, ProofRaw> = {
  [raw17.model]: raw17 as ProofRaw,
  [raw4.model]: raw4 as ProofRaw,
};
/** The 93 minimal pairs (the same in every raw file). */
const PAIRS: ProofPair[] = (raw17 as ProofRaw).pairs;

/** proof/score.py's NEUTRAL_PREFIX; the parity numbers hold only for this exact text. */
const PREFIX = SPANISH_SCORING_PREFIX;

/**
 * Parity allowance in nats. The server repeats the proof's computation (same start
 * token, same tokenization, same llama.cpp build, batches of at least two tokens) and
 * measured bit-identical totals. 0.05 is far below the 1-nat hint margin, so a failure
 * means something different is being scored (prefix, start token, tokenization, a
 * one-token evaluation path), not rounding.
 */
const PARITY_NATS = 0.05;
/** Accuracy floor: the proof measured 97% (90 of 93) with the prefix; 95% allows two flips. */
const MIN_ACCURACY = 0.95;
/** Margins the engine acts on (DEFAULT_JUDGE_OPTIONS): assert at 3 nats, hint at 1. */
const ASSERT_NATS = 3;
const HINT_NATS = 1;
/** Per-test timeout: 186 sentences at about 0.2 s each, with room for a busy machine. */
const LONG_MS = 600_000;

const CONTRACT_CASES: ContractCase[] = [
  { context: PREFIX, text: 'Mi hermano está enfermo hoy.' },
  { context: PREFIX + 'Ayer fui al mercado y', text: ' compré un ñandú para el árbol.' },
  { context: PREFIX + 'En la playa hacía mucho', text: ' calor.' },
  { context: PREFIX + '¿Dónde', text: ' están las llaves?' },
  { context: '', text: 'Hola, ¿qué tal?' },
];
const CONTRACT_GENERATE = { prompt: PREFIX + 'Había una vez', n: 2, maxTokens: 12, temperature: 0.8, stop: ['\n'], seed: 7 };

describe.skipIf(!BASE_URL)('real model over HTTP', () => {
  const model = new HttpLanguageModel({ baseUrl: BASE_URL ?? 'http://127.0.0.1:8765' });
  let health: HttpModelHealth;
  const exact = new Map<string, number>();
  const exactTotal = async (s: string): Promise<number> => {
    let v = exact.get(s);
    if (v === undefined) {
      v = totalLogprob(await model.scoreContinuation(PREFIX, s));
      exact.set(s, v);
    }
    return v;
  };

  beforeAll(async () => {
    health = await model.health();
    log(`model ${health.model}, n_ctx ${health.n_ctx}, start token ${JSON.stringify(health.start_token)}`);
  }, 30_000);

  runLanguageModelContract('HttpLanguageModel (real)', () => model, {
    cases: CONTRACT_CASES,
    generate: CONTRACT_GENERATE,
    timeoutMs: 120_000,
  });

  runLanguageModelContract('TopNBoundedModel(HttpLanguageModel, n = 10)', () => new TopNBoundedModel(model), {
    cases: CONTRACT_CASES,
    generate: CONTRACT_GENERATE,
    timeoutMs: 120_000,
  });

  it('matches the proof totals after the scoring prefix (parity)', async (ctx) => {
    const proof = PROOF[health.model];
    if (!proof) {
      log(`parity skipped: no proof raw file for ${health.model}`);
      ctx.skip();
      return;
    }
    // The first pair of each rule, both sentences: 18 sentences over all 9 rules.
    const sample = proof.pairs.filter((p, i, all) => all.findIndex((q) => q.rule === p.rule) === i);
    const deltas: number[] = [];
    const t0 = now();
    for (const p of sample) {
      for (const [s, want] of [[p.correct, p.neutral.c], [p.incorrect, p.neutral.i]] as const) {
        const got = await exactTotal(s);
        const d = got - want;
        deltas.push(Math.abs(d));
        expect(Math.abs(d), `${s}: ${got.toFixed(4)} vs proof ${want.toFixed(4)}`).toBeLessThanOrEqual(PARITY_NATS);
      }
    }
    const ms = now() - t0;
    log(
      `parity: ${deltas.length} sentences, max |delta| ${Math.max(...deltas).toExponential(2)} nats, ` +
        `mean ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toExponential(2)}, ${(ms / deltas.length).toFixed(0)} ms per sentence`,
    );
  }, LONG_MS);

  it('prefers the correct sentence in at least 95% of the 93 proof pairs (accuracy)', async () => {
    const t0 = now();
    let right = 0;
    const wrong: string[] = [];
    const margins: number[] = [];
    const proof = PROOF[health.model];
    let maxDelta = 0;
    for (const [i, p] of PAIRS.entries()) {
      const c = await exactTotal(p.correct);
      const w = await exactTotal(p.incorrect);
      margins.push(c - w);
      if (c > w) right++;
      else wrong.push(`${(c - w).toFixed(2)} [${p.rule}] ${p.correct} / *${p.incorrect}*`);
      const q = proof?.pairs[i];
      if (q) maxDelta = Math.max(maxDelta, Math.abs(c - q.neutral.c), Math.abs(w - q.neutral.i));
    }
    const ms = now() - t0;
    const acc = right / PAIRS.length;
    // Flags as the judge would raise them: a learner who wrote the incorrect sentence is
    // caught when the correct variant wins by the margin; one who wrote the correct
    // sentence is falsely flagged when the incorrect variant wins by it.
    const caught = (t: number) => margins.filter((m) => m >= t).length;
    const falseFlags = (t: number) => margins.filter((m) => -m >= t).length;
    log(
      `accuracy ${right}/${PAIRS.length} = ${(100 * acc).toFixed(1)}%; ` +
        `assert (>= ${ASSERT_NATS} nats): ${caught(ASSERT_NATS)} caught, ${falseFlags(ASSERT_NATS)} false; ` +
        `hint (>= ${HINT_NATS}): ${caught(HINT_NATS)} caught, ${falseFlags(HINT_NATS)} false`,
    );
    if (proof) log(`all ${2 * PAIRS.length} sentences vs proof: max |delta| ${maxDelta.toExponential(2)} nats`);
    log(`scored ${2 * PAIRS.length} sentences in ${(ms / 1000).toFixed(1)} s (${(ms / (2 * PAIRS.length)).toFixed(0)} ms each)`);
    for (const w of wrong) log(`  wrong way: ${w}`);
    expect(acc).toBeGreaterThanOrEqual(MIN_ACCURACY);
  }, LONG_MS);

  it('runs the engine end to end: a judgement and a next-word list', async () => {
    const pack = createDefaultSpanishPack();
    const context = scoringContext(pack, '');
    const t0 = now();
    const j = await judgeSentence(model, pack, context, 'Mi hermano es enfermo hoy.');
    const t1 = now();
    const words = await nextWords(model, context + 'En la playa hacía mucho');
    const t2 = now();
    log(
      `judge "Mi hermano es enfermo hoy.": ${j.verdict}, best "${j.best?.text}" margin ${j.margin?.toFixed(2)}, ` +
        `${j.variants.length} variants, ${(t1 - t0).toFixed(0)} ms`,
    );
    log(`next words after "En la playa hacía mucho": ${words.slice(0, 5).map((w) => `${w.word} ${w.prob.toFixed(2)}`).join(', ')}; ${(t2 - t1).toFixed(0)} ms`);
    expect(j.verdict).not.toBe('ok');
    expect(j.best?.text).toBe('Mi hermano está enfermo hoy.');
    expect(words[0]?.word).toBe('calor');
  }, LONG_MS);

  it('times one call of each kind', async () => {
    const time = async (f: () => Promise<unknown>, reps: number): Promise<number> => {
      const t0 = now();
      for (let i = 0; i < reps; i++) await f();
      return (now() - t0) / reps;
    };
    // A fresh sentence each time, so nothing beyond the prefix comes from the cache.
    let i = 0;
    const scoreMs = await time(() => model.scoreContinuation(PREFIX, `Ayer mi hermano y yo fuimos al mercado ${i++} veces.`), 5);
    const nextMs = await time(() => model.nextTokens(PREFIX + `Había una vez un ${i++}`, 20), 5);
    const genMs = await time(() => model.generate(PREFIX + 'Había una vez', { n: 4, maxTokens: 24, temperature: 0.8, seed: 3 }), 1);
    log(`timing: score ${scoreMs.toFixed(0)} ms, nextTokens(k = 20) ${nextMs.toFixed(0)} ms, generate(n = 4, 24 tokens) ${genMs.toFixed(0)} ms`);
    expect(scoreMs).toBeGreaterThan(0);
  }, LONG_MS);

  describe.skipIf(TOPN.length === 0)('top-N forced decoding (CLIFFWORD_REAL_TOPN)', () => {
    for (const n of TOPN) {
      it(`n = ${n}: accuracy, margins and bounded tokens on the 93 pairs`, async () => {
        const bounded: LanguageModel = new TopNBoundedModel(model, { n });
        const t0 = now();
        let right = 0;
        let tokens = 0;
        let boundedTokens = 0;
        let boundedSentences = 0;
        const margins: number[] = [];
        for (const p of PAIRS) {
          const totals: number[] = [];
          for (const s of [p.correct, p.incorrect]) {
            const toks = await bounded.scoreContinuation(PREFIX, s);
            const b = boundedCount(toks);
            tokens += toks.length;
            boundedTokens += b;
            if (b > 0) boundedSentences++;
            const total = totalLogprob(toks);
            // An upper bound never undercuts the exact total.
            expect(total).toBeGreaterThanOrEqual((await exactTotal(s)) - 1e-9);
            totals.push(total);
          }
          const m = (totals[0] as number) - (totals[1] as number);
          margins.push(m);
          if (m > 0) right++;
        }
        const ms = now() - t0;
        const caught = (t: number) => margins.filter((m) => m >= t).length;
        const falseFlags = (t: number) => margins.filter((m) => -m >= t).length;
        log(
          `top-${n}: accuracy ${right}/${PAIRS.length} = ${((100 * right) / PAIRS.length).toFixed(1)}%; ` +
            `bounded tokens ${boundedTokens}/${tokens} (${((100 * boundedTokens) / tokens).toFixed(1)}%), ` +
            `sentences with a bound ${boundedSentences}/${2 * PAIRS.length}; ` +
            `assert: ${caught(ASSERT_NATS)} caught, ${falseFlags(ASSERT_NATS)} false; ` +
            `hint: ${caught(HINT_NATS)} caught, ${falseFlags(HINT_NATS)} false; ${(ms / 1000).toFixed(1)} s`,
        );
        expect(right).toBeGreaterThan(0);
      }, LONG_MS);
    }
  });
});
