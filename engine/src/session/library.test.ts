/**
 * StorySession playing an authored library (the test library of content/testLibrary.ts)
 * with the real Spanish and en-es packs, canned (no model) and with the deterministic
 * mock model: the three cliff modes, feedback, variants, episode order, tracks, the level
 * rule, turns, snapshots and simulated learners.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { createMockModel } from '../model/mock';
import { LearnerModel } from '../learner/model';
import type { PairPack } from '../pair/types';
import { TEST_LIBRARY, TEST_TRACKS } from '../content/testLibrary';
import { buildPrior } from './common';
import { StorySession, type StorySessionCreate, type StorySessionSnapshot } from './story';
import { STORY_SESSION_FORMAT, type StoryScreen, type StoryStep } from './types';

const pack = createDefaultSpanishPack();
const base = createDefaultPairPack();
const pair: PairPack = { ...base, library: TEST_LIBRARY, tracks: TEST_TRACKS };
const noLibrary: PairPack = { ...base, library: undefined, tracks: undefined };
const model = createMockModel();
const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);
const MARKET = 'test.track.market';
const DATE = 'test.track.date';

function make(over: Partial<StorySessionCreate> = {}): StorySession {
  return StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 11, ...over });
}
const state = (s: StorySession) => s.snapshot().state;
/** The learner as the app would restore it: its memory and the session's prior. */
const learnerOf = (s: StorySession) => LearnerModel.restore(s.learner.snapshot(), { prior: buildPrior(s.prior, pack, pair) });
const answerOf = (s: StorySession) => state(s).current?.cliff.answer ?? '';
function screenOf<K extends StoryScreen['kind']>(step: StoryStep | StoryScreen, kind: K): Extract<StoryScreen, { kind: K }> {
  const screen = 'screen' in step ? step.screen : step;
  expect(screen.kind).toBe(kind);
  return screen as Extract<StoryScreen, { kind: K }>;
}
/** Index of an option by text on the cliff screen. */
function optionIndex(screen: StoryScreen, text: string): number {
  const c = screenOf(screen, 'cliff');
  const o = c.cliff.options?.find((x) => x.text === text);
  expect(o, `option ${text}`).toBeDefined();
  return o?.index ?? -1;
}

/**
 * Play the current track until `until` (a screen kind) with a policy per cliff:
 * 'say' the answer, 'pick' the right option, 'wrong' a distractor, 'noSe' twice.
 */
async function playEpisode(s: StorySession, t: { now: number }, policy: (i: number) => 'say' | 'pick' | 'wrong' | 'noSe' | 'skip'): Promise<Extract<StoryScreen, { kind: 'episodeDone' }>> {
  let i = 0;
  let step = await s.next((t.now += 1000));
  for (let guard = 0; guard < 200; guard++) {
    const sc = step.screen;
    if (sc.kind === 'episodeDone') return sc;
    expect(['cliff', 'turn'], JSON.stringify(sc.kind)).toContain(sc.kind);
    if (sc.kind === 'cliff') {
      if (sc.phase === 'playing') step = s.played((t.now += 500));
      const p = policy(i++);
      if (p === 'say') await s.handleUtterance(answerOf(s), (t.now += 1000));
      else if (p === 'skip') {
        // next() at the gap skips the cliff
      } else if (p === 'noSe') {
        const r = await s.command('dont_know', (t.now += 1000));
        if (r.screen.kind === 'cliff') await s.command('dont_know', (t.now += 1000));
      } else {
        let c = s.screen;
        if (c.kind === 'cliff' && !c.cliff.options) c = (await s.command('dont_know', (t.now += 1000))).screen;
        const cliff = screenOf(c, 'cliff');
        const answer = answerOf(s);
        const opt = cliff.cliff.options?.find((o) => (p === 'pick' ? o.text === answer : o.text !== answer));
        await s.pickOption(opt?.index ?? 0, (t.now += 1000));
      }
    } else if (sc.kind === 'turn') {
      await s.handleUtterance('Sí, me gusta mucho.', (t.now += 1000));
    }
    step = await s.next((t.now += 1000));
  }
  throw new Error('episode did not end');
}

