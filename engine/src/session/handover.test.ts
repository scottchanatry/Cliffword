/**
 * Zero knowledge to generated story (session/handover.ts) with the real Spanish and en-es
 * packs: the stage rule, the bridge vocabulary, and a session that never stalls or
 * repeats early, with a model and without one.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, frequencyLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import type { GenerateOptions, LanguageModel } from '../model/types';
import { LearnerModel } from '../learner/model';
import { lexemeKey } from '../learner/types';
import { DEFAULT_HANDOVER_OPTIONS, bridgeFamiliar, handoverStage, starterLimit } from './handover';
import { StorySession } from './story';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const KEYS = frequencyLexemeKeys(pack);
const STARTER = pair.starter!;

/** Knows the first `n` lexemes of the frequency list for meaning (prior 0.97), nothing else. */
function knowing(n: number): LearnerModel {
  const known = new Set(KEYS.slice(0, n));
  return new LearnerModel({ prior: (key) => (known.has(key) ? 0.97 : 0.002) });
}

/** The mock for scoring and next words, with scripted generations (one list per call, the last repeats). */
function scripted(rounds: readonly string[][]): LanguageModel & { prompts: string[]; options: GenerateOptions[] } {
  const mock = createMockModel();
  const prompts: string[] = [];
  const options: GenerateOptions[] = [];
  let i = 0;
  return {
    id: 'scripted-mock',
    prompts,
    options,
    scoreContinuation: (c, t) => mock.scoreContinuation(c, t),
    nextTokens: (c, k) => mock.nextTokens(c, k),
    async generate(prompt, o) {
      prompts.push(prompt);
      options.push(o);
      const round = rounds[Math.min(i++, rounds.length - 1)] ?? [];
      return Array.from({ length: o.n }, (_, j) => round[j % Math.max(1, round.length)] ?? '');
    },
  };
}

describe('handoverStage', () => {
  const base = { pack, pair, now: T0, zeroStart: true, hasModel: true };

  it('plays the starter first at zero knowledge, then bridges, then generates freely once enough words are known', () => {
    expect(starterLimit(pair)).toBe(STARTER.sentences.length);
    expect(handoverStage({ ...base, learner: knowing(0), starterUsed: 0 })).toBe('starter');
    expect(handoverStage({ ...base, learner: knowing(0), starterUsed: STARTER.sentences.length - 1 })).toBe('starter');
    expect(handoverStage({ ...base, learner: knowing(0), starterUsed: STARTER.sentences.length })).toBe('bridge');
    const strict = DEFAULT_HANDOVER_OPTIONS.strictFrom;
    expect(handoverStage({ ...base, learner: knowing(strict - 1), starterUsed: 99 })).toBe('bridge');
    expect(handoverStage({ ...base, learner: knowing(strict), starterUsed: 99 })).toBe('free');
  });

  it('skips the starter for a learner who is not starting from zero', () => {
    expect(handoverStage({ ...base, zeroStart: false, learner: knowing(500), starterUsed: 0 })).toBe('free');
    expect(handoverStage({ ...base, zeroStart: false, learner: knowing(10), starterUsed: 0 })).toBe('bridge');
  });

  it('stays on canned content without a model', () => {
    expect(handoverStage({ ...base, hasModel: false, learner: knowing(500), starterUsed: 99 })).toBe('starter');
  });

  it('reads its thresholds from options (data, not code)', () => {
    const options = { starterSentences: 3, strictFrom: 20, knownAt: 0.5 };
    expect(starterLimit(pair, options)).toBe(3);
    expect(handoverStage({ ...base, learner: knowing(0), starterUsed: 3, options })).toBe('bridge');
    expect(handoverStage({ ...base, learner: knowing(20), starterUsed: 3, options })).toBe('free');
    expect(starterLimit(pair, { starterSentences: 0 })).toBe(0);
    expect(starterLimit(pair, { starterSentences: 99 })).toBe(STARTER.sentences.length);
  });
});

