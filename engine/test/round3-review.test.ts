/**
 * Regressions for the round-3 review (story generation, corrections, answer speed and
 * session robustness): language neutrality of the new generation code, the pack's
 * abbreviations outside story/, and session interleavings around prefetch and busy steps.
 * Module-level regressions live next to their modules (story/next.test.ts,
 * session/handover.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEXT_SENTENCE_TUNING,
  LearnerModel,
  StorySession,
  createDefaultPairPack,
  createMockModel,
  createDefaultSpanishPack,
  frequencyLexemeKeys,
  generateNextSentence,
  sameOpening,
  selectSentence,
  splitTextUnits,
} from '../src';
import type { DifficultyParams, GenerateOptions, LanguageModel, LanguagePack, Segment, TokenCandidate, TokenScore } from '../src';

/** The engine's lib is ES2022 only; vitest runs on Node, which has a timer. */
const tick = (): Promise<void> => new Promise((r) => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 0));

const es = createDefaultSpanishPack();
const pair = createDefaultPairPack();

/** A caseless toy pack written without spaces: greedy longest match over a small dictionary. */
const JA_WORDS: Record<string, string> = {
  私: 'PRON', は: 'ADP', が: 'ADP', を: 'ADP', も: 'ADP', で: 'AUX', です: 'AUX', ます: 'AUX',
  猫: 'NOUN', 犬: 'NOUN', 本: 'NOUN', 好き: 'ADJ', 読み: 'VERB', 学校: 'NOUN',
};
function jaSegment(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let len = 0;
    for (const w of Object.keys(JA_WORDS)) if (text.startsWith(w, i) && w.length > len) len = w.length;
    const piece = len ? text.slice(i, i + len) : (text[i] as string);
    const kind = len ? 'word' : /\s/u.test(piece) ? 'space' : 'punct';
    out.push({ text: piece, norm: kind === 'word' ? piece : piece, start: i, end: i + piece.length, kind } as Segment);
    i += piece.length;
  }
  return out;
}
const ja: LanguagePack = {
  code: 'ja',
  segment: jaSegment,
  normalize: (w) => w,
  analyze: (n) => (JA_WORDS[n] ? [{ lemma: n, pos: JA_WORDS[n] as never, features: {} }] : []),
  inflect: (l) => l,
  frequencyRank: (l) => (JA_WORDS[l] ? Object.keys(JA_WORDS).indexOf(l) + 1 : undefined),
  frequencyList: Object.keys(JA_WORDS),
  rules: [],
  registers: [],
  scoringPrefix: '日本語の文:\n',
};
const params: DifficultyParams = {
  sentenceWords: { min: 3, max: 10 }, knownBand: { min: 0.95, max: 0.98 }, newWordsPerSentence: 1,
  speechRate: 1, cliffWords: 1, tileThreshold: 0.85,
};

/** Records generate options; returns the given completions. */
class Recorder implements LanguageModel {
  readonly id = 'recorder';
  readonly options: GenerateOptions[] = [];
  constructor(private readonly out: string[]) {}
  async scoreContinuation(_c: string, text: string): Promise<TokenScore[]> {
    return [{ text, start: 0, end: text.length, logprob: -2 }];
  }
  async nextTokens(): Promise<TokenCandidate[]> {
    return [];
  }
  async generate(_p: string, o: GenerateOptions): Promise<string[]> {
    this.options.push(o);
    return Array.from({ length: o.n }, (_, i) => this.out[i % this.out.length] as string);
  }
}