describe('library source', () => {
  it('is the default when the pair has stories, and the generated flow stays behind an option', async () => {
    const s = make();
    expect(s.playsLibrary).toBe(true);
    expect(state(s).placement).toBeNull();
    const first = await s.next(T0);
    expect(screenOf(first, 'cliff').meta).toMatchObject({ mode: 'library', chapter: 1, title: 'Hola, Rosa', library: { track: MARKET, episode: 1, line: 1, lines: 4, level: 0 } });
    const gen = make({ options: { source: 'generated' } });
    expect(gen.playsLibrary).toBe(false);
    expect(screenOf(await gen.next(T0), 'cliff').meta.mode).not.toBe('library');
    const none = make({ pair: noLibrary });
    expect(none.playsLibrary).toBe(false);
    expect(none.libraryProgress).toBeNull();
  });

  it('starts a coming-soon or unknown track as the first playable one; placement becomes the brandNew prior', async () => {
    const s = make({ library: { trackId: 'test.track.soon' }, startMode: 'placement' });
    expect(s.libraryProgress?.track).toBe(MARKET);
    expect(s.prior).toEqual({ kind: 'brandNew' });
    expect(make({ library: { startLevel: 2 } }).prior).toEqual({ kind: 'default' });
    expect(make({ library: { trackId: DATE } }).libraryProgress?.track).toBe(DATE);
  });
});

describe('recall mode (levels 0-1)', () => {
  it('plays and shows the whole line, then the gap with three seeded options', async () => {
    const s = make({ library: { startLevel: 0 } });
    const first = await s.next(T0);
    const playing = screenOf(first, 'cliff');
    expect(playing).toMatchObject({ mode: 'recall', phase: 'playing', speaker: 'Rosa', translation: 'Hi! My name is Rosa.', concept: 'saying your name' });
    expect(playing.sentence.words.map((w) => w.display)).toEqual(['text', 'text', 'text', 'text']);
    expect(playing.cliff.options).toBeUndefined();
    expect(playing.cliff.ui).toEqual({ key: 'cliff.recall.listen' });
    expect(first.speak).toMatchObject({ text: '¡Hola! Me llamo Rosa.', what: 'line' });
    const gap = s.played(T0 + 100);
    const g = screenOf(gap, 'cliff');
    expect(g.phase).toBe('gap');
    expect(g.sentence.words.map((w) => w.display)).toEqual(['text', 'text', 'gap', 'text']);
    expect(g.cliff.options?.map((o) => o.text).sort()).toEqual(['como', 'llamo', 'tengo']);
    expect(g.cliff).toMatchObject({ rung: 'options', ui: { key: 'cliff.recall.pick' } });
    expect(gap.speak).toMatchObject({ text: '¡Hola! Me … Rosa.', what: 'sentence', gap: { before: '¡Hola! Me', after: 'Rosa.' } });
    // The same seed gives the same order; "again" replays the gapped line.
    const again = await s.command('again', T0 + 200);
    expect(again.speak?.gap).toEqual({ before: '¡Hola! Me', after: 'Rosa.' });
    const s2 = make({ library: { startLevel: 0 } });
    await s2.next(T0);
    expect(screenOf(s2.played(T0 + 100), 'cliff').cliff.options).toEqual(g.cliff.options);
  });

  it('next() while the line plays shows the gap instead of skipping it', async () => {
    const s = make();
    await s.next(T0);
    const r = await s.next(T0 + 1);
    expect(screenOf(r, 'cliff').phase).toBe('gap');
    expect(r.events).toEqual([]);
  });

  it('lands a picked option with feedback: the story word, other natural answers, the translation', async () => {
    const s = make();
    const t = { now: T0 };
    await s.next(t.now);
    await s.handleUtterance('llamo', (t.now += 1000));
    await s.next((t.now += 1000)); // line 2
    await s.next((t.now += 1000)); // gap
    await s.handleUtterance('mercado', (t.now += 1000));
    await s.next((t.now += 1000)); // line 3: fruta, accept comida
    const gap = s.played((t.now += 100));
    const r = await s.pickOption(optionIndex(gap.screen, 'fruta'), (t.now += 1000));
    const landing = screenOf(r, 'landing');
    expect(landing).toMatchObject({
      mode: 'recall',
      answer: 'fruta',
      expected: 'fruta',
      alternatives: ['comida'],
      translation: 'Rosa has very good fruit.',
      scoredBy: 'options',
      speaker: 'Pablo',
    });
    expect(landing.outcome).toMatchObject({ credit: 'full', reason: 'actual' });
    expect(r.events).toEqual([{ type: 'cliff_answer', key: 'es:fruta', at: t.now, credit: 'full', rung: 'options' }]);
    expect(landing.sentence.words.every((w) => w.display === 'text')).toBe(true);
  });

  it('a wrong option gets no credit; a said or typed word counts as unaided', async () => {
    const s = make();
    await s.next(T0);
    const gap = s.played(T0 + 1);
    const wrong = await s.pickOption(optionIndex(gap.screen, 'tengo'), T0 + 2);
    expect(screenOf(wrong, 'landing').outcome).toMatchObject({ credit: 'none', answer: 'tengo' });
    expect(state(s).library?.tracks[MARKET]?.play).toMatchObject({ cliffs: 1, unaided: 0, lineDone: true });
    const s2 = make();
    await s2.next(T0);
    // Saying the word while the line still plays answers at the gap.
    const said = await s2.handleUtterance('Llamo', T0 + 2);
    expect(screenOf(said, 'landing').outcome).toMatchObject({ credit: 'full', scoredBy: 'canned' });
    expect(said.events[0]).toMatchObject({ type: 'cliff_answer', rung: 'hint' });
    expect(state(s2).library?.tracks[MARKET]?.play).toMatchObject({ cliffs: 1, unaided: 1 });
  });

  it('"no sé" gives the answer at once (the options are already there)', async () => {
    const s = make();
    await s.next(T0);
    s.played(T0 + 1);
    const r = await s.command('dont_know', T0 + 2);
    expect(screenOf(r, 'noSe')).toMatchObject({ answer: 'llamo', translation: 'Hi! My name is Rosa.', speaker: 'Rosa' });
    expect(r.speak).toMatchObject({ text: 'llamo', what: 'answer' });
  });
});

