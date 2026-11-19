/**
 * Model calls of a cliff answer in StorySession and LyricSession (real packs, mock model):
 * the answer reuses the alternatives cliff selection found, so it costs at most two
 * model calls for a single word (none when the answer is one of them), and the outcome
 * is the one a fresh next-word search gives.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, frequencyLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';
import { LearnerModel } from '../learner/model';
import { parseLyrics } from '../lyrics/parse';
import { scoreLyricAnswer } from '../lyrics/cliffs';
import { registerPairs } from '../lyrics/slang';
import { buildOutcome } from './cliff';
import { StorySession } from './story';
import { LyricSession } from './lyric';

const pack = createDefaultSpanishPack();
// The generated flow (the library would make StorySession play the authored series).
const pair = createDefaultPairPack({ library: false });
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const KEYS = frequencyLexemeKeys(pack);
const mock = createMockModel();

class Counting implements LanguageModel {
  readonly id = 'counting-mock';
  calls = { scoreContinuation: 0, nextTokens: 0, generate: 0 };
  get total(): number {
    return this.calls.scoreContinuation + this.calls.nextTokens + this.calls.generate;
  }
  reset(): void {
    this.calls = { scoreContinuation: 0, nextTokens: 0, generate: 0 };
  }
  scoreContinuation(c: string, t: string): Promise<TokenScore[]> {
    this.calls.scoreContinuation++;
    return mock.scoreContinuation(c, t);
  }
  nextTokens(c: string, k: number): Promise<TokenCandidate[]> {
    this.calls.nextTokens++;
    return mock.nextTokens(c, k);
  }
  generate(p: string, o: GenerateOptions): Promise<string[]> {
    this.calls.generate++;
    return mock.generate(p, o);
  }
}

function learner(): LearnerModel {
  const known = new Set(KEYS.slice(0, 400));
  const l = new LearnerModel({ prior: (key) => (known.has(key) ? 0.97 : 0.002) });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  return l;
}

describe('a cliff answer reuses the cliff alternatives', () => {
  it('StorySession: at most two model calls per single-word answer (four for several words), the outcome of a fresh search', async () => {
    let checked = 0;
    for (const seed of [21, 22, 23, 24]) {
      const m = new Counting();
      const s = StorySession.create({ model: m, pack, pair, learner: learner(), now: T0, seed });
      let t = T0;
      for (let i = 0; i < 4; i++) {
        const step = await s.next((t += 1000));
        const cur = s.snapshot().state.current;
        if (step.screen.kind !== 'cliff' || !cur || cur.source !== 'model') continue;
        const options = (cur.options ?? []).map((o) => o.text);
        const answer = [...cur.alternatives.map((a) => a.word), 'mesa', 'verde'].find((w) => !options.includes(w) && w !== cur.cliff.answer) ?? 'mesa';
        // The landing a fresh search gives (no precomputed values).
        const fresh = await scoreLyricAnswer(mock, pack, { context: cur.context, answer: cur.cliff.answer, before: cur.before }, answer, { register: 'neutral', regions: [] });
        const expected = buildOutcome(fresh, { pack, expected: cur.cliff.answer, rung: cur.rung, scoredBy: 'model', actualProb: cur.actualProb });
        m.reset();
        const landed = await s.handleUtterance(answer, (t += 1000));
        if (landed.screen.kind !== 'landing') continue;
        // With slang in the cliff, a non-full answer is also judged in neutral form: another
        // context, so its own search (scoreLyricAnswer step 4).
        const slang = registerPairs(cur.cliff.answer, pack, [], { loose: true, alsoStandard: false }).substitutions.length > 0;
        if (!slang) expect(m.calls.nextTokens + m.calls.scoreContinuation, answer).toBeLessThanOrEqual(cur.cliff.length > 1 ? 4 : 2);
        expect(m.calls.generate).toBe(0);
        expect(landed.screen.outcome, answer).toEqual(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  it('StorySession: the story word costs no model call', async () => {
    const m = new Counting();
    const s = StorySession.create({ model: m, pack, pair, learner: learner(), now: T0, seed: 21 });
    let t = T0;
    let checked = 0;
    for (let i = 0; i < 4; i++) {
      const step = await s.next((t += 1000));
      const cur = s.snapshot().state.current;
      if (step.screen.kind !== 'cliff' || !cur || cur.source !== 'model' || cur.cliff.length !== 1) continue;
      m.reset();
      const landed = await s.handleUtterance(cur.cliff.answer, (t += 1000));
      expect(landed.screen.kind).toBe('landing');
      expect(m.total).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('LyricSession: a rated cliff answers without a next-word search', async () => {
    const lyrics = parseLyrics(['Esta noche salimos a bailar', 'Nadie se queda en la casa', 'Vamos a cantar hasta que salga el sol'].join('\n'), pack);
    const m = new Counting();
    const s = LyricSession.create({ model: m, pack, pair, learner: new LearnerModel(), now: T0, seed: 3, source: { kind: 'lyrics', lyrics } });
    let t = T0;
    let checked = 0;
    for (let i = 0; i < 3; i++) {
      const step = await s.next((t += 1000));
      const c = s.snapshot().state.cliff;
      if (step.screen.kind !== 'cliff' || !c?.rated) continue;
      const options = (c.options ?? []).map((o) => o.text);
      const answer = ['mesa', 'verde', 'rojo'].find((w) => !options.includes(w)) as string;
      m.reset();
      const r = await s.handleUtterance(answer, (t += 1000));
      expect(r.screen.kind).toBe('result');
      expect(m.calls.nextTokens + m.calls.scoreContinuation).toBeLessThanOrEqual(c.length > 1 ? 4 : 2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
