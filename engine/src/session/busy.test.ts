/**
 * One step at a time: StorySession and LyricSession calls made while an async step waits
 * for the model (the real Spanish and en-es packs and the mock model behind a model that
 * holds its calls until released). Every public step call is refused with a typed result
 * and changes nothing; reads see the state from before the running step; the running
 * step ends exactly as it would have without the interleaved calls; a failed step leaves
 * the session as it was; setModel() during a step waits for it.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, frequencyLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';
import { LearnerModel } from '../learner/model';
import { parseLyrics } from '../lyrics/parse';
import { StorySession } from './story';
import { LyricSession } from './lyric';
import type { LyricStep, StoryStep } from './types';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const KEYS = frequencyLexemeKeys(pack);
const mock = createMockModel();

/** An early learner (the first 400 lexemes known) with some evidence, so sessions generate. */
function learner(): LearnerModel {
  const known = new Set(KEYS.slice(0, 400));
  const l = new LearnerModel({ prior: (key) => (known.has(key) ? 0.97 : 0.002) });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  return l;
}

/** The mock model, but calls wait while held; `fail` makes the next calls reject. */
class HeldModel implements LanguageModel {
  readonly id = 'held-mock';
  pending = 0;
  fail = false;
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
  }
  release(): void {
    this.open?.();
    this.gate = null;
    this.open = null;
  }
  private async call<T>(f: () => Promise<T>): Promise<T> {
    this.pending += 1;
    try {
      if (this.gate) await this.gate;
      if (this.fail) throw new Error('model down');
      return await f();
    } finally {
      this.pending -= 1;
    }
  }
  scoreContinuation(c: string, t: string): Promise<TokenScore[]> {
    return this.call(() => mock.scoreContinuation(c, t));
  }
  nextTokens(c: string, k: number): Promise<TokenCandidate[]> {
    return this.call(() => mock.nextTokens(c, k));
  }
  generate(p: string, o: GenerateOptions): Promise<string[]> {
    return this.call(() => mock.generate(p, o));
  }
}

/** Wait until the running step is inside a held model call. */
async function untilPending(m: HeldModel): Promise<void> {
  for (let i = 0; i < 10_000 && m.pending === 0; i++) await Promise.resolve();
  expect(m.pending).toBeGreaterThan(0);
}

const makeStory = (model: LanguageModel) => StorySession.create({ model, pack, pair, learner: learner(), now: T0, seed: 21 });

/** A story session on a model-made cliff, and a twin in the same state. */
async function atCliff(): Promise<{ s: StorySession; twin: StorySession; m: HeldModel }> {
  const m = new HeldModel();
  const s = makeStory(m);
  const twin = makeStory(mock);
  for (let i = 0; i < 6; i++) {
    const a = await s.next(T0 + 1000 * (i + 1));
    await twin.next(T0 + 1000 * (i + 1));
    if (a.screen.kind === 'cliff' && s.snapshot().state.current?.source === 'model') return { s, twin, m };
  }
  throw new Error('no model cliff');
}

/** A free answer that is not one of the options (so it is scored by the model). */
function freeAnswer(s: StorySession): string {
  const opts = (s.snapshot().state.current?.options ?? []).map((o) => o.text);
  return ['mesa', 'verde', 'rojo'].find((w) => !opts.includes(w)) ?? 'mesa';
}