describe('hint mode (levels 2-3)', () => {
  it('shows the translation with the gap word in bold and takes a said answer', async () => {
    const s = make({ library: { startLevel: 2 } });
    const first = await s.next(T0);
    const c = screenOf(first, 'cliff');
    expect(c).toMatchObject({ mode: 'hint', phase: 'gap', translation: 'Hi! My name is Rosa.' });
    expect(c.translationHint).toEqual({ text: 'name', start: 7, end: 11, found: true });
    expect(c.cliff).toMatchObject({ rung: 'hint', ui: { key: 'cliff.hint.say' } });
    expect(c.cliff.options).toBeUndefined();
    // The rest of the line is heard: words after the gap are drawn, not 'future'.
    expect(c.sentence.words[3]?.display).not.toBe('future');
    expect(first.speak?.gap).toEqual({ before: '¡Hola! Me', after: 'Rosa.' });
    const r = await s.handleUtterance('llamo', T0 + 1);
    expect(screenOf(r, 'landing').outcome.credit).toBe('full');
    expect(r.events[0]).toMatchObject({ rung: 'hint', credit: 'full' });
    expect(state(s).library?.tracks[MARKET]?.play).toMatchObject({ cliffs: 1, unaided: 1 });
  });

  it('offers the options after one miss, then lands the pick as helped', async () => {
    const s = make({ library: { startLevel: 2 } });
    await s.next(T0);
    const miss = await s.handleUtterance('casa', T0 + 1);
    const c = screenOf(miss, 'cliff');
    expect(c).toMatchObject({ missed: 'casa', cliff: { rung: 'options', ui: { key: 'cliff.missed', params: { answer: 'casa' } } } });
    expect(c.cliff.options).toHaveLength(3);
    expect(miss.events).toEqual([{ type: 'cliff_answer', key: 'es:llamar', at: T0 + 1, credit: 'none', rung: 'hint' }]);
    const r = await s.pickOption(optionIndex(miss.screen, 'llamo'), T0 + 2);
    expect(screenOf(r, 'landing').outcome.credit).toBe('full');
    expect(r.events[0]).toMatchObject({ rung: 'options' });
    expect(state(s).library?.tracks[MARKET]?.play).toMatchObject({ cliffs: 1, unaided: 0 });
  });

  it('"no sé" brings the options, a second "no sé" the answer', async () => {
    const s = make({ library: { startLevel: 3 } });
    await s.next(T0);
    const one = await s.command('dont_know', T0 + 1);
    expect(screenOf(one, 'cliff').cliff).toMatchObject({ rung: 'options', ui: { key: 'cliff.pickOne' } });
    expect(one.command).toBe('dont_know');
    const two = await s.handleUtterance('no sé', T0 + 2);
    expect(screenOf(two, 'noSe').answer).toBe('llamo');
  });
});

describe('predict mode (levels 4-5)', () => {
  it('says what comes next: the rest of the line is not heard, no translation, any listed answer counts', async () => {
    const s = make({ library: { startLevel: 4 } });
    const first = await s.next(T0);
    const c = screenOf(first, 'cliff');
    expect(c).toMatchObject({ mode: 'predict', phase: 'gap', translation: null, cliff: { rung: 'free', ui: { key: 'cliff.prompt' } } });
    expect(c.sentence.words.map((w) => w.display).slice(2)).toEqual(['gap', 'future']);
    expect(first.speak).toMatchObject({ text: '¡Hola! Me', what: 'sentence' });
    expect(first.speak?.gap).toBeUndefined();
    const miss = await s.handleUtterance('casa', T0 + 1);
    expect(screenOf(miss, 'landing')).toMatchObject({ outcome: { credit: 'none' }, translation: 'Hi! My name is Rosa.' });
  });

  it('"no sé" gives options, then the answer', async () => {
    const s = make({ library: { startLevel: 5 } });
    await s.next(T0);
    expect(screenOf(await s.command('dont_know', T0 + 1), 'cliff').cliff.options).toHaveLength(3);
    expect(screenOf(await s.command('dont_know', T0 + 2), 'noSe').answer).toBe('llamo');
  });
});

