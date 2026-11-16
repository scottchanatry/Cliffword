import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import {
  DEFAULT_NEXT_SENTENCE_TUNING,
  generateNextSentence,
  knownLexemeCount,
  maxTokensFor,
  storyNames,
  targetWordsFromKeys,
  vocabularyFor,
} from './next';
import type { NextSentenceDeps, NextSentenceOptions } from './next';
import {
  CountingModel,
  STUB_FORMS,
  ScriptedModel,
  createStubPack,
  createStubPair,
  learnerKnowing,
  stubLearner,
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
const N = DEFAULT_NEXT_SENTENCE_TUNING.n;

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

  it('is reproducible after the safe round too', async () => {
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

  it('makes one generate call, plus at most naturalTop scoring calls, when a candidate lands in the band', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(), opts());
    expect(model.generateCalls).toBe(1);
    expect(model.scoreCalls).toBeLessThanOrEqual(DEFAULT_NEXT_SENTENCE_TUNING.naturalTop);
    expect(r.diagnostics.generateCalls).toBe(1);
    expect(r.diagnostics.scoreCalls).toBe(model.scoreCalls);
    expect(r.diagnostics.modelCalls).toBe(model.totalCalls);
    expect(r.diagnostics.retried).toBe(false);
    expect(r.diagnostics.inBand).toBe(true);
    expect(r.ranked).toHaveLength(N);
    const off = new CountingModel(createMockModel());
    const r0 = await generateNextSentence(off, deps(), opts({ tuning: { naturalTop: 0 } }));
    expect(off.totalCalls).toBe(1);
    expect(r0.diagnostics.modelCalls).toBe(1);
  });

  it('runs the safe round with the same prompt prefix, a safe tag and new seeds when nothing is in the band', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(brandNew), opts({ names: ['Marta'], tuning: { naturalTop: 0 } }));
    expect(model.generateCalls).toBe(2);
    expect(r.diagnostics.retried).toBe(true);
    const retryN = DEFAULT_NEXT_SENTENCE_TUNING.retryN;
    expect(model.generateOptions.map((o) => o.seed)).toEqual([7, 7 + N]);
    expect(model.generateOptions.map((o) => o.n)).toEqual([N, retryN]);
    expect(model.generateOptions[1]?.temperature).toBe(DEFAULT_NEXT_SENTENCE_TUNING.retryTemperature);
    const [p1, p2] = model.prompts as [string, string];
    expect(p1.endsWith('[comprar]')).toBe(true);
    expect(p2.endsWith('[Marta]')).toBe(true);
    expect(p1.slice(0, -'[comprar]'.length)).toBe(p2.slice(0, -'[Marta]'.length));
    expect(r.diagnostics.rounds.map((x) => [x.simple, x.tag])).toEqual([[false, 'comprar'], [true, 'Marta']]);
    // Both rounds are ranked together; there is still a next sentence at zero knowledge.
    expect(r.ranked).toHaveLength(N + retryN);
    expect(r.diagnostics.candidateRound).toEqual([...Array(N).fill(0), ...Array(retryN).fill(1)]);
    expect(r.diagnostics.inBand).toBe(false);
  });

  it('does not retry when retry is off', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(brandNew), opts({ tuning: { retry: false, naturalTop: 0 } }));
    expect(model.generateCalls).toBe(1);
    expect(r.diagnostics.modelCalls).toBe(1);
    expect(r.diagnostics.retried).toBe(false);
  });

  it('passes the tagged prompt, length budget, sentence-end stops and seed to the model', async () => {
    const model = new CountingModel(createMockModel());
    await generateNextSentence(model, deps(), opts({ tuning: { n: 3 }, names: ['Marta'], vocab: 300 }));
    const prompt = model.prompts[0] ?? '';
    expect(prompt.startsWith('Cuento en español (nivel A1). Frases muy cortas.\nPersonajes: Marta.\n')).toBe(true);
    expect(prompt).toContain('[llegó] Marta llegó tarde al mercado.\n[comprar]');
    expect(model.generateOptions[0]).toEqual({
      n: 3,
      maxTokens: 8 * 2 + DEFAULT_NEXT_SENTENCE_TUNING.extraTokens,
      temperature: DEFAULT_NEXT_SENTENCE_TUNING.temperature,
      stop: DEFAULT_NEXT_SENTENCE_TUNING.stop,
      seed: 7,
    });
  });

  it('uses given target surface words, register and region', async () => {
    const model = new CountingModel(createMockModel());
    await generateNextSentence(model, deps(), opts({ targetWords: ['compró'], register: 'street', region: 'PR' }));
    expect(model.prompts[0]).toContain('calle de Puerto Rico');
    expect(model.prompts[0]?.endsWith('[compró]')).toBe(true);
  });

  it('starts a story from nothing with the pack example lines', async () => {
    const model = new CountingModel(createMockModel());
    const r = await generateNextSentence(model, deps(), opts({ story: [] }));
    const examples = pack.story?.examples ?? [];
    expect(examples.length).toBeGreaterThan(0);
    for (const e of examples) expect(model.prompts[0]).toContain(`[${e.tag}] ${e.text}`);
    expect(model.prompts[0]?.endsWith('[comprar]')).toBe(true);
    expect(r.sentence).not.toBeNull();
  });

  it('keeps the tags the caller gives story lines', async () => {
    const model = new CountingModel(createMockModel());
    await generateNextSentence(model, deps(), opts({ story: [{ text: 'Marta compró pan.', tag: 'pan' }, 'Volvió a casa.'] }));
    expect(model.prompts[0]).toContain('[pan] Marta compró pan.\n[volvió] Volvió a casa.\n');
  });

  it('shows a vocabulary line for a small vocabulary or familiar words, never for a large one', async () => {
    const small = new CountingModel(createMockModel());
    const r = await generateNextSentence(small, deps(early), opts({ tuning: { vocabularyBelow: 1_000 } }));
    expect(r.diagnostics.vocabulary.length).toBeGreaterThan(0);
    expect(small.prompts[0]).toContain(`Palabras: ${r.diagnostics.vocabulary.join(', ')}.`);
    expect(r.diagnostics.vocabulary).not.toContain('comprar');
    const large = new CountingModel(createMockModel());
    const r2 = await generateNextSentence(large, deps(early), opts({ tuning: { vocabularyBelow: 0 } }));
    expect(r2.diagnostics.vocabulary).toEqual([]);
    expect(large.prompts[0]).not.toContain('Palabras:');
    const bridge = new CountingModel(createMockModel());
    const r3 = await generateNextSentence(bridge, deps(brandNew), opts({ familiar: ['es:casa', 'es:pan'], tuning: { vocabularyBelow: 0, retry: false } }));
    expect(r3.diagnostics.vocabulary.slice(0, 2)).toEqual(expect.arrayContaining(['casa', 'pan']));
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
    expect(r.diagnostics.targetUsed).toBe(true);
    expect(r.diagnostics.rounds[0]?.cleaned).toEqual(['Marta compró bicicletas, zanahorias y berenjenas.', 'Marta compró pan.']);
    expect(model.calls).toBe(1);
    expect(r.diagnostics.generateCalls).toBe(1);
  });

  it('takes the safe-round candidate when only it reaches the band', async () => {
    const model = new ScriptedModel([
      ['Marta compró bicicletas y zanahorias.', 'Marta vio berenjenas.'],
      ['Marta compró pan en el mercado.', 'Marta compró berenjenas.'],
    ]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 2, retryN: 2 } }));
    expect(model.calls).toBe(2);
    expect(r.sentence).toBe('Marta compró pan en el mercado.');
    expect(r.diagnostics.candidateRound[r.best?.index ?? -1]).toBe(1);
  });

  it('returns no sentence when every candidate is rejected, and counts every reason', async () => {
    const model = new ScriptedModel([['I bought bread.', 'Oración:', 'Marta llegó tarde al mercado.', 'El y de _______.']]);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 4, retryN: 4 } }));
    expect(r.sentence).toBeNull();
    expect(r.best).toBeNull();
    expect(r.diagnostics.generateCalls).toBe(2);
    expect(r.diagnostics.scoreCalls).toBe(0);
    const reasons = r.ranked.slice(0, 4).map((e) => e.rejected[0]);
    expect(reasons).toEqual(['native_words', 'empty', 'repeat', 'placeholder']);
    expect(r.diagnostics.rejectCounts).toEqual(r.rejectCounts);
    expect(r.rejectCounts.native_words).toBe(2);
    expect(r.rejectCounts.empty).toBe(2);
    expect(r.rejectCounts.repeat).toBe(2);
    expect(r.rejectCounts.placeholder).toBe(2);
  });

  it('rejects candidates that echo the prompt header', async () => {
    const model = new ScriptedModel([['Cuento en español, frases muy cortas.', 'Marta compró pan.']]);
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

  it('breaks a tie between in-band candidates with the natural score, and scores each text once', async () => {
    const texts = ['Marta compró pan en la casa.', 'Marta compró pan en la playa.', 'Marta compró pan en la casa.'];
    const lp = (t: string) => (t.includes('playa') ? -6 : -60);
    const model = new ScriptedModel([texts], lp);
    const r = await generateNextSentence(model, deps(early), opts({ tuning: { n: 3, naturalTop: 3 } }));
    expect(model.scoreCalls).toBe(2);
    expect(r.diagnostics.scoreCalls).toBe(2);
    expect(r.sentence).toBe('Marta compró pan en la playa.');
    expect(r.best?.natural).toBeCloseTo(-1, 6);
    const flat = await generateNextSentence(new ScriptedModel([texts], lp), deps(early), opts({ tuning: { n: 3, naturalTop: 0 } }));
    expect(flat.best?.index).toBe(0);
    expect(flat.best?.natural).toBeNull();
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

  it('storyNames finds names the pack knows anywhere and unknown capitalized words mid-sentence', () => {
    expect(storyNames(pack, ['Marta llegó con Rosa.', 'Luego Rosa vio a Pedro.', 'Hoy compró pan.'])).toEqual(['Marta', 'Rosa', 'Pedro']);
    expect(storyNames(pack, [])).toEqual([]);
  });

  it('vocabularyFor lists known content words: the story first, then familiar keys, then the frequency list', () => {
    const learner = stubLearner({ 'es:mercado': 0.97, 'es:llegar': 0.97, 'es:casa': 0.2 }, 0);
    const v = vocabularyFor({ pack, learner, now: 0, story: ['Marta llegó tarde al mercado.'], familiar: ['es:casa'], knownAt: 0.9, max: 10 });
    expect(v).toEqual(['llegar', 'mercado', 'casa']);
    expect(vocabularyFor({ pack, learner, now: 0, story: ['Marta llegó tarde al mercado.'], knownAt: 0.9, max: 1 })).toEqual(['llegar']);
    expect(vocabularyFor({ pack, learner, now: 0, story: ['Marta llegó.'], knownAt: 0.9, max: 5, exclude: ['es:llegar'] })).toEqual([]);
  });

  it('knownLexemeCount counts frequency-list lexemes at the threshold', () => {
    const p = { ...pack, frequencyList: ['el', 'casa', 'perro'] };
    expect(knownLexemeCount(p, stubLearner({ 'es:el': 0.95, 'es:casa': 0.9 }, 0), 0, 0.9)).toBe(2);
  });
});