describe('generation stop strings are pack data', () => {
  it('a pack without story data stops at a line break; Spanish stops at its sentence ends; tuning.stop wins', async () => {
    expect(DEFAULT_NEXT_SENTENCE_TUNING.stop).toEqual(['\n']);
    const learner = new LearnerModel({ prior: () => 0.97 });
    const base = { story: ['猫が好きです。'], targets: ['ja:本'], params, now: 0, seed: 1, tuning: { retry: false, naturalTop: 0 } };
    const m1 = new Recorder(['私は本を読みます。']);
    await generateNextSentence(m1, { pack: ja, learner }, base);
    expect(m1.options[0]?.stop).toEqual(['\n']);
    const m2 = new Recorder(['Marta compró pan.']);
    await generateNextSentence(m2, { pack: es, learner, pair }, { ...base, story: ['Marta llegó.'], targets: ['es:pan'] });
    expect(m2.options[0]?.stop).toEqual(es.story?.stop);
    expect(es.story?.stop).toContain('. ');
    const m3 = new Recorder(['Marta compró pan.']);
    await generateNextSentence(m3, { pack: es, learner, pair }, { ...base, story: ['Marta llegó.'], targets: ['es:pan'], tuning: { ...base.tuning, stop: ['\n\n'] } });
    expect(m3.options[0]?.stop).toEqual(['\n\n']);
  });
});

describe('selection rejects count words through the pack, never by spaces', () => {
  const learner = new LearnerModel({ prior: () => 0.97 });
  const ctx = { pack: ja, learner, now: 0, targets: [], params, previous: [] };

  it('a caseless sentence cut at its stop string is not a heading', () => {
    // The runtime cuts the stop string, so the raw completion ends without "。".
    const sel = selectSentence([{ text: '私は本を読みます。', raw: '私は本を読みます' }], ctx);
    expect(sel.ranked[0]?.rejected).not.toContain('heading');
  });

  it('a sentence with several ideographic commas between multi-word pieces is not a list', () => {
    const sel = selectSentence(['私は、猫が好きで、犬も好きで、本も読みます。'], ctx);
    expect(sel.ranked[0]?.rejected).not.toContain('list');
    // A real list of single words still is.
    expect(selectSentence(['猫、犬、本、学校。'], ctx).ranked[0]?.rejected).toContain('list');
  });

  it('still rejects a short capitalized title and an all-capitals line in a cased script', () => {
    const esCtx = { pack: es, learner, now: 0, targets: [], params, previous: [] };
    expect(selectSentence([{ text: 'El Viejo Mercado.', raw: 'El Viejo Mercado' }], esCtx).ranked[0]?.rejected).toContain('heading');
    expect(selectSentence([{ text: 'CAPÍTULO UNO.', raw: 'CAPÍTULO UNO' }], esCtx).ranked[0]?.rejected).toContain('heading');
  });
});

describe("the pack's abbreviations outside story/", () => {
  it('brought text keeps "Sr. García" in one sentence', () => {
    const units = splitTextUnits(es, 'Vi al Sr. García en la plaza. Luego comimos juntos.');
    expect(units.map((u) => u.text)).toEqual(['Vi al Sr. García en la plaza.', 'Luego comimos juntos.']);
  });

});