describe('with the mock model', () => {
  it('scores a said answer with the model and says so, with model alternatives in the feedback', async () => {
    const s = make({ model, library: { startLevel: 4 } });
    await s.next(T0);
    const r = await s.handleUtterance('llamo', T0 + 1);
    const landing = screenOf(r, 'landing');
    expect(landing.scoredBy).toBe('model');
    expect(landing.outcome.notes).toContainEqual({ key: 'landing.modelChecked' });
    expect(landing.alternatives?.length).toBeLessThanOrEqual(3);
    expect(landing.alternatives).not.toContain('llamo');
    expect(state(s).current?.lib?.altsReady).toBe(true);
    expect(s.modelStats.calls).toBeGreaterThan(0);
  });

  it('a picked option gets the model alternatives too, and a prefetch on the cliff makes the tap free', async () => {
    const plainRun = make({ model });
    await plainRun.next(T0);
    plainRun.played(T0 + 1);
    const tapped = await plainRun.pickOption(0, T0 + 2);
    expect(screenOf(tapped, 'landing').scoredBy).toBe('options');

    const s = make({ model });
    await s.next(T0);
    s.played(T0 + 1);
    const info = await s.prefetch(T0 + 1);
    expect(info).toMatchObject({ prepared: true, next: 'cliff' });
    expect(info.modelCalls).toBeGreaterThan(0);
    const before = s.modelStats;
    const r = await s.pickOption(0, T0 + 2);
    expect(r).toEqual(tapped);
    expect(s.modelStats.calls).toBe(before.calls);
    expect(s.modelStats.replayed).toBeGreaterThan(before.replayed);
  });

  it('modelAlternatives off: a tap makes no model call', async () => {
    const s = make({ model, options: { library: { modelAlternatives: false } } });
    await s.next(T0);
    s.played(T0 + 1);
    await s.pickOption(0, T0 + 2);
    expect(s.modelStats.calls).toBe(0);
  });

  it('judges a learner turn with the repair flow', async () => {
    const s = make({ model, library: { startLevel: 4 } });
    const t = { now: T0 };
    for (let i = 0; i < 3; i++) {
      await s.next((t.now += 1000));
      await s.handleUtterance(answerOf(s), (t.now += 1000));
    }
    const turn = await s.next((t.now += 1000));
    expect(screenOf(turn, 'turn')).toMatchObject({ prompt: { speaker: 'Rosa', line: '¿Quieres bananas?' }, translation: 'Do you want bananas?', example: null });
    const r = await s.handleUtterance('Sí, quiero bananas.', (t.now += 1000));
    const rep = screenOf(r, 'repair');
    expect(rep.translation).toBe('Do you want bananas?');
    if (rep.done) expect(rep.example).toBe('Sí, quiero bananas, gracias.');
    const after = await s.next((t.now += 1000));
    expect(screenOf(after, 'cliff').meta.library?.lineId).toBe('e1.l04');
  });
});

describe('gender variants in play', () => {
  it('resolves {you:...} for the learner address, in lines and cliffs', async () => {
    const f = make({ library: { address: 'f' } });
    const t = { now: T0 };
    await playEpisode(f, t, () => 'say');
    await f.next((t.now += 1000));
    for (let i = 0; i < 3; i++) {
      await f.handleUtterance(answerOf(f), (t.now += 1000));
      await f.next((t.now += 1000));
    }
    expect(screenOf(f.screen, 'cliff').sentence.text).toBe('Pablo pregunta si estás lista.');
    expect(answerOf(f)).toBe('lista');
    const m = make({ library: { address: 'm' } });
    await m.next(T0);
    await m.handleUtterance('llamo', T0 + 1);
    expect(screenOf(await m.next(T0 + 2), 'cliff').sentence.text).toBe('¡Bienvenido al mercado!');
  });

  it('resolves a partner choice (gender and name), the default being the first option', async () => {
    const ana = make({ library: { trackId: DATE, choices: { partner: 'ana' }, address: 'f' } });
    expect(screenOf(await ana.next(T0), 'cliff').sentence.text).toBe('Hoy tienes una cita con Ana.');
    await ana.handleUtterance('cita', T0 + 1);
    const l2 = screenOf(await ana.next(T0 + 2), 'cliff');
    expect(l2).toMatchObject({ speaker: 'Ana', translation: 'Hi! You look very pretty.' });
    expect(l2.sentence.text).toBe('¡Hola! Estás muy guapa.');
    const leo = make({ library: { trackId: DATE } });
    expect(screenOf(await leo.next(T0), 'cliff').sentence.text).toBe('Hoy tienes una cita con Leo.');
    expect(leo.libraryProgress?.tracks.find((x) => x.id === DATE)?.missingChoices).toEqual(['partner']);
    expect(ana.libraryProgress?.tracks.find((x) => x.id === DATE)?.missingChoices).toEqual([]);
  });

  it('hint mode bolds a gloss written with variants', async () => {
    const s = make({ library: { trackId: DATE, startLevel: 2, address: 'm' } });
    await s.next(T0);
    await s.handleUtterance('cita', T0 + 1);
    const c = screenOf(await s.next(T0 + 2), 'cliff');
    expect(c.translation).toBe('Hi! You look very handsome.');
    expect(c.translationHint).toMatchObject({ text: 'handsome', found: true });
  });
});

