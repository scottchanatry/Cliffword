/**
 * StorySession.prefetch: the next sentence prepared while the learner is on the landing
 * screen, with the real Spanish and en-es packs and the mock model. Determinism with and
 * without prefetch, snapshot / restore, learner and model changes in between, a next()
 * that arrives while the prefetch runs, and model calls that never overlap.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, frequencyLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import type { LanguageModel } from '../model/types';
import { LearnerModel } from '../learner/model';
import { ModelGate } from './prefetch';
import { StorySession } from './story';
import type { StoryStep } from './types';

const pack = createDefaultSpanishPack();
// The generated flow (the library would make StorySession play the authored series).
const pair = createDefaultPairPack({ library: false });
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const KEYS = frequencyLexemeKeys(pack);

/** An early learner (the first 400 lexemes known) with some evidence, so sessions generate. */
function learner(): LearnerModel {
  const known = new Set(KEYS.slice(0, 400));
  const l = new LearnerModel({ prior: (key) => (known.has(key) ? 0.97 : 0.002) });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  return l;
}

/** The mock model, counting calls and the largest number running at once. */
function counting(): LanguageModel & { calls: number; maxInflight: number } {
  const mock = createMockModel();
  let inflight = 0;
  const m = {
    id: 'counting-mock',
    calls: 0,
    maxInflight: 0,
    async wrap<T>(fn: () => Promise<T>): Promise<T> {
      m.calls += 1;
      inflight += 1;
      m.maxInflight = Math.max(m.maxInflight, inflight);
      try {
        // Yield to the event loop so overlapping calls would show.
        await Promise.resolve();
        await Promise.resolve();
        return await fn();
      } finally {
        inflight -= 1;
      }
    },
    scoreContinuation: (c: string, t: string) => m.wrap(() => mock.scoreContinuation(c, t)),
    nextTokens: (c: string, k: number) => m.wrap(() => mock.nextTokens(c, k)),
    generate: (p: string, o: Parameters<LanguageModel['generate']>[1]) => m.wrap(() => mock.generate(p, o)),
  };
  return m;
}

const make = (model: LanguageModel | null, l = learner(), seed = 21) => StorySession.create({ model, pack, pair, learner: l, now: T0, seed });

/** Answer the cliff on screen (or move on), returning the step. */
async function land(s: StorySession, at: number): Promise<StoryStep> {
  const cur = s.snapshot().state.current;
  if (s.screen.kind === 'cliff' && cur) return s.handleUtterance(cur.cliff.answer, at);
  return s.next(at);
}

/** Drive a session: `steps` sentences, prefetching on the landing screen when asked. */
async function drive(s: StorySession, steps: number, prefetch: boolean): Promise<StoryStep[]> {
  const out: StoryStep[] = [];
  let t = T0;
  for (let i = 0; i < steps; i++) {
    if (prefetch) await s.prefetch(t + 500);
    const step = await s.next(t + 500);
    out.push(step);
    t += 1000;
    if (step.screen.kind === 'cliff') out.push(await land(s, (t += 1000)));
  }
  return out;
}