describe('StorySession: prefetch interleavings', () => {
  const KEYS = frequencyLexemeKeys(es);
  const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
  function early(): LearnerModel {
    const known = new Set(KEYS.slice(0, 400));
    const l = new LearnerModel({ prior: (key) => (known.has(key) ? 0.97 : 0.002) });
    l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
    return l;
  }
  /** The mock, counting calls and the most running at once (shared across instances via `shared`). */
  function counting(shared: { inflight: number; max: number; calls: number }): LanguageModel {
    const mock = createMockModel();
    const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
      shared.calls += 1;
      shared.inflight += 1;
      shared.max = Math.max(shared.max, shared.inflight);
      try {
        await tick();
        return await fn();
      } finally {
        shared.inflight -= 1;
      }
    };
    return {
      id: 'counting',
      scoreContinuation: (c, t) => wrap(() => mock.scoreContinuation(c, t)),
      nextTokens: (c, k) => wrap(() => mock.nextTokens(c, k)),
      generate: (p, o) => wrap(() => mock.generate(p, o)),
    };
  }

  // Review regression (round 3): the spoken "siguiente" (command 'next', also through
  // handleUtterance) moved on without waiting for the prefetch, asking the model again
  // for what the prefetch was already asking.
  it('the "next" command replays a prefetch like next() does', async () => {
    const stats = { inflight: 0, max: 0, calls: 0 };
    const s = StorySession.create({ model: counting(stats), pack: es, pair, learner: early(), now: T0, seed: 21 });
    const plain = StorySession.create({ model: counting({ inflight: 0, max: 0, calls: 0 }), pack: es, pair, learner: early(), now: T0, seed: 21 });
    const pre = s.prefetch(T0 + 1000);
    // The learner says "siguiente" while the prefetch still runs.
    const step = await s.command('next', T0 + 1000);
    const info = await pre;
    expect(info.prepared).toBe(true);
    expect(step.screen.kind).toBe('cliff');
    expect(stats.calls).toBe(info.modelCalls);
    expect(s.modelStats.calls).toBe(info.modelCalls);
    // The same step as without prefetch.
    const ref = await plain.command('next', T0 + 1000);
    expect(step.screen).toEqual(ref.screen);
  });

  // Review regression (round 3): setModel during a running prefetch gave the session a new
  // gate while the prefetch still called the model through the old one, so the two could
  // overlap on a runtime with one context.
  it('model calls never overlap when setModel replaces the model while a prefetch runs', async () => {
    const stats = { inflight: 0, max: 0, calls: 0 };
    const s = StorySession.create({ model: counting(stats), pack: es, pair, learner: early(), now: T0, seed: 22 });
    expect((await s.next(T0 + 1000)).screen.kind).toBe('cliff');
    const pre = s.prefetch(T0 + 3000);
    await tick();
    s.setModel(counting(stats));
    // An answer scored by the new model while the prefetch still runs on the old one.
    const step = await s.handleUtterance('zzz', T0 + 2000);
    await pre;
    expect(step.screen.kind).toBe('landing');
    expect(stats.max).toBe(1);
  });
});

// Review regression (round 3): the copied-opening reject (sameOpening) threw out every
// sentence that started with the advanced story's character, "El señor de las frutas", a
// five-word subject: two of eight real-model steps ended with no sentence
// (proof/engine-measure/results/generation-after.json, advanced, steps 5 and 6).
describe('sameOpening: a copied frame needs the verb, a shared subject is not one', () => {
  const learner = new LearnerModel({ prior: () => 0.97 });
  const p8: DifficultyParams = { ...params, sentenceWords: { min: 4, max: 14 } };
  const reject = (text: string, previous: string[]) =>
    selectSentence([text], { pack: es, learner, now: 0, targets: [], params: p8, previous }).ranked[0]?.rejected ?? [];

  it('keeps sentences that only share their subject with a recent one', () => {
    const previous = ['Se puso de pie y empezó a leer la nota en voz alta.', 'El señor de las frutas se acercó lentamente.'];
    for (const text of [
      'El señor de las frutas le pidió un vaso de agua.',
      'El señor de las frutas le puso una fruta en la mano.',
      'El señor de las frutas se puso de pie y se fue.',
    ]) {
      expect(reject(text, previous), text).not.toContain('repeat');
    }
    expect(sameOpening('El señor de las frutas le pidió agua.', previous, es, 3, 2)).toBe(true);
    expect(sameOpening('El señor de las frutas le pidió agua.', previous, es, 3, 2, undefined, ['VERB', 'AUX'])).toBe(false);
  });

  it('still rejects the frames the check was written for', () => {
    expect(reject('El hombre es el único.', ['El hombre es el nacional.'])).toContain('repeat');
    expect(reject('El hombre es el día.', ['El viejo está en la casa.', 'El hombre es el claro.'])).toContain('repeat');
    expect(reject('El señor de las frutas se acercó a Marta.', ['El señor de las frutas se acercó lentamente.'])).toContain('repeat');
  });
});
