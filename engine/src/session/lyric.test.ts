/**
 * LyricSession over the design-preview song ("Luna de Santurce" by Rayo K., A3/C1/B4
 * screens) and over a brought text, with the real Spanish and en-es packs (Puerto Rico
 * registers) and either no model or the mock model.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, slangLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import { LearnerModel, type PriorFn } from '../learner/model';
import { parseLyrics } from '../lyrics/parse';
import { LyricSession, type LyricSessionCreate } from './lyric';
import type { LyricScreen, LyricStep } from './types';

const pack = createDefaultSpanishPack({ regions: ['PR'] });
const pair = createDefaultPairPack({ regions: ['PR'] });
const model = createMockModel();
const T0 = Date.UTC(2026, 10, 15, 20, 0, 0);

/** The two lines the design previews show (A3, C1), as pasted from a lyrics site. */
const PREVIEW = [
  '3 ContributorsLuna de Santurce Lyrics',
  '[Verso 1: Rayo K.]',
  'Esta noche salimos a janguear,',
  "el corillo ya ’tá listo pa’ bailar",
].join('\n');
/** The same lines with LRC times and enhanced word marks on the second line. */
const PREVIEW_LRC = [
  '[ti:Luna de Santurce]',
  '[ar:Rayo K.]',
  '[00:12.00]Esta noche salimos a janguear,',
  "[00:15.50]el corillo ya <00:17.20>'tá <00:17.60>listo <00:18.00>pa' <00:18.40>bailar",
  '[00:20.00]',
].join('\n');

const fluent: PriorFn = () => 0.9;

function make(over: Partial<LyricSessionCreate> = {}, raw = PREVIEW): LyricSession {
  return LyricSession.create({
    model: null,
    pack,
    pair,
    learner: new LearnerModel(),
    now: T0,
    seed: 4,
    source: { kind: 'lyrics', lyrics: parseLyrics(raw, pack) },
    song: { title: 'Luna de Santurce', artist: 'Rayo K.' },
    ...over,
  });
}
const cliffOf = (s: LyricSession) => s.snapshot().state.cliff;
function screenOf<K extends LyricScreen['kind']>(step: LyricStep | { screen: LyricScreen }, kind: K): Extract<LyricScreen, { kind: K }> {
  expect(step.screen.kind).toBe(kind);
  return step.screen as Extract<LyricScreen, { kind: K }>;
}

describe('the song page', () => {
  it('lists the slang notes (keyed like the register packs) and underlines slang in the lines', () => {
    const read = screenOf({ screen: make().screen }, 'read');
    expect(read.meta).toMatchObject({ title: 'Luna de Santurce', artist: 'Rayo K.', total: 2, register: 'neutral', canned: true, source: 'lyrics' });
    expect(read.playback).toBe('manual');
    expect(read.notes.map((n) => n.form)).toEqual(['janguear', 'corillo', "'tá", "pa'"]);
    const keys = new Set(slangLexemeKeys(pack));
    for (const n of read.notes) expect(keys.has(n.key), n.key).toBe(true);
    expect(read.notes[0]).toMatchObject({ gloss: expect.stringContaining('hang out'), labels: { formality: 'slang.formality.casual', regions: ['region.PR'] } });
    expect(read.lines.map((l) => l.text)).toEqual(['Esta noche salimos a janguear,', "el corillo ya 'tá listo pa' bailar"]);
    expect(read.lines[1]?.slang.map((x) => read.lines[1]?.text.slice(x.start, x.end))).toEqual(['corillo', "'tá", "pa'"]);
    expect(read.lines[0]?.masked).toEqual([]);
  });

  it('shows neutral and street side by side when the register is toggled', () => {
    const s = make();
    const r = screenOf(s.setRegister('street', T0), 'registers');
    expect(r.meta.register).toBe('street');
    expect(r.pairs[1]).toEqual({
      lineIndex: 1,
      street: "el corillo ya 'tá listo pa' bailar",
      neutral: 'el grupo ya está listo para bailar',
      swaps: [
        { from: 'grupo', to: 'corillo' },
        { from: 'está', to: "'tá" },
        { from: 'para', to: "pa'" },
      ],
    });
    expect(s.settings.register).toBe('street');
    expect(screenOf(s.showSong(), 'read').meta.register).toBe('street');
  });

  it('hides explicit slang when explicit lyrics are off, and never makes it a cliff', async () => {
    const raw = 'Esta noche salimos a janguear,\nese corillo es bien pendejo';
    const on = screenOf({ screen: make({}, raw).screen }, 'read');
    expect(on.notes.map((n) => n.form)).toContain('pendejo');
    const s = make({ settings: { showExplicit: false } }, raw);
    const off = screenOf({ screen: s.screen }, 'read');
    expect(off.notes.map((n) => n.form)).not.toContain('pendejo');
    expect(off.lines[1]?.masked.map((x) => off.lines[1]?.text.slice(x.start, x.end))).toEqual(['pendejo']);
    await s.next(T0);
    await s.command('next', T0 + 1);
    expect(cliffOf(s)?.answer).not.toBe('pendejo');
  });
});