describe('StorySession.prefetch', () => {
  it('prepares the next sentence so that next() makes no model call, and the story is the same as without it', async () => {
    const a = make(counting());
    const b = make(counting());
    const withPrefetch = await drive(a, 4, true);
    const without = await drive(b, 4, false);
    expect(withPrefetch).toEqual(without);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.modelStats.replayed).toBeGreaterThan(0);
  });

  it('answers every model request of next() from the prefetch when nothing changed in between', async () => {
    const model = counting();
    const s = make(model);
    const info = await s.prefetch(T0 + 1000);
    expect(info.prepared).toBe(true);
    expect(info.next).toBe('cliff');
    expect(info.modelCalls).toBeGreaterThan(0);
    const callsBefore = model.calls;
    const step = await s.next(T0 + 1000);
    expect(step.screen.kind).toBe('cliff');
    expect(model.calls).toBe(callsBefore);
    expect(s.modelStats.replayed).toBeGreaterThan(0);
  });

  it('survives snapshot and restore: the snapshot holds no prefetched answers and the restored session shows the same sentence', async () => {
    const a = make(counting());
    const b = make(counting());
    await a.prefetch(T0 + 1000);
    const snapA = a.snapshot();
    expect(snapA).toEqual(b.snapshot());
    const restored = StorySession.restore(JSON.parse(JSON.stringify(snapA)), { model: counting(), pack, pair, learner: a.learner });
    const r = await restored.next(T0 + 1000);
    expect(r).toEqual(await b.next(T0 + 1000));
    expect(restored.modelStats.replayed).toBe(0);
    expect(await a.next(T0 + 1000)).toEqual(r);
  });

  it('discards what a learner change makes stale: the result equals a session that never prefetched', async () => {
    const la = learner();
    const lb = learner();
    const model = counting();
    const a = make(model, la);
    const b = make(counting(), lb);
    await a.prefetch(T0 + 1000);
    // Between the prefetch and next() the learner shows they know the next frequent words
    // (the targets the prefetch chose), so next() chooses other targets.
    const events = KEYS.slice(400, 440).flatMap((key, i) =>
      Array.from({ length: 8 }, (_, j) => ({ type: 'cliff_answer' as const, key, at: T0 + 100 + i * 8 + j, credit: 'full' as const, rung: 'free' as const })),
    );
    la.applyAll(events);
    lb.applyAll(events);
    expect(la.pKnown(KEYS[400] as string, 'meaning', T0 + 1000)).toBeGreaterThan(0.5);
    const callsBefore = model.calls;
    const sa = await a.next(T0 + 1000);
    const sb = await b.next(T0 + 1000);
    expect(sa).toEqual(sb);
    expect(model.calls).toBeGreaterThan(callsBefore);
  });

  it('reuses the answers when a learner change leaves the requests the same', async () => {
    const la = learner();
    const lb = learner();
    const model = counting();
    const a = make(model, la);
    const b = make(counting(), lb);
    await a.prefetch(T0 + 1000);
    // A tap on a word far down the list changes nothing the next step asks for.
    la.apply({ type: 'tap_rehear', key: 'es:sombrero', at: T0 + 900 });
    lb.apply({ type: 'tap_rehear', key: 'es:sombrero', at: T0 + 900 });
    const callsBefore = model.calls;
    expect(await a.next(T0 + 1000)).toEqual(await b.next(T0 + 1000));
    expect(model.calls).toBe(callsBefore);
  });

  it('drops the prefetch when the model changes', async () => {
    const s = make(counting());
    await s.prefetch(T0 + 1000);
    const fresh = counting();
    s.setModel(fresh);
    await s.next(T0 + 1000);
    expect(s.modelStats.replayed).toBe(0);
    expect(fresh.calls).toBeGreaterThan(0);
  });

  it('lets next() wait for a running prefetch and reuse it', async () => {
    const model = counting();
    const s = make(model);
    const pending = s.prefetch(T0 + 1000);
    const step = await s.next(T0 + 1000);
    const info = await pending;
    expect(step.screen.kind).toBe('cliff');
    expect(info.prepared).toBe(true);
    expect(model.calls).toBe(info.modelCalls);
    expect(s.modelStats.replayed).toBeGreaterThan(0);
  });

  it('never runs two model calls at once, even when the learner answers during a prefetch', async () => {
    const model = counting();
    const s = make(model);
    await s.next(T0 + 1000);
    const cur = s.snapshot().state.current;
    expect(cur).not.toBeNull();
    // The answer is scored (model calls) while the next sentence is prepared.
    const answer = s.handleUtterance(cur?.cliff.answer ?? '', T0 + 2000);
    const pre = s.prefetch(T0 + 2500);
    await Promise.all([answer, pre]);
    await s.next(T0 + 3000);
    expect(model.maxInflight).toBe(1);
  });

  it('does nothing in canned mode or while a step runs', async () => {
    const canned = make(null);
    expect(await canned.prefetch(T0 + 1000)).toEqual({ prepared: false, modelCalls: 0, next: null });
    const s = make(counting());
    const running = s.next(T0 + 1000);
    expect(await s.prefetch(T0 + 1000)).toEqual({ prepared: false, modelCalls: 0, next: null });
    await running;
  });
});

describe('ModelGate', () => {
  it('replays recorded answers only for identical requests and forgets them on clear', async () => {
    const model = counting();
    const gate = new ModelGate(model);
    const rec = gate.record();
    const rep = gate.replay();
    const a = await rec.generate('Hola', { n: 2, maxTokens: 4, temperature: 0.8, seed: 1 });
    expect(await rep.generate('Hola', { n: 2, maxTokens: 4, temperature: 0.8, seed: 1 })).toBe(a);
    expect(gate.replayed).toBe(1);
    await rep.generate('Hola', { n: 2, maxTokens: 4, temperature: 0.8, seed: 2 });
    expect(gate.replayed).toBe(1);
    expect(model.calls).toBe(2);
    gate.clear();
    expect(gate.size).toBe(0);
    await rep.generate('Hola', { n: 2, maxTokens: 4, temperature: 0.8, seed: 1 });
    expect(model.calls).toBe(3);
  });

  it('does not replay a failed call', async () => {
    let fail = true;
    const flaky: LanguageModel = {
      id: 'flaky',
      scoreContinuation: async () => [],
      nextTokens: async () => [],
      generate: async () => {
        if (fail) throw new Error('busy');
        return ['ok'];
      },
    };
    const gate = new ModelGate(flaky);
    await expect(gate.record().generate('x', { n: 1, maxTokens: 1, temperature: 0 })).rejects.toThrow('busy');
    fail = false;
    expect(await gate.replay().generate('x', { n: 1, maxTokens: 1, temperature: 0 })).toEqual(['ok']);
    expect(gate.replayed).toBe(0);
  });
});