describe('episodes and tracks', () => {
  it('plays episodes in order with their turns, then trackDone suggesting another experience', async () => {
    const s = make();
    const t = { now: T0 };
    const lineIds: string[] = [];
    let step = await s.next(t.now);
    const kinds: string[] = [];
    for (let guard = 0; guard < 100 && step.screen.kind !== 'trackDone'; guard++) {
      const sc = step.screen;
      kinds.push(sc.kind);
      if (sc.kind === 'cliff') {
        lineIds.push(`${sc.meta.chapter}:${sc.meta.library?.lineId}`);
        await s.handleUtterance(answerOf(s), (t.now += 1000));
      }
      if (sc.kind === 'turn') {
        expect(sc.meta.library?.line).toBe(3);
        lineIds.push(`${sc.meta.chapter}:turn`);
      }
      step = await s.next((t.now += 1000));
    }
    expect(lineIds).toEqual(['1:e1.l01', '1:e1.l02', '1:e1.l03', '1:turn', '1:e1.l04', '2:e2.l01', '2:e2.l02', '2:e2.l03', '2:e2.l04', '3:e3.l01', '3:e3.l02', '3:e3.l03']);
    expect(kinds.filter((k) => k === 'episodeDone')).toHaveLength(3);
    const done = screenOf(step, 'trackDone');
    expect(done).toMatchObject({ track: MARKET, title: 'Market day', episodes: 3, ui: { key: 'track.done', params: { title: 'Market day' } } });
    expect(done.suggestions.map((x) => x.id)).toEqual([DATE]);
    // next() stays on trackDone; the track is done in the picker.
    expect((await s.next((t.now += 1000))).screen.kind).toBe('trackDone');
    const view = s.libraryProgress?.tracks.find((x) => x.id === MARKET);
    expect(view).toMatchObject({ completed: [1, 2, 3], done: true, next: null, playing: null });
    expect(s.libraryProgress?.tracks.find((x) => x.id === 'test.track.soon')).toMatchObject({ comingSoon: true, next: null });
  });

  it('episodeDone shows the counts, the level change and the next episode', async () => {
    const s = make({ library: { startLevel: 1 } });
    const t = { now: T0 };
    const done = await playEpisode(s, t, () => 'say');
    expect(done).toMatchObject({
      track: MARKET,
      episode: 1,
      title: 'Hola, Rosa',
      titleNative: 'Hi, Rosa',
      cliffs: 4,
      unaided: 4,
      levelBefore: 1,
      levelAfter: 2,
      levelChange: 1,
      next: { episode: 2, title: 'La lista', titleNative: 'The list' },
      replay: false,
      ui: { key: 'episode.done', params: { episode: 1, title: 'Hi, Rosa' } },
      levelUi: { key: 'episode.levelUp', params: { level: 2 } },
    });
    // The next episode is played in the new level's mode.
    const next = screenOf(await s.next((t.now += 1000)), 'cliff');
    expect(next).toMatchObject({ mode: 'hint', meta: { chapter: 2, library: { level: 2, mode: 'hint' } } });
  });

  it('moves the level down under 50% unaided and keeps it between', async () => {
    const down = make({ library: { startLevel: 1 } });
    // Every option picked right: all correct, none unaided.
    expect(await playEpisode(down, { now: T0 }, () => 'pick')).toMatchObject({ unaided: 0, correct: 4, levelAfter: 0, levelChange: -1, levelUi: { key: 'episode.levelDown' } });
    const floor = make({ library: { startLevel: 0 } });
    expect(await playEpisode(floor, { now: T0 }, () => 'noSe')).toMatchObject({ cliffs: 4, unaided: 0, levelAfter: 0, levelChange: 0, levelUi: { key: 'episode.levelSame' } });
    const stay = make({ library: { startLevel: 3 } });
    // 2 of 4 unaided: 50% stays.
    expect(await playEpisode(stay, { now: T0 }, (i) => (i < 2 ? 'say' : 'wrong'))).toMatchObject({ cliffs: 4, unaided: 2, correct: 2, levelAfter: 3, levelChange: 0 });
    const skip = make({ library: { startLevel: 4 } });
    expect(await playEpisode(skip, { now: T0 }, () => 'skip')).toMatchObject({ cliffs: 4, unaided: 0, levelAfter: 3 });
    expect(state(skip).library?.tracks[MARKET]?.results).toEqual([
      { episode: 1, storyId: 'test.market.e1', cliffs: 4, unaided: 0, correct: 0, levelBefore: 4, levelAfter: 3, replay: false, at: expect.any(Number) },
    ]);
  });

  it('switching tracks keeps each track where it was', async () => {
    const s = make();
    const t = { now: T0 };
    await s.next(t.now);
    await s.handleUtterance('llamo', (t.now += 1000));
    await s.next((t.now += 1000)); // market line 2, not answered
    const toDate = await s.chooseTrack(DATE, (t.now += 1000), { partner: 'ana' });
    expect(screenOf(toDate, 'cliff')).toMatchObject({ meta: { library: { track: DATE, episode: 1, lineId: 'e1.l01' } } });
    expect(toDate.screen.kind === 'cliff' && toDate.screen.sentence.text).toBe('Hoy tienes una cita con Ana.');
    await s.handleUtterance('cita', (t.now += 1000)); // answered, then leave
    const back = await s.chooseTrack(MARKET, (t.now += 1000));
    expect(screenOf(back, 'cliff').meta.library).toMatchObject({ track: MARKET, lineId: 'e1.l02' });
    expect(state(s).library?.tracks[MARKET]?.play).toMatchObject({ cliffs: 1, line: 1 });
    const again = await s.chooseTrack(DATE, (t.now += 1000));
    // The answered line is done: the date track goes on with its next line.
    expect(screenOf(again, 'cliff').meta.library).toMatchObject({ track: DATE, lineId: 'e1.l02' });
    expect(s.libraryProgress?.tracks.find((x) => x.id === DATE)?.choices).toEqual({ partner: 'ana' });
    // A coming-soon track changes nothing.
    const soon = await s.chooseTrack('test.track.soon', (t.now += 1000));
    expect(soon.screen).toEqual(again.screen);
  });

  it('replays a finished episode, then resumes the episode in progress', async () => {
    const s = make();
    const t = { now: T0 };
    await playEpisode(s, t, () => 'say');
    await s.next((t.now += 1000)); // episode 2, line 1
    await s.handleUtterance(answerOf(s), (t.now += 1000));
    expect((await s.replayEpisode(3, (t.now += 1000))).screen.kind).toBe('landing'); // not finished: no change
    const replay = await s.replayEpisode(1, (t.now += 1000));
    expect(screenOf(replay, 'cliff').meta.library).toMatchObject({ episode: 1, lineId: 'e1.l01', replay: true });
    // playEpisode starts with next(), which at a line still playing shows its gap.
    const done = await playEpisode(s, t, () => 'say');
    expect(done).toMatchObject({ episode: 1, replay: true, cliffs: 4, unaided: 4, next: { episode: 2 } });
    const resumed = screenOf(await s.next((t.now += 1000)), 'cliff');
    expect(resumed.meta.library).toMatchObject({ episode: 2, lineId: 'e2.l02', replay: false });
    expect(s.libraryProgress?.tracks.find((x) => x.id === MARKET)?.completed).toEqual([1]);
  });

  it('setLibraryProfile changes the address from the next line and the level from the next episode', async () => {
    const s = make();
    await s.next(T0);
    expect(s.setLibraryProfile({ address: 'f', level: 4 }, T0 + 1).screen.kind).toBe('cliff');
    expect(s.libraryProgress).toMatchObject({ address: 'f', level: 4 });
    await s.handleUtterance('llamo', T0 + 2);
    const next = screenOf(await s.next(T0 + 3), 'cliff');
    expect(next.sentence.text).toBe('¡Bienvenida al mercado!');
    expect(next.mode).toBe('recall');
  });
});

