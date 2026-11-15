import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import { DEFAULT_NEXT_SENTENCE_TUNING, generateNextSentence, maxTokensFor, targetWordsFromKeys } from './next';
import type { NextSentenceDeps, NextSentenceOptions } from './next';
import { SPANISH_PROMPT_TEXT } from './prompt';
import {
  CountingModel,
  STUB_FORMS,
  ScriptedModel,
  createStubPack,
  createStubPair,
  learnerKnowing,
  stubParams,
} from './testStubs';

const pack = createStubPack();
const pair = createStubPair();
const ALL_LEMMAS = [...new Set(STUB_FORMS.flatMap((f) => pack.analyze(f).map((a) => a.lemma)))];
/** Knows everything at 0.97 (inside the 0.95..0.98 band), including words the stub pack lacks. */
const fluent = learnerKnowing(ALL_LEMMAS, 0.97, 0.97);
/** Knows nothing: no candidate can reach the band. */
const brandNew = learnerKnowing([], 0.1, 0.1);
/** Knows the stub lexicon only; anything else is unknown. */
const early = learnerKnowing(ALL_LEMMAS, 0.97, 0);

const STORY = ['Marta llegó tarde al mercado.'];

function opts(over: Partial<NextSentenceOptions> = {}): NextSentenceOptions {
  return { story: STORY, targets: ['es:comprar'], params: stubParams(), now: 5_000, seed: 7, ...over };
}

function deps(learner = fluent, withPair = true): NextSentenceDeps {
  return withPair ? { pack, learner, pair } : { pack, learner };
}

describe('generateNextSentence with the mock model', () => {
  it('is reproducible with the same seed', async () => {
    const a = await generateNextSentence(createMockModel(), deps(), opts());
    const b = await generateNextSentence(createMockModel(), deps(), opts());
    expect(a).toEqual(b);
    expect(a.sentence).not.toBeNull();
  });

  it('is reproducible after a retry too', async () => {
    const a = await generateNextSentence(createMockModel(), deps(brandNew), opts());
    const b = await generateNextSentence(createMockModel(), deps(brandNew), opts());
    expect(a.diagnostics.retried).toBe(true);
    expect(a).toEqual(b);
  });

  it('samples different candidates with a different seed', async () => {
    const a = await generateNextSentence(createMockModel(), deps(), opts({ seed: 7 }));
    const b = await generateNextSentence(createMockModel(), deps(), opts({ seed: 1007 }));
    expect(a.diagnostics.rounds[0]?.raw).not.toEqual(b.diagnostics.rounds[0]?.raw);
  });

  it('makes one model call when a candidate lands in the band', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(), opts());
    expect(model.generateCalls).toBe(1);
    expect(model.totalCalls).toBe(1);
    expect(r.diagnostics.modelCalls).toBe(1);
    expect(r.diagnostics.retried).toBe(false);
    expect(r.diagnostics.inBand).toBe(true);
    expect(r.best?.inBand).toBe(true);
    expect(r.ranked).toHaveLength(DEFAULT_NEXT_SENTENCE_TUNING.n);
  });

  it('retries once with a simpler prompt and new seeds when nothing is in the band', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(brandNew), opts());
    expect(model.generateCalls).toBe(2);
    expect(r.diagnostics.modelCalls).toBe(2);
    expect(r.diagnostics.retried).toBe(true);
    const n = DEFAULT_NEXT_SENTENCE_TUNING.n;
    expect(model.generateOptions.map((o) => o.seed)).toEqual([7, 7 + n]);
    expect(model.generateOptions[1]?.temperature).toBe(DEFAULT_NEXT_SENTENCE_TUNING.retryTemperature);
    expect(model.prompts[0]).toContain(SPANISH_PROMPT_TEXT.task);
    expect(model.prompts[1]).toContain(SPANISH_PROMPT_TEXT.taskSimple);
    expect(r.diagnostics.rounds.map((x) => x.simple)).toEqual([false, true]);
    // Both rounds are ranked together; there is still a next sentence at zero knowledge.
    expect(r.ranked).toHaveLength(2 * n);
    expect(r.diagnostics.candidateRound).toEqual([...Array(n).fill(0), ...Array(n).fill(1)]);
    expect(r.sentence).not.toBeNull();
    expect(r.diagnostics.inBand).toBe(false);
  });

  it('does not retry when retry is off', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(brandNew), opts({ tuning: { retry: false } }));
    expect(model.generateCalls).toBe(1);
    expect(r.diagnostics.modelCalls).toBe(1);
    expect(r.diagnostics.retried).toBe(false);
  });

  it('passes the prompt, length budget, stop and seed to the model', async () => {
    const model = new CountingModel(createMockModel());
    await generateNextSentence(model, deps(), opts({ tuning: { n: 3 } }));
    const prompt = model.prompts[0] ?? '';
    expect(prompt).toContain('Marta llegó tarde al mercado.');
    expect(prompt).toContain('Usa la palabra comprar.');
    expect(prompt).toContain('8 palabras como máximo');
    expect(model.generateOptions[0]).toEqual({ n: 3, maxTokens: 8 * 2 + 8, temperature: 0.8, stop: ['\n'], seed: 7 });
  });

  it('uses given target surface words, register and region', async () => {
    const model = new CountingModel(createMockModel());
    await generateNextSentence(model, deps(), opts({ targetWords: ['compró'], register: 'street', region: 'PR' }));
    expect(model.prompts[0]).toContain('Usa la palabra compró.');
    expect(model.prompts[0]).toContain('calle de Puerto Rico');
  });

  it('starts a story from nothing', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(), opts({ story: [] }));
    expect(model.prompts[0]?.endsWith(SPANISH_PROMPT_TEXT.firstLabel)).toBe(true);
    expect(r.sentence).not.toBeNull();
  });
});