describe('bridgeFamiliar', () => {
  it('holds the taught words, every starter word, the introduced words and the cognates, names aside', () => {
    const fam = bridgeFamiliar(pack, pair, ['es:querer']);
    for (const l of STARTER.taught) expect(fam).toContain(lexemeKey('es', l));
    for (const l of ['tocar', 'ir', 'ella', 'a', 'hoy', 'después']) expect(fam).toContain(lexemeKey('es', l));
    expect(fam).toContain('es:querer');
    expect(fam).toContain('es:hospital');
    expect(fam).not.toContain('es:marta');
    expect(new Set(fam).size).toBe(fam.length);
    // Taught words first, cognates last and most frequent first.
    expect(fam[0]).toBe(lexemeKey('es', STARTER.taught[0] as string));
    const cognates = fam.slice(fam.indexOf('es:querer') + 1);
    const ranks = cognates.map((k) => pack.frequencyRank(k.slice(3)) ?? Infinity).filter(Number.isFinite);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe('a brand-new learner with a model', () => {
  it('hears the starter, then gets generated sentences on the bridge vocabulary with content-word targets', async () => {
    const model = scripted([['Marta toca el piano en el parque.', 'Ella va al concierto con su familia.']]);
    // The n-gram mock is no judge of naturalness: no natural pass here.
    const s = StorySession.create({
      model, pack, pair, learner: new LearnerModel(), now: T0, seed: 3, startMode: 'brand_new', options: { generation: { naturalTop: 0 } },
    });
    let t = T0;
    const texts: string[] = [];
    while (texts.length < STARTER.sentences.length) {
      const step = await s.next((t += 1000));
      if (step.screen.kind === 'cliff') texts.push(step.screen.sentence.text);
    }
    expect(texts).toEqual(STARTER.sentences.map((x) => x.text));
    expect(model.prompts).toHaveLength(0);
    expect(s.stageAt(t)).toBe('bridge');
    let generated = '';
    for (let i = 0; i < 6 && !generated; i++) {
      const step = await s.next((t += 1000));
      if (step.screen.kind === 'cliff' && s.snapshot().state.current?.source === 'model') generated = step.screen.sentence.text;
    }
    expect(['Marta toca el piano en el parque.', 'Ella va al concierto con su familia.']).toContain(generated);
    const prompt = model.prompts[0] ?? '';
    expect(prompt).toContain('Personajes: Marta.');
    expect(prompt).toMatch(/\nPalabras: [^\n]*tener/u);
    // The bridge introduces a content word: the tag is a noun, verb, adjective or adverb.
    const tag = /\[([^\]]+)\]$/u.exec(prompt)?.[1] ?? '';
    const pos = pack.analyze(pack.normalize(tag.split(', ')[0] ?? ''))[0]?.pos;
    expect(['NOUN', 'VERB', 'ADJ', 'ADV']).toContain(pos);
    expect(STARTER.taught).not.toContain(tag);
  });

  it('never stalls and never repeats early when generation gives nothing usable', async () => {
    const model = scripted([['El y de _______.', '¿Qué?', '1. Marta compró pan.']]);
    const s = StorySession.create({ model, pack, pair, learner: new LearnerModel(), now: T0, seed: 4, startMode: 'brand_new' });
    const shown: string[] = [];
    let t = T0;
    for (let i = 0; i < 60 && shown.length < 24; i++) {
      const step = await s.next((t += 1000));
      expect(step.screen.kind).not.toBe('error');
      if (step.screen.kind === 'cliff') shown.push(step.screen.sentence.text);
    }
    expect(shown).toHaveLength(24);
    expect(new Set(shown).size).toBe(24);
    expect(shown.slice(0, 8)).toEqual(STARTER.sentences.map((x) => x.text));
    // After the starter: the unused ladder sentences, in order.
    expect(shown.slice(8, 12)).toEqual((STARTER.probes ?? []).slice(0, 4).map((x) => x.text));
  });

  it('records the targets generated sentences used as introduced words', async () => {
    const learner = knowing(0);
    const s = StorySession.create({ model: scripted([['Marta tiene una casa grande.']]), pack, pair, learner, now: T0, seed: 5, startMode: 'continue', options: { handover: { starterSentences: 0 } } });
    expect(s.stageAt(T0)).toBe('bridge');
    const step = await s.next(T0 + 1000);
    expect(step.screen.kind).toBe('cliff');
    const st = s.snapshot().state;
    if (st.current?.source === 'model') expect(st.introduced).toEqual(expect.arrayContaining(st.current.targets.filter((k) => st.current?.text.toLowerCase().includes(k.slice(3)))));
    expect(Array.isArray(st.introduced)).toBe(true);
  });

  // Review regression (round 3): introducedKeep 0 kept every introduced word (slice(-0)).
  it('keeps at most introducedKeep introduced words (0 keeps none)', async () => {
    // Echo the prompt's target tag so every generated sentence uses its target.
    const echo = (): LanguageModel => {
      const mock = createMockModel();
      return {
        id: 'echo-tag',
        scoreContinuation: (c, t) => mock.scoreContinuation(c, t),
        nextTokens: (c, k) => mock.nextTokens(c, k),
        async generate(prompt, o) {
          const tag = (/\[([^\]]+)\]$/u.exec(prompt)?.[1] ?? 'casa').split(', ')[0];
          return Array.from({ length: o.n }, () => `Marta ve ${tag} en la casa.`);
        },
      };
    };
    const run = async (keep: number): Promise<string[]> => {
      const s = StorySession.create({
        model: echo(), pack, pair, learner: knowing(0), now: T0, seed: 9, startMode: 'continue',
        options: { handover: { starterSentences: 0, introducedKeep: keep }, generation: { naturalTop: 0 } },
      });
      let t = T0;
      let generated = 0;
      for (let i = 0; i < 12 && generated < 3; i++) {
        const step = await s.next((t += 1000));
        if (step.screen.kind === 'cliff' && s.snapshot().state.current?.source === 'model') generated += 1;
      }
      expect(generated).toBe(3);
      return s.snapshot().state.introduced;
    };
    expect((await run(5)).length).toBeGreaterThanOrEqual(2);
    expect(await run(0)).toEqual([]);
    expect((await run(1)).length).toBe(1);
  });

  it('generates freely for a learner who knows enough words', async () => {
    const model = scripted([['Ella vive en una casa grande con su madre.']]);
    // Beyond vocabularyBelow (800): no vocabulary line either.
    const learner = knowing(1000);
    // Some evidence: a learner with none at all starts with the starter story.
    learner.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
    const s = StorySession.create({ model, pack, pair, learner, now: T0, seed: 6 });
    expect(s.stageAt(T0)).toBe('free');
    await s.next(T0 + 1000);
    expect(model.prompts[0]).toBeDefined();
    expect(model.prompts[0]).not.toContain('Palabras:');
  });
});

describe('canned mode (no model)', () => {
  it('plays the starter, then the unused ladder sentences, before cycling', async () => {
    const s = StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 7, startMode: 'brand_new' });
    const total = STARTER.sentences.length + (STARTER.probes ?? []).length;
    const shown: string[] = [];
    let t = T0;
    for (let i = 0; i < 3 * total && shown.length < total + 2; i++) {
      const step = await s.next((t += 1000));
      if (step.screen.kind === 'cliff') shown.push(step.screen.sentence.text);
    }
    expect(new Set(shown.slice(0, total)).size).toBe(total);
    expect(shown.slice(0, 8)).toEqual(STARTER.sentences.map((x) => x.text));
    // Only then the starter again.
    expect(STARTER.sentences.map((x) => x.text)).toContain(shown[total]);
  });

  it('restores an old snapshot without the introduced list', async () => {
    const s = StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 8, startMode: 'brand_new' });
    await s.next(T0 + 1000);
    const snap = s.snapshot();
    delete (snap.state as { introduced?: string[] }).introduced;
    const r = StorySession.restore(snap, { model: null, pack, pair, learner: s.learner });
    expect(r.snapshot().state.introduced).toEqual([]);
    expect((await r.next(T0 + 2000)).screen.kind).not.toBe('error');
  });
});