describe('learner turns without a model', () => {
  async function toTurn(s: StorySession): Promise<StoryStep> {
    let t = T0;
    for (let i = 0; i < 3; i++) {
      await s.next((t += 1000));
      await s.handleUtterance(answerOf(s), (t += 1000));
    }
    return s.next((t += 1000));
  }

  it('accepts a reply with Spanish words and shows the example', async () => {
    const s = make();
    const turn = screenOf(await toTurn(s), 'turn');
    expect(turn).toMatchObject({ prompt: { speaker: 'Rosa' }, ui: { key: 'story.asks', params: { speaker: 'Rosa' } }, example: null, reply: null });
    const r = await s.handleUtterance('Sí, quiero dos.', T0 + 10_000);
    expect(screenOf(r, 'turn')).toMatchObject({
      reply: { heard: 'Sí, quiero dos.', accepted: true, scoredBy: 'canned', ui: { key: 'turn.accepted' } },
      example: 'Sí, quiero bananas, gracias.',
      exampleUi: { key: 'turn.example', params: { example: 'Sí, quiero bananas, gracias.' } },
    });
  });

  it('does not accept a reply without Spanish words; an English reply gets the Spanish to say', async () => {
    const s = make({ settings: { nativeAnswersAllowed: false } });
    await toTurn(s);
    const r = await s.handleUtterance('hello there', T0 + 10_000);
    expect(screenOf(r, 'turn').reply).toMatchObject({ accepted: false, ui: { key: 'turn.trySpanish' } });
    const n = make();
    await toTurn(n);
    const e = await n.handleUtterance('yes please', T0 + 10_000);
    expect(screenOf(e, 'turn').native).toBeDefined();
  });

  it('"no sé" shows and plays the example; next() goes on with the story', async () => {
    const s = make();
    await toTurn(s);
    const r = await s.command('dont_know', T0 + 10_000);
    expect(screenOf(r, 'turn').example).toBe('Sí, quiero bananas, gracias.');
    expect(r.speak).toMatchObject({ text: 'Sí, quiero bananas, gracias.', what: 'answer' });
    expect(screenOf(await s.next(T0 + 11_000), 'cliff').meta.library?.lineId).toBe('e1.l04');
  });
});