describe('StorySession: calls during a running step', () => {
  it('refuses every step call while an answer waits for the model, and changes nothing', async () => {
    const { s, twin, m } = await atCliff();
    const snap = s.snapshot();
    const screen = s.screen;
    const settings = s.settings;
    const answer = freeAnswer(s);
    m.hold();
    const order: string[] = [];
    const running = s.handleUtterance(answer, T0 + 10_000).then((r) => (order.push('answer'), r));
    await untilPending(m);
    expect(s.isBusy).toBe(true);

    const refusal = { screen, events: [], refused: 'busy' };
    const sync: StoryStep[] = [s.tapWord(0, T0 + 10_001), s.revealWord(1, T0 + 10_002), s.played(T0 + 10_003), s.setSettings({ textMode: 'all_text', register: 'street' }, T0 + 10_004)];
    for (const r of sync) expect(r).toEqual(refusal);
    const asyncCalls = [
      s.handleUtterance('otra vez', T0 + 10_005),
      s.next(T0 + 10_006),
      s.command('slower', T0 + 10_007),
      s.pickOption(0, T0 + 10_008),
      s.startRegisterTask(T0 + 10_009),
    ].map((p) => p.then((r) => (order.push('refused'), r)));
    for (const r of await Promise.all(asyncCalls)) expect(r).toEqual(refusal);
    // Reads see the state from before the step.
    expect(s.snapshot()).toEqual(snap);
    expect(s.screen).toEqual(screen);
    expect(s.settings).toEqual(settings);
    expect((await s.prefetch(T0 + 10_010)).prepared).toBe(false);

    m.release();
    const done = await running;
    // Refusals resolve at once, before the running step.
    expect(order).toEqual(['refused', 'refused', 'refused', 'refused', 'refused', 'answer']);
    expect(done.refused).toBeUndefined();
    expect(done.screen.kind).toBe('landing');
    // The step ends exactly as it does without the interleaved calls.
    expect(done).toEqual(await twin.handleUtterance(answer, T0 + 10_000));
    expect(s.snapshot()).toEqual(twin.snapshot());
    expect(s.isBusy).toBe(false);
    // And the session takes calls again.
    expect(s.tapWord(0, T0 + 11_000).refused).toBeUndefined();
  });

  it('a snapshot taken during next() restores to the session before it, which then takes the same step', async () => {
    const { s, m } = await atCliff();
    await s.handleUtterance(freeAnswer(s), T0 + 20_000);
    m.hold();
    const running = s.next(T0 + 21_000);
    await untilPending(m);
    const mid = JSON.parse(JSON.stringify(s.snapshot()));
    expect(mid.state.phase).toBe('landing');
    const learnerCopy = LearnerModel.restore(s.learner.snapshot(), {
      prior: (key: string) => (new Set(KEYS.slice(0, 400)).has(key) ? 0.97 : 0.002),
    });
    m.release();
    const step = await running;
    const restored = StorySession.restore(mid, { model: mock, pack, pair, learner: learnerCopy });
    expect(await restored.next(T0 + 21_000)).toEqual(step);
  });

  it('a step that throws leaves the session as it was, so a retry gives the step it would have given', async () => {
    const { s, twin, m } = await atCliff();
    const answer = freeAnswer(s);
    const before = s.snapshot();
    m.fail = true;
    await expect(s.handleUtterance(answer, T0 + 30_000)).rejects.toThrow('model down');
    expect(s.isBusy).toBe(false);
    expect(s.snapshot()).toEqual(before);
    m.fail = false;
    expect(await s.handleUtterance(answer, T0 + 30_000)).toEqual(await twin.handleUtterance(answer, T0 + 30_000));
  });

  it('defers setModel until the running step ends', async () => {
    const { s, m } = await atCliff();
    m.hold();
    const running = s.handleUtterance(freeAnswer(s), T0 + 40_000);
    await untilPending(m);
    s.setModel(null);
    expect(s.screen.meta.canned).toBe(false);
    m.release();
    const done = await running;
    expect(done.screen.kind).toBe('landing');
    expect(done.screen.meta.canned).toBe(false);
    // The model is gone from the next sentence on.
    const next = await s.next(T0 + 41_000);
    expect(next.screen.meta.canned).toBe(true);
  });
});

const SONG = parseLyrics(
  ['Esta noche salimos a bailar', 'El corillo ya está listo pa la fiesta', 'Nadie se queda en la casa', 'Vamos a cantar hasta que salga el sol'].join('\n'),
  pack,
);
const makeLyric = (model: LanguageModel) =>
  LyricSession.create({ model, pack, pair, learner: new LearnerModel(), now: T0, seed: 3, source: { kind: 'lyrics', lyrics: SONG } });

describe('LyricSession: calls during a running step', () => {
  it('refuses every step call while next() waits for the model, and ends as without them', async () => {
    const m = new HeldModel();
    const s = makeLyric(m);
    const twin = makeLyric(mock);
    const snap = s.snapshot();
    const screen = s.screen;
    m.hold();
    const running = s.next(T0 + 1000);
    await untilPending(m);
    const refusal = { screen, events: [], refused: 'busy' };
    const sync: LyricStep[] = [s.startEcho(T0 + 1001), s.played(T0 + 1002), s.setRegister('street', T0 + 1003), s.setSettings({ showExplicit: false }, T0 + 1004), s.markLine(1, 5000), s.showSong()];
    for (const r of sync) expect(r).toEqual(refusal);
    for (const r of await Promise.all([s.next(T0 + 1005), s.openLine(2, T0 + 1006), s.handleUtterance('bailar', T0 + 1007), s.command('again', T0 + 1008), s.pickOption(0, T0 + 1009)])) {
      expect(r).toEqual(refusal);
    }
    expect(s.snapshot()).toEqual(snap);
    expect(s.settings.register).toBe('neutral');
    m.release();
    const done = await running;
    expect(done.refused).toBeUndefined();
    expect(done).toEqual(await twin.next(T0 + 1000));
    expect(s.snapshot()).toEqual(twin.snapshot());
    expect(s.markLine(1, 5000).refused).toBeUndefined();
  });

  it('a lyric step that throws leaves the session as it was', async () => {
    const m = new HeldModel();
    const s = makeLyric(m);
    const before = s.snapshot();
    m.fail = true;
    await expect(s.next(T0 + 1000)).rejects.toThrow('model down');
    expect(s.snapshot()).toEqual(before);
    expect(s.isBusy).toBe(false);
  });
});