describe('lyric cliffs without a model', () => {
  it('stops before the last word, credits the lyric and its neutral paraphrase, and sings the line back', async () => {
    const s = make();
    const st = await s.next(T0);
    const c = screenOf(st, 'cliff');
    expect(c).toMatchObject({ lineIndex: 0, previous: '', before: 'Esta noche salimos a ', gapLength: 1, rung: 'options', slang: true });
    expect(c.play).toEqual({ mode: 'manual', startMs: null, endMs: null, pauseAtMs: null, precise: false });
    expect(c.options?.map((o) => o.text)).toContain('janguear');
    expect(c.options?.length).toBe(3);
    // Distractors are content words of the other line (never the determiner "el").
    for (const o of c.options ?? []) {
      if (o.text === 'janguear') continue;
      expect(o.text).not.toBe('el');
      expect("el corillo ya 'tá listo pa' bailar".split(' ')).toContain(o.text);
    }
    expect(st.speak).toEqual({ text: 'Esta noche salimos a', rate: 1, what: 'line' });
    const r = await s.handleUtterance('salir', T0 + 1000);
    const res = screenOf(r, 'result');
    expect(res.outcome).toMatchObject({ credit: 'full', reason: 'likely', expected: 'janguear', scoredBy: 'canned' });
    expect(res.line).toBe('Esta noche salimos a janguear,');
    expect(r.events).toEqual([{ type: 'cliff_answer', key: 'es:janguear', at: T0 + 1000, credit: 'full', rung: 'options' }]);

    const echo = s.startEcho(T0 + 2000);
    expect(screenOf(echo, 'echo')).toMatchObject({ tiles: null, landed: null, total: 5, ui: { key: 'music.singBack' } });
    expect(echo.speak).toMatchObject({ text: 'Esta noche salimos a janguear,', what: 'line' });
    const sung = await s.handleUtterance('esta noche salimos a janguear', T0 + 3000, { durationMs: 2500 });
    const e = screenOf(sung, 'echo');
    expect(e).toMatchObject({ landed: 5, total: 5, ui: { key: 'echo.landed', params: { n: 5, m: 5 } } });
    expect(e.tiles?.find((x) => x.text === 'janguear')).toEqual({ text: 'janguear', slang: true, status: 'landed' });
    expect(sung.events).toEqual([{ type: 'spoke_correct', key: 'es:janguear', at: T0 + 3000 }]);
    expect(e.meta.spokenMs).toBe(2500);
    const missed = await s.handleUtterance('esta noche salimos', T0 + 4000);
    expect(screenOf(missed, 'echo').landed).toBe(3);
    expect(missed.events).toEqual([]);
  });

  it('takes the slang span as the cliff in street register and credits its neutral form', async () => {
    const s = make({ settings: { register: 'street' } });
    await s.next(T0);
    await s.command('next', T0 + 1);
    expect(cliffOf(s)).toMatchObject({ answer: 'corillo', key: 'es:corillo', accepted: ['corillo', 'grupo'], slang: true });
    const r = await s.handleUtterance('grupo', T0 + 2);
    expect(screenOf(r, 'result').outcome).toMatchObject({ credit: 'full', reason: 'likely' });
  });

  it('handles options, no sé, native answers and commands', async () => {
    const s = make();
    const c = screenOf(await s.next(T0), 'cliff');
    const wrong = c.options?.find((o) => o.text !== 'janguear')?.index ?? -1;
    expect(screenOf(await s.pickOption(wrong, T0 + 1), 'result').outcome).toMatchObject({ credit: 'none', scoredBy: 'options' });

    const again = await s.handleUtterance('otra vez', T0 + 2);
    expect(again).toMatchObject({ command: 'again', speak: { text: 'Esta noche salimos a janguear,', what: 'line' } });
    const meaning = await s.handleUtterance('qué significa corillo', T0 + 3);
    expect(meaning.meaning).toMatchObject({ word: 'corillo', key: 'es:corillo', gloss: expect.stringContaining('crew') });
    expect(meaning.events).toEqual([{ type: 'gloss_lookup', key: 'es:corillo', at: T0 + 3 }]);

    const next = await s.handleUtterance('siguiente', T0 + 4);
    const c2 = screenOf(next, 'cliff');
    expect(c2.previous).toBe('Esta noche salimos a janguear,');
    expect(cliffOf(s)?.answer).toBe('bailar');
    const slower = await s.handleUtterance('más despacio', T0 + 5);
    expect(slower.speak?.rate).toBeCloseTo(0.8);
    const native = await s.handleUtterance('dance', T0 + 6);
    expect(screenOf(native, 'nativeReply')).toMatchObject({ heard: 'dance', target: 'bailar', ui: { key: 'cliff.repeatAloud' } });
    expect(native.events).toEqual([{ type: 'native_gap', key: 'es:bailar', at: T0 + 6 }]);
    const rep = await s.handleUtterance('bailar', T0 + 7);
    expect(rep.events).toEqual([{ type: 'spoke_correct', key: 'es:bailar', at: T0 + 7 }]);

    const s2 = make();
    await s2.next(T0);
    const ns = await s2.handleUtterance('no sé', T0 + 1);
    expect(screenOf(ns, 'noSe')).toMatchObject({ step: 'play_answer', answer: 'janguear' });
    expect(ns.events).toEqual([{ type: 'cliff_skip', key: 'es:janguear', at: T0 + 1 }]);
    expect(screenOf(s2.played(T0 + 2), 'noSe').step).toBe('prompt_repeat');
    const hit = await s2.handleUtterance('janguear', T0 + 3);
    expect(screenOf(hit, 'noSe').step).toBe('done');
    expect(hit.events).toEqual([{ type: 'spoke_correct', key: 'es:janguear', at: T0 + 3 }]);
    const done = await s2.handleUtterance('listo', T0 + 4);
    expect(screenOf(done, 'done')).toMatchObject({ answered: 1, full: 0 });
  });

  it('reaches the end of the song with the counts', async () => {
    const s = make({ learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    await s.next(T0);
    await s.handleUtterance(cliffOf(s)?.answer ?? '', T0 + 1);
    await s.next(T0 + 2);
    await s.handleUtterance(cliffOf(s)?.answer ?? '', T0 + 3);
    expect(screenOf(await s.next(T0 + 4), 'done')).toMatchObject({ answered: 2, full: 2 });
    expect((await s.next(T0 + 5)).screen.kind).toBe('done');
  });
});

describe('playback', () => {
  it('times lines from LRC and pauses at the first hidden word when it has a mark (mock model)', async () => {
    const s = make({ model, settings: { register: 'street' } }, PREVIEW_LRC);
    expect(screenOf({ screen: s.screen }, 'read').playback).toBe('timed');
    const c0 = screenOf(await s.next(T0), 'cliff');
    expect(c0.play).toMatchObject({ mode: 'timed', startMs: 12000, endMs: 15500, pauseAtMs: 12000, precise: false });
    await s.command('next', T0 + 1);
    const c1 = screenOf({ screen: s.screen }, 'cliff');
    const cliff = cliffOf(s);
    const marks: Record<string, number> = { "'tá": 17200, listo: 17600, "pa'": 18000, bailar: 18400 };
    const first = cliff?.answer.split(' ')[0] ?? '';
    if (marks[first] !== undefined) expect(c1.play).toMatchObject({ mode: 'timed', startMs: 15500, endMs: 20000, pauseAtMs: marks[first], precise: true });
    else expect(c1.play).toMatchObject({ mode: 'timed', startMs: 15500, pauseAtMs: 15500, precise: false });
    const r = await s.handleUtterance(cliff?.answer ?? '', T0 + 2);
    expect(screenOf(r, 'result').outcome).toMatchObject({ credit: 'full', reason: 'actual', scoredBy: cliff?.rung === 'options' ? 'options' : 'model' });
  });

  it('credits the neutral word for a street lyric, with the reason (mock model)', async () => {
    const s = make({ model, learner: new LearnerModel({ prior: fluent }), applyEvents: false, settings: { register: 'street' } }, PREVIEW_LRC);
    await s.next(T0);
    await s.command('next', T0 + 1);
    const cliff = cliffOf(s);
    expect(cliff?.slang).toBe(true);
    const neutral = cliff?.accepted[1] as string;
    expect(neutral).toBeTruthy();
    const r = await s.handleUtterance(neutral, T0 + 2);
    const o = screenOf(r, 'result').outcome;
    expect(o.credit).toBe('full');
    expect(o.explanation?.key).toBe('lyrics.answer.neutralForStreet');
  });

  it('uses the line times the learner tapped when there is no LRC', async () => {
    const s = make();
    s.markLine(0, 12000);
    s.markLine(1, 15400);
    expect(screenOf({ screen: s.screen }, 'read').playback).toBe('tapped');
    const c = screenOf(await s.next(T0), 'cliff');
    expect(c.play).toEqual({ mode: 'tapped', startMs: 12000, endMs: 15400, pauseAtMs: 12000, precise: false });
  });
});

describe('brought text', () => {
  const TEXT = 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado.';

  it('runs cliffs over the sentences of a text the learner brings', async () => {
    const s = make({ source: { kind: 'text', text: TEXT }, song: { title: 'El mercado' } });
    const read = screenOf({ screen: s.screen }, 'read');
    expect(read.meta).toMatchObject({ source: 'text', total: 2, title: 'El mercado', artist: '' });
    const c = screenOf(await s.next(T0), 'cliff');
    expect(c.before).toBe('Marta llegó tarde al ');
    expect(cliffOf(s)?.answer).toBe('mercado');
    expect(screenOf(await s.handleUtterance('mercado', T0 + 1), 'result').outcome.credit).toBe('full');
  });

  it('ranks multi-word cliffs with the model', async () => {
    const learner = new LearnerModel({ prior: fluent });
    const s = make({ model, learner, applyEvents: false, source: { kind: 'text', text: TEXT } });
    await s.next(T0);
    const cliff = cliffOf(s);
    expect(cliff).not.toBeNull();
    expect(cliff?.context.startsWith(pack.scoringPrefix ?? '')).toBe(true);
    const r = await s.handleUtterance(cliff?.answer ?? '', T0 + 1);
    expect(screenOf(r, 'result').outcome.reason).toBe('actual');
  });
});

describe('snapshot and restore', () => {
  it('is JSON-serializable and resumes mid-song identically', async () => {
    const s = make({ settings: { register: 'street' } });
    await s.next(T0);
    await s.handleUtterance('no sé', T0 + 1);
    const snap = JSON.parse(JSON.stringify(s.snapshot()));
    expect(snap).toEqual(s.snapshot());
    expect(snap.format).toBe(1);
    expect(snap.kind).toBe('lyric');
    const r = LyricSession.restore(snap, { model: null, pack, pair, learner: LearnerModel.restore(s.learner.snapshot()) });
    expect(r.screen).toEqual(s.screen);
    expect(await r.handleUtterance('janguear', T0 + 2)).toEqual(await s.handleUtterance('janguear', T0 + 2));
    expect(await r.next(T0 + 3)).toEqual(await s.next(T0 + 3));
    expect(() => LyricSession.restore({ ...snap, kind: 'story' }, { model: null, pack, pair, learner: new LearnerModel() })).toThrow(/unsupported/);
  });
});