describe('snapshots', () => {
  it('restores mid-episode to the same screen and the same next steps', async () => {
    const s = make({ library: { trackId: DATE, choices: { partner: 'ana' } } });
    const t = { now: T0 };
    await s.next(t.now);
    await s.handleUtterance('cita', (t.now += 1000));
    await s.next((t.now += 1000));
    const snap = JSON.parse(JSON.stringify(s.snapshot())) as StorySessionSnapshot;
    expect(snap.format).toBe(STORY_SESSION_FORMAT);
    expect(STORY_SESSION_FORMAT).toBe(2);
    const r = StorySession.restore(snap, { model: null, pack, pair, learner: learnerOf(s) });
    expect(r.screen).toEqual(s.screen);
    expect(r.libraryProgress).toEqual(s.libraryProgress);
    expect(r.played(t.now + 1)).toEqual(s.played(t.now + 1));
    expect(await r.handleUtterance('guapa', t.now + 2)).toEqual(await s.handleUtterance('guapa', t.now + 2));
    expect(await r.next(t.now + 3)).toEqual(await s.next(t.now + 3));
  });

  it('restores mid-turn', async () => {
    const s = make();
    let t = T0;
    for (let i = 0; i < 3; i++) {
      await s.next((t += 1000));
      await s.handleUtterance(answerOf(s), (t += 1000));
    }
    await s.next((t += 1000));
    const r = StorySession.restore(JSON.parse(JSON.stringify(s.snapshot())), { model: null, pack, pair, learner: learnerOf(s) });
    expect(screenOf(r.screen, 'turn').prompt.line).toBe('¿Quieres bananas?');
    expect(await r.next(t + 1)).toEqual(await s.next(t + 1));
  });

  it('a format 1 snapshot starts a fresh library session (no crash)', async () => {
    const old = make({ pair: noLibrary, startMode: 'brand_new', seed: 42 });
    await old.next(T0);
    const snap = old.snapshot() as unknown as { format: number; kind: 'story'; state: Record<string, unknown> };
    const v1 = { ...snap, format: 1, state: { ...snap.state } };
    delete v1.state.source;
    delete v1.state.library;
    const fresh = StorySession.restore(v1 as unknown as StorySessionSnapshot, { model: null, pack, pair, learner: new LearnerModel() }, { library: { startLevel: 2, address: 'f' } });
    expect(fresh.playsLibrary).toBe(true);
    expect(fresh.screen.kind).toBe('idle');
    expect(fresh.libraryProgress).toMatchObject({ level: 2, address: 'f', track: MARKET });
    expect(state(fresh).seed).toBe(42);
    expect(screenOf(await fresh.next(T0), 'cliff').meta.library).toMatchObject({ episode: 1, lineId: 'e1.l01', mode: 'hint' });
    // Without a library the old session restores as it was.
    const same = StorySession.restore(v1 as unknown as StorySessionSnapshot, { model: null, pack, pair: noLibrary, learner: new LearnerModel() });
    expect(same.playsLibrary).toBe(false);
    expect(same.screen).toEqual(old.screen);
    expect(() => StorySession.restore({ ...old.snapshot(), format: 7 as typeof STORY_SESSION_FORMAT }, { model: null, pack, pair, learner: new LearnerModel() })).toThrow(/unsupported/);
  });

  it('a story that left the library restarts that episode with what is there', async () => {
    const s = make();
    await s.next(T0);
    await s.handleUtterance('llamo', T0 + 1);
    const snap = JSON.parse(JSON.stringify(s.snapshot())) as StorySessionSnapshot;
    const renamed = TEST_LIBRARY.map((x) => (x.id === 'test.market.e1' ? { ...x, id: 'test.market.e1.v2' } : x));
    const r = StorySession.restore(snap, { model: null, pack, pair: { ...pair, library: renamed }, learner: new LearnerModel() });
    const next = screenOf(await r.next(T0 + 2), 'cliff');
    expect(next.meta.library).toMatchObject({ storyId: 'test.market.e1.v2', lineId: 'e1.l01' });
  });
});