describe('generateNextSentence with scripted outputs', () => {
  it('cleans messy outputs and selects the in-band one', async () => {
    const model = new ScriptedModel([
      ['Marta compró bicicletas, zanahorias y berenjenas.', 'Oración: "Marta compró pan." (Marta bought bread)'],
    ]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 2 } }));
    expect(r.sentence).toBe('Marta compró pan.');
    expect(r.best?.targetsHit).toEqual(['es:comprar']);
    expect(r.diagnostics.rounds[0]?.cleaned).toEqual(['Marta compró bicicletas, zanahorias y berenjenas.', 'Marta compró pan.']);
    expect(model.calls).toBe(1);
    expect(r.diagnostics.modelCalls).toBe(1);
  });

  it('takes the retry candidate when only the simpler round reaches the band', async () => {
    const model = new ScriptedModel([
      ['Marta compró bicicletas y zanahorias.', 'Marta vio berenjenas.'],
      ['Marta compró pan en el mercado.', 'Marta compró berenjenas.'],
    ]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 2 } }));
    expect(model.calls).toBe(2);
    expect(r.diagnostics.modelCalls).toBe(2);
    expect(r.sentence).toBe('Marta compró pan en el mercado.');
    expect(r.diagnostics.candidateRound[r.best?.index ?? -1]).toBe(1);
  });

  it('returns no sentence when every candidate is rejected', async () => {
    const model = new ScriptedModel([['I bought bread.', 'Oración:', 'Marta llegó tarde al mercado.']]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 3 } }));
    expect(r.sentence).toBeNull();
    expect(r.best).toBeNull();
    expect(r.diagnostics.modelCalls).toBe(2);
    const reasons = r.ranked.slice(0, 3).map((e) => e.rejected[0]);
    expect(reasons).toEqual(['native_words', 'empty', 'repeat']);
  });

  it('rejects candidates that echo the prompt', async () => {
    const model = new ScriptedModel([['Usa palabras sencillas y habla en español neutro.', 'Marta compró pan.']]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 2 } }));
    expect(r.ranked.find((e) => e.index === 0)?.rejected).toContain('prompt_leak');
    expect(r.sentence).toBe('Marta compró pan.');
  });

  it('cuts a trailing English gloss when a pair pack is given', async () => {
    const model = new ScriptedModel([['Marta compró pan Marta bought bread']]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 1 } }));
    expect(r.sentence).toBe('Marta compró pan.');
  });

  it('checks repeats against recent story sentences only', async () => {
    const story = ['Marta compró pan.', 'Volvió a casa.', 'Su amiga la esperaba en la puerta.'];
    const model = new ScriptedModel([['Marta compró pan.']]);
    const recent = await generateNextSentence(model, deps(early), opts({ story, tuning: { n: 1, previousSentences: 3 } }));
    expect(recent.ranked[0]?.rejected).toContain('repeat');
    const old = await generateNextSentence(new ScriptedModel([['Marta compró pan.']]), deps(early), opts({ story, tuning: { n: 1, previousSentences: 2 } }));
    expect(old.ranked[0]?.rejected).not.toContain('repeat');
  });
});

describe('next helpers', () => {
  it('targetWordsFromKeys takes the lemma part of lexeme and form keys', () => {
    expect(targetWordsFromKeys(['es:comprar', 'es:tener#tense=pret', "es:'tá", 'raw'])).toEqual(['comprar', 'tener', "'tá", 'raw']);
  });

  it('maxTokensFor', () => {
    expect(maxTokensFor(8, { tokensPerWord: 2, extraTokens: 8 })).toBe(24);
    expect(maxTokensFor(7.4, { tokensPerWord: 1.5, extraTokens: 0 })).toBe(11);
    expect(maxTokensFor(0, { tokensPerWord: 2, extraTokens: 1 })).toBe(3);
  });
});