describe('simulated learners through the test library', () => {
  type Learner = { name: string; startLevel: number; policy: (i: number, s: StorySession, screen: Extract<StoryScreen, { kind: 'cliff' }>) => Promise<void> };
  const learners: Learner[] = [
    {
      name: 'brand new: taps, sometimes says, sometimes "no sé"',
      startLevel: 0,
      policy: async (i, s, c) => {
        const t = T0 + i * 1000;
        if (i % 5 === 4) await s.command('dont_know', t);
        else if (i % 3 === 2) await s.handleUtterance(answerOf(s), t);
        else await s.pickOption(c.cliff.options?.findIndex((o) => o.text === answerOf(s)) ?? 0, t);
      },
    },
    {
      name: 'a little: says answers, misses one in four',
      startLevel: 2,
      policy: async (i, s) => {
        const t = T0 + i * 1000;
        if (i % 4 === 3) {
          const r = await s.handleUtterance('casa', t);
          if (r.screen.kind === 'cliff') await s.pickOption(0, t + 1);
        } else await s.handleUtterance(answerOf(s), t);
      },
    },
    {
      name: 'comfortable: says answers, now and then "no sé" twice',
      startLevel: 4,
      policy: async (i, s) => {
        const t = T0 + i * 1000;
        if (i % 6 === 5) {
          await s.command('dont_know', t);
          await s.command('dont_know', t + 1);
        } else await s.handleUtterance(answerOf(s), t);
      },
    },
  ];

  for (const withModel of [false, true]) {
    for (const l of learners) {
      it(`${l.name}${withModel ? ' (mock model)' : ''}: both tracks to the end without stalls`, async () => {
        const s = make({ model: withModel ? model : null, library: { startLevel: l.startLevel }, seed: 7 });
        let t = T0;
        let cliffs = 0;
        const levels: number[] = [];
        for (const track of [MARKET, DATE]) {
          let step = track === MARKET ? await s.next((t += 1000)) : await s.chooseTrack(track, (t += 1000));
          for (let guard = 0; step.screen.kind !== 'trackDone'; guard++) {
            expect(guard).toBeLessThan(200);
            const sc = step.screen;
            expect(sc.kind).not.toBe('error');
            expect(sc.kind).not.toBe('idle');
            if (sc.kind === 'cliff') {
              cliffs++;
              if (sc.phase === 'playing') s.played((t += 500));
              const c = screenOf(s.screen, 'cliff');
              await l.policy(cliffs, s, c);
              expect(['landing', 'noSe', 'nativeReply']).toContain(s.screen.kind);
            } else if (sc.kind === 'turn') {
              await s.handleUtterance('Sí, me gusta.', (t += 1000));
            } else if (sc.kind === 'episodeDone') {
              levels.push(sc.levelAfter);
              expect(Math.abs(sc.levelAfter - sc.levelBefore)).toBeLessThanOrEqual(1);
            }
            step = await s.next((t += 1000));
          }
        }
        expect(cliffs).toBe(TEST_LIBRARY.reduce((n, x) => n + x.sentences.length, 0));
        expect(levels).toHaveLength(6);
        for (const lv of levels) expect(lv).toBeGreaterThanOrEqual(0);
        expect(s.libraryProgress?.tracks.filter((x) => x.done).map((x) => x.id)).toEqual([MARKET, DATE]);
      });
    }
  }
});
