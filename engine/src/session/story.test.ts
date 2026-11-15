/**
 * StorySession driven end to end with the real Spanish and en-es packs, the en-es starter
 * story, and either no model (canned mode) or the deterministic mock model.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack, frequencyLexemeKeys } from '../packs';
import { createMockModel } from '../model/mock';
import { LearnerModel } from '../learner/model';
import type { PriorFn } from '../learner/model';
import { lexemeKey, type LearnerEvent } from '../learner/types';
import type { PairPack, StarterStory } from '../pair/types';
import { EN_ES_STARTER } from '../pair/en-es/starter';
import { buildPrior } from './common';
import { StorySession, type StorySessionCreate } from './story';
import type { StoryScreen, StoryStep } from './types';

const pack = createDefaultSpanishPack();
const pair: PairPack = { ...createDefaultPairPack(), starter: EN_ES_STARTER };
const model = createMockModel();
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);

function make(over: Partial<StorySessionCreate> = {}): StorySession {
  return StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 11, ...over });
}
const state = (s: StorySession) => s.snapshot().state;
const answerOf = (s: StorySession) => state(s).current?.cliff.answer ?? '';
const cliffKey = (s: StorySession) => state(s).current?.cliff.key ?? '';
const kinds = (events: readonly LearnerEvent[]) => events.map((e) => e.type);
function screenOf<K extends StoryScreen['kind']>(step: StoryStep, kind: K): Extract<StoryScreen, { kind: K }> {
  expect(step.screen.kind).toBe(kind);
  return step.screen as Extract<StoryScreen, { kind: K }>;
}

/** A small starter for controlled scenarios (the market scene of the design). */
const MARKET: StarterStory = {
  id: 'test.market',
  title: 'El mercado',
  character: 'Marta',
  taught: [],
  sentences: [
    { text: 'Marta llegó tarde al mercado.', answer: 'mercado', distractors: ['azul', 'feliz'], translation: 'Marta arrived late at the market.' },
    { text: 'Marta empezó a leer la nota.', answer: 'leer', distractors: ['mesa', 'azul'], accept: ['cantar'] },
    { text: 'Ese señor es un pendejo.', answer: 'señor', distractors: ['azul'] },
  ],
  prompts: [{ line: '¿Y tú? ¿Qué hiciste ayer?' }],
};
const marketPair: PairPack = { ...pair, starter: MARKET };
/** Knows every word for every skill: free rungs, tiles. No evidence, so the starter story is used. */
const fluent: PriorFn = () => 0.9;

describe('a brand-new learner', () => {
  it('starts with the starter story and the brandNew prior, and always has a next step (canned)', async () => {
    const s = make({ startMode: 'brand_new' });
    expect(s.screen.kind).toBe('idle');
    expect(s.learner.pKnown('es:hospital', 'meaning', T0)).toBeCloseTo(0.5);
    let t = T0;
    const first = await s.next((t += 1000));
    expect(first.prior).toEqual({ kind: 'brandNew' });
    expect(first.learnerReplaced).toBe(true);
    const cliff = screenOf(first, 'cliff');
    expect(cliff.sentence.text).toBe(EN_ES_STARTER.sentences[0]?.text);
    expect(cliff.meta).toMatchObject({ chapter: 1, title: 'El concierto', mode: 'starter', canned: true });
    expect(cliff.cliff.rung).toBe('options');
    expect(cliff.cliff.options?.map((o) => o.text).sort()).toEqual(['artista', 'hospital', 'rápido']);
    expect(first.speak).toEqual({ text: 'Marta es una', rate: cliff.sentence.speechRate, what: 'sentence' });
    const seen = new Set<string>();
    const answers = (i: number, s2: StorySession) => [answerOf(s2), 'no sé', 'market', 'qué', 'siguiente'][i % 5] as string;
    for (let i = 0; i < 40; i++) {
      const st = await s.next((t += 5000));
      seen.add(st.screen.kind);
      expect(st.screen.kind).not.toBe('error');
      if (st.screen.kind === 'cliff') {
        const r = await s.handleUtterance(answers(i, s), (t += 3000));
        seen.add(r.screen.kind);
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(['cliff', 'landing', 'noSe', 'nativeReply', 'upNext', 'retell']));
  });

  it('always has a next step with the mock model too', async () => {
    const s = make({ startMode: 'brand_new', model });
    let t = T0;
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      const st = await s.next((t += 5000));
      seen.push(st.screen.kind);
      expect(['cliff', 'turn', 'upNext', 'retell']).toContain(st.screen.kind);
      if (st.screen.kind === 'cliff') await s.handleUtterance(i % 2 ? answerOf(s) : 'no sé', (t += 3000));
    }
    expect(seen).toContain('turn'); // a learner turn after the first chapter, now that a model can judge
  });
});

describe('answers at the cliff', () => {
  it('credits the actual words in full and records a cliff answer', async () => {
    const s = make({ startMode: 'brand_new' });
    await s.next(T0);
    const key = cliffKey(s);
    const before = s.learner.pKnown(key, 'speaking', T0 + 1000);
    const r = await s.handleUtterance('Artista.', T0 + 1000, { durationMs: 900 });
    const landing = screenOf(r, 'landing');
    expect(landing.outcome).toMatchObject({ credit: 'full', reason: 'actual', expected: 'artista', rung: 'options', headline: { key: 'landing.actual' } });
    expect(landing.sentence.words.map((w) => w.display)).not.toContain('gap');
    expect(r.events).toEqual([{ type: 'cliff_answer', key: 'es:artista', at: T0 + 1000, credit: 'full', rung: 'options' }]);
    expect(s.learner.pKnown(key, 'speaking', T0 + 2000)).toBeGreaterThan(before);
    expect(landing.meta.spokenMs).toBe(900);
  });

  it('picks options: the natural one is full, a distractor none, and saying an option picks it', async () => {
    const s = make({ startMode: 'brand_new' });
    const c = screenOf(await s.next(T0), 'cliff').cliff;
    const natural = c.options?.find((o) => o.text === 'artista')?.index ?? -1;
    const wrong = c.options?.find((o) => o.text === 'hospital')?.index ?? -1;
    const s2 = StorySession.restore(s.snapshot(), { model: null, pack, pair, learner: LearnerModel.restore(s.learner.snapshot(), { prior: buildPrior({ kind: 'brandNew' }, pack, pair) }) });
    expect(screenOf(await s.pickOption(natural, T0 + 1), 'landing').outcome).toMatchObject({ credit: 'full', reason: 'actual', scoredBy: 'options' });
    const miss = await s2.pickOption(wrong, T0 + 1);
    expect(screenOf(miss, 'landing').outcome).toMatchObject({ credit: 'none', reason: 'unlikely', answer: 'hospital' });
    expect(miss.events[0]).toMatchObject({ type: 'cliff_answer', credit: 'none', rung: 'options' });
    const s3 = make({ startMode: 'brand_new' });
    await s3.next(T0);
    expect(screenOf(await s3.handleUtterance('rápido', T0 + 1), 'landing').outcome.credit).toBe('none');
  });

  it('scores a natural answer that is not the story word as likely, with landing data (mock model)', async () => {
    const s = make({ model, pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    let st = await s.next(T0);
    expect(screenOf(st, 'cliff').cliff.rung).toBe('free');
    await s.handleUtterance('mercado', T0 + 1000);
    st = await s.next(T0 + 2000);
    const c = screenOf(st, 'cliff');
    expect(c.sentence.text).toBe('Marta empezó a leer la nota.');
    expect(c.cliff.ui).toEqual({ key: 'cliff.prompt' });
    const r = await s.handleUtterance('llorar', T0 + 3000);
    const o = screenOf(r, 'landing').outcome;
    expect(o).toMatchObject({ credit: 'full', reason: 'likely', scoredBy: 'model', expected: 'leer' });
    expect(o.prob).toBeGreaterThan(0.05);
    expect(o.timesIn100).toBe(Math.round((o.prob as number) * 100));
    expect(o.points.find((p) => p.answer)?.text).toBe('llorar');
    expect(o.points.length).toBeGreaterThanOrEqual(3);
    expect(o.notes[0]).toEqual({ key: 'landing.timesInHundred', params: { n: o.timesIn100 as number } });
    expect(o.headline).toEqual({ key: 'landing.likely' });
  });

  it('gives no credit to an answer that does not fit, and full credit to a listed answer without a model', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    await s.next(T0);
    expect(screenOf(await s.handleUtterance('azul', T0 + 1), 'landing').outcome).toMatchObject({ credit: 'none', reason: 'unlikely', scoredBy: 'canned' });
    await s.next(T0 + 2);
    expect(screenOf(await s.handleUtterance('cantar', T0 + 3), 'landing').outcome).toMatchObject({ credit: 'full', reason: 'likely' });
  });

  it('runs "no sé": hear the answer, then repeat it aloud', async () => {
    const s = make({ startMode: 'brand_new' });
    await s.next(T0);
    const r = await s.handleUtterance('No sé.', T0 + 1000);
    expect(r.command).toBe('dont_know');
    const ns = screenOf(r, 'noSe');
    expect(ns).toMatchObject({ step: 'play_answer', answer: 'artista', ui: null });
    expect(ns.sentence.words[3]?.display).toBe('text');
    expect(r.events).toEqual([{ type: 'cliff_skip', key: 'es:artista', at: T0 + 1000 }]);
    expect(r.speak).toMatchObject({ text: 'artista', what: 'answer' });
    expect(screenOf(s.played(T0 + 2000), 'noSe')).toMatchObject({ step: 'prompt_repeat', ui: { key: 'cliff.repeatAloud' } });
    const miss = await s.handleUtterance('artesano', T0 + 3000);
    expect(screenOf(miss, 'noSe')).toMatchObject({ step: 'prompt_repeat', repeat: { understood: 0, total: 1 } });
    expect(miss.events).toEqual([]);
    const hit = await s.handleUtterance('artista', T0 + 4000);
    expect(screenOf(hit, 'noSe')).toMatchObject({ step: 'done', repeat: { understood: 1, total: 1, ui: { key: 'stats.understood', params: { n: 1, m: 1 } } } });
    expect(hit.events).toEqual([{ type: 'spoke_correct', key: 'es:artista', at: T0 + 4000 }]);
  });

  it('gives the target phrase for a native-language answer, then credits the repeat', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    await s.next(T0);
    const r = await s.handleUtterance('the market', T0 + 1000);
    const n = screenOf(r, 'nativeReply');
    expect(n).toMatchObject({ heard: 'the market', target: 'mercado', ui: { key: 'cliff.repeatAloud' } });
    expect(n.sentence?.words.map((w) => w.display)).not.toContain('gap');
    expect(r.events).toEqual([{ type: 'native_gap', key: 'es:mercado', at: T0 + 1000 }]);
    expect(r.speak).toMatchObject({ text: 'mercado', what: 'answer' });
    // "siguiente" said as the repeat of a phrase is still a command; "mercado" is the repeat.
    const rep = await s.handleUtterance('mercado', T0 + 2000);
    expect(screenOf(rep, 'nativeReply')).toMatchObject({ ui: null, repeat: { understood: 1, total: 1 } });
    expect(rep.events).toEqual([{ type: 'spoke_correct', key: 'es:mercado', at: T0 + 2000 }]);
    expect((await s.handleUtterance('mercado', T0 + 3000)).events).toEqual([]); // credited once
  });

  it('scores a native-language answer as an answer when native answers are off', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false, settings: { nativeAnswersAllowed: false } });
    const c = screenOf(await s.next(T0), 'cliff');
    expect(c.cliff.nativeAllowed).toBe(false);
    const r = await s.handleUtterance('the market', T0 + 1000);
    expect(screenOf(r, 'landing').outcome.credit).toBe('none');
    expect(kinds(r.events)).toEqual(['cliff_answer']);
  });
});

describe('spoken commands', () => {
  it('replays, slows down, explains, skips and finishes', async () => {
    const s = make({ startMode: 'brand_new' });
    const first = await s.next(T0);
    const rate = screenOf(first, 'cliff').sentence.speechRate;
    const again = await s.handleUtterance('otra vez', T0 + 1);
    expect(again).toMatchObject({ command: 'again', events: [], speak: { text: 'Marta es una', rate, what: 'sentence' } });
    const slower = await s.handleUtterance('más despacio', T0 + 2);
    expect(slower.command).toBe('slower');
    expect(slower.speak?.rate).toBeCloseTo(rate * 0.8);
    expect(screenOf(slower, 'cliff').sentence.speechRate).toBeCloseTo(rate * 0.8);
    const meaning = await s.handleUtterance('qué significa una', T0 + 3);
    expect(meaning.command).toBe('meaning');
    expect(meaning.meaning).toMatchObject({ word: 'una', key: 'es:un', gloss: 'a, an', translation: 'Marta is an artist.' });
    expect(meaning.events).toEqual([{ type: 'gloss_lookup', key: 'es:un', at: T0 + 3 }]);
    const plain = await s.command('meaning', T0 + 4);
    expect(plain.meaning?.word).toBe('es'); // the first new word in view, never the hidden one
    // "siguiente" at a cliff skips it and moves on.
    const next = await s.handleUtterance('siguiente', T0 + 5);
    expect(next.command).toBe('next');
    expect(next.events[0]).toEqual({ type: 'cliff_skip', key: 'es:artista', at: T0 + 5 });
    expect(screenOf(next, 'cliff').sentence.text).toBe(EN_ES_STARTER.sentences[1]?.text);
    // "listo" finishes the chapter: up next, the retell.
    const done = await s.handleUtterance('listo', T0 + 6);
    expect(done.command).toBe('done');
    expect(screenOf(done, 'upNext')).toMatchObject({ next: 'retell', advanced: [] });
  });

  it('records the slower replays as recent performance (momentum lowers the next rate)', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    const r1 = screenOf(await s.next(T0), 'cliff').sentence.speechRate;
    for (let i = 0; i < 4; i++) await s.command('slower', T0 + i);
    await s.handleUtterance('no sé', T0 + 10);
    const r2 = screenOf(await s.next(T0 + 20), 'cliff').sentence.speechRate;
    expect(r2).toBeLessThan(r1);
  });
});

describe('words, tiles and settings', () => {
  it('fades text per word, and the learner can force text or tiles', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    const c = screenOf(await s.next(T0), 'cliff');
    expect(c.sentence.words.map((w) => w.display)).toEqual(['tile', 'tile', 'tile', 'tile', 'gap']);
    const text = screenOf(s.setSettings({ textMode: 'all_text' }, T0 + 1), 'cliff');
    expect(text.sentence.words.map((w) => w.display)).toEqual(['text', 'text', 'text', 'text', 'gap']);
    const b = make({ startMode: 'brand_new' });
    expect(screenOf(await b.next(T0), 'cliff').sentence.words.map((w) => w.display)).toEqual(['text', 'text', 'text', 'gap']);
    expect(screenOf(b.setSettings({ textMode: 'all_tiles' }, T0 + 1), 'cliff').sentence.words.map((w) => w.display)).toEqual(['tile', 'tile', 'tile', 'gap']);
  });

  it('taps to hear and holds to see, never on hidden words', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false });
    await s.next(T0);
    const tap = s.tapWord(1, T0 + 1);
    expect(tap.events).toEqual([{ type: 'tap_rehear', key: 'es:llegar', at: T0 + 1 }]);
    expect(tap.speak).toMatchObject({ text: 'llegó', what: 'word' });
    const hold = s.revealWord(2, T0 + 2);
    expect(hold.events).toEqual([{ type: 'hold_reveal', key: 'es:tarde', at: T0 + 2 }]);
    expect(screenOf(hold, 'cliff').sentence.words[2]?.display).toBe('text');
    expect(s.tapWord(4, T0 + 3).events).toEqual([]); // the hidden word
    expect(s.revealWord(9, T0 + 3).events).toEqual([]);
    // Moving on: words heard without help become heard events; tapped and held ones do not.
    await s.handleUtterance('mercado', T0 + 4);
    const next = await s.next(T0 + 5);
    expect(next.events).toEqual([{ type: 'heard', key: 'es:al', at: T0 + 5 }]);
  });

  it('applies the speech-rate bias to playback and tile widths', async () => {
    const a = make({ startMode: 'brand_new' });
    const b = make({ startMode: 'brand_new', settings: { speechRateBias: 1.2 } });
    const va = screenOf(await a.next(T0), 'cliff').sentence;
    const vb = screenOf(await b.next(T0), 'cliff').sentence;
    expect(vb.speechRate).toBeCloseTo(va.speechRate * 1.2);
    expect(vb.durationMs).toBeCloseTo(va.durationMs / 1.2);
  });

  it('masks explicit slang when explicit lyrics are off, and shows it by default', async () => {
    const learner = () => new LearnerModel({ prior: fluent });
    const on = make({ pair: marketPair, learner: learner(), applyEvents: false, settings: { register: 'street' } });
    const off = make({ pair: marketPair, learner: learner(), applyEvents: false, settings: { register: 'street', showExplicit: false } });
    for (const s of [on, off]) {
      await s.next(T0);
      await s.command('next', T0 + 1);
      await s.command('next', T0 + 2);
    }
    const von = screenOf({ screen: on.screen, events: [] }, 'cliff').sentence;
    const voff = screenOf({ screen: off.screen, events: [] }, 'cliff').sentence;
    expect(von.text).toBe('Ese señor es un pendejo.');
    expect(von.words[4]).toMatchObject({ text: 'pendejo', slang: true, explicit: true, display: 'future' });
    expect(voff.words[4]?.display).toBe('masked');
    expect(off.tapWord(4, T0 + 3).events).toEqual([]);
  });

  it('shows the gloss chip for new words the learner can see', async () => {
    const s = make({ startMode: 'brand_new' });
    const c = screenOf(await s.next(T0), 'cliff');
    expect(c.sentence.glosses.map((g) => [g.word, g.gloss])).toEqual([
      ['es', 'to be (identity, origin, time)'],
      ['una', 'a, an'],
    ]);
    expect(c.sentence.words[3]).toMatchObject({ text: 'artista', isNew: false, display: 'gap' }); // a cognate is not new
  });
});

describe('the hint rung', () => {
  it('gives the first letters when the learner half knows how to say the word', async () => {
    const prior: PriorFn = (key, skill) => (skill === 'speaking' ? (key === 'es:mercado' ? 0.45 : 0.9) : 0.9);
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior }), applyEvents: false });
    const c = screenOf(await s.next(T0), 'cliff').cliff;
    expect(c).toMatchObject({ rung: 'hint', hint: 'me', ui: { key: 'cliff.hint', params: { sound: 'me' } } });
    expect(c.options).toBeUndefined();
  });
});

describe('placement', () => {
  async function place(knowsUpTo: number, m = null as typeof model | null) {
    const s = make({ startMode: 'placement', model: m });
    let t = T0;
    const bands: number[] = [];
    const recorded: { rank: number; success: boolean }[] = [];
    let done: StoryStep | null = null;
    for (let i = 0; i < 40 && !done; i++) {
      const st = await s.next((t += 1000));
      if (st.screen.kind === 'placementDone') {
        done = st;
        break;
      }
      expect(st.screen.kind).toBe('cliff');
      expect((st.screen as Extract<StoryScreen, { kind: 'cliff' }>).meta.mode).toBe('placement');
      if (st.placement) bands.push(st.placement.nextBand);
      const probe = state(s).current?.probe;
      expect(probe).not.toBeNull();
      const knows = (probe?.rank ?? Infinity) <= knowsUpTo;
      const r = await s.handleUtterance(knows ? answerOf(s) : 'no sé', (t += 1000));
      expect(r.placement?.recorded).toMatchObject({ rank: probe?.rank, success: knows });
      recorded.push({ rank: probe?.rank ?? 0, success: knows });
    }
    return { s, done, bands, recorded };
  }

  it('gets harder while the learner knows the words, and stops when they stall', async () => {
    const { s, done, recorded } = await place(300);
    expect(done).not.toBeNull();
    // Climbs from the start band (ranks 64-127) after a success...
    expect(recorded[0]).toEqual({ rank: 64, success: true });
    expect(recorded[1]?.rank).toBeGreaterThan(256);
    // ...and comes back down after the first miss.
    expect(recorded[2]?.rank).toBeLessThan(recorded[1]?.rank as number);
    const d = screenOf(done as StoryStep, 'placementDone');
    expect(d.items).toBe(recorded.length);
    expect(d.thresholdRank).toBeGreaterThan(120);
    expect(d.thresholdRank).toBeLessThan(700);
    expect(done?.prior?.kind).toBe('placement');
    expect(done?.learnerReplaced).toBe(true);
    expect(done?.placement).toMatchObject({ done: true });
    expect(s.prior.kind).toBe('placement');
    // The new prior: common words known, rare words not.
    expect(s.learner.pKnown('es:hablar', 'meaning', T0 + 1e6)).toBeGreaterThan(0.6);
    expect(s.learner.pKnown('es:sombrero', 'meaning', T0 + 1e6)).toBeLessThan(0.2);
    // The story goes on as the learner's own story.
    const next = await s.next(T0 + 1e6);
    const meta = screenOf(next, 'cliff').meta;
    expect(meta.chapter).toBe(2);
    expect(meta.mode).not.toBe('placement');
  });

  it('places a total beginner low and a strong learner high, quickly', async () => {
    const low = await place(0);
    const high = await place(100000);
    const lowRank = screenOf(low.done as StoryStep, 'placementDone').thresholdRank;
    const highRank = screenOf(high.done as StoryStep, 'placementDone').thresholdRank;
    expect(lowRank).toBeLessThan(20);
    expect(highRank).toBeGreaterThan(2000);
    expect(high.recorded.length).toBeLessThanOrEqual(6);
    expect(high.recorded.every((r) => r.success)).toBe(true);
  });

  it('runs with the mock model scoring the answers, and builds the same kind of prior', async () => {
    const { done, recorded } = await place(300, model);
    expect(done?.prior?.kind).toBe('placement');
    expect(recorded.length).toBeGreaterThanOrEqual(5);
  });

  it('counts naming the probe word in the native language as knowing it', async () => {
    const s = make({ startMode: 'placement' });
    await s.next(T0);
    expect(answerOf(s)).toBe('llegar');
    const r = await s.handleUtterance('reach', T0 + 1);
    expect(r.screen.kind).toBe('nativeReply');
    expect(r.placement?.recorded).toMatchObject({ key: 'es:llegar', success: true });
  });
});

describe('learner turns and self-repair (mock model)', () => {
  async function toTurn() {
    const s = make({ model, pair: marketPair, startMode: 'brand_new', options: { sentencesPerChapter: 3 } });
    let t = T0;
    for (let i = 0; i < 3; i++) {
      await s.next((t += 1000));
      await s.handleUtterance(answerOf(s), (t += 1000));
    }
    const turn = await s.next((t += 1000));
    return { s, turn, t };
  }

  it('asks the learner, prompts a repair on an asserted error, then shows the fix', async () => {
    const { s, turn, t } = await toTurn();
    const ask = screenOf(turn, 'turn');
    expect(ask.prompt).toEqual({ speaker: 'Marta', line: '¿Y tú? ¿Qué hiciste ayer?' });
    expect(ask.ui).toEqual({ key: 'story.asks', params: { speaker: 'Marta' } });
    expect(turn.speak).toMatchObject({ text: '¿Y tú? ¿Qué hiciste ayer?', what: 'prompt' });
    const r = await s.handleUtterance('Soy cansado.', t + 1000);
    const rep = screenOf(r, 'repair');
    expect(rep.phase).toBe('prompt_repair');
    expect(rep.ui).toEqual({ key: 'repair.prompt' });
    expect(rep.said.map((w) => w.text)).toEqual(['Soy', 'cansado']);
    expect(rep.highlight).toBe(0);
    expect(rep.said[0]?.heat).toBeGreaterThanOrEqual(2);
    expect(rep.explanation).toBeNull(); // no fix before the learner tries again
    expect(r.events).toEqual([]);
    const giveUp = await s.handleUtterance('no sé', t + 2000);
    const shown = screenOf(giveUp, 'repair');
    expect(shown).toMatchObject({ phase: 'show_answer', done: true, expected: 'Estoy cansado.' });
    expect(shown.explainKey).toBeTruthy();
    expect(shown.explanation).toBe(pair.explanations[shown.explainKey as string]);
    expect(giveUp.events.find((e) => e.type === 'spoke_error')?.key).toBe('es:ser');
    const up = await s.next(t + 3000);
    expect(screenOf(up, 'upNext').next).toBe('retell');
    expect(up.events).toEqual([]); // the repair events were sent once, when the flow finished
  });

  it('accepts a repaired sentence', async () => {
    const { s, t } = await toTurn();
    await s.handleUtterance('Soy cansado.', t + 1000);
    const r = await s.handleUtterance('Estoy cansado.', t + 2000);
    expect(screenOf(r, 'repair')).toMatchObject({ phase: 'repaired', done: true });
    expect(r.events).toContainEqual({ type: 'spoke_error', key: 'es:ser', at: t + 1000 });
    expect(r.events).toContainEqual({ type: 'spoke_correct', key: 'es:cansado', at: t + 2000 });
  });

  it('offers the target words for a native answer and keeps the turn open', async () => {
    const { s, t } = await toTurn();
    const r = await s.handleUtterance('I am tired', t + 1000);
    const turn = screenOf(r, 'turn');
    expect(turn.native).toEqual({ heard: 'I am tired', target: 'cansado' });
    expect(r.speak).toMatchObject({ text: 'cansado', what: 'answer' });
    expect(kinds(r.events).every((k) => k === 'native_gap')).toBe(true);
  });
});

describe('timed retell', () => {
  async function toRetell() {
    const s = make({ startMode: 'brand_new', pair: marketPair });
    let t = T0;
    for (let i = 0; i < 3; i++) {
      await s.next((t += 1000));
      await s.handleUtterance(answerOf(s), (t += 1000));
    }
    expect(screenOf(await s.next((t += 1000)), 'upNext').next).toBe('retell');
    return { s, t };
  }
  const words = (n: number, gapEvery = 0) => {
    const out: { text: string; startMs: number; endMs: number }[] = [];
    let at = 500;
    for (let i = 0; i < n; i++) {
      if (gapEvery && i > 0 && i % gapEvery === 0) at += 1500;
      out.push({ text: `w${i}`, startMs: at, endMs: at + 300 });
      at += 400;
    }
    return out;
  };

  it('runs rounds of 60, 45 and 30 seconds with words per minute and pauses', async () => {
    const { s, t } = await toRetell();
    const r0 = screenOf(await s.next(t + 1000), 'retell');
    expect(r0).toMatchObject({ round: 0, rounds: 3, laneMs: 60000, ui: { key: 'retell.round', params: { round: 1, rounds: 3, seconds: 60 } }, done: false });
    expect(r0.scene).toBe(MARKET.sentences.map((x) => x.text).join(' '));
    const a = await s.handleUtterance('Marta llegó tarde al mercado y leyó la nota', t + 2000, { words: words(20, 5), durationMs: 12000 });
    const r1 = screenOf(a, 'retell');
    expect(r1).toMatchObject({ round: 1, laneMs: 45000 });
    expect(r1.results[0]).toMatchObject({ round: 0, laneMs: 60000, words: 20 });
    expect(r1.results[0]?.pauses.length).toBe(3);
    expect(r1.meta.spokenMs).toBe(12000);
    const b = await s.handleUtterance('Marta llegó tarde', t + 3000, { words: words(24) });
    expect(screenOf(b, 'retell').results[1]?.pauses).toEqual([]);
    // "listo" ends the last round with the words heard before it.
    const c = await s.handleUtterance('listo', t + 4000, { words: words(10, 3) });
    expect(c.command).toBe('done');
    const end = screenOf(c, 'retell');
    expect(end.done).toBe(true);
    expect(end.results.map((x) => x.laneMs)).toEqual([60000, 45000, 30000]);
    expect(end.progress).toMatchObject({ rounds: 3, pauses: { from: 3, to: 3 } });
    expect(end.progress?.wordsPerMinute.from).toBe(Math.round(end.results[0]?.wordsPerMinute ?? 0));
    expect(end.results[0]?.covered).toBeGreaterThanOrEqual(0);
    const next = await s.next(t + 5000);
    expect(screenOf(next, 'cliff').meta.chapter).toBe(2);
  });

  it('spreads untimed words over the utterance and can be skipped', async () => {
    const { s, t } = await toRetell();
    await s.next(t + 1000);
    const r = screenOf(await s.handleUtterance('Marta llegó tarde al mercado', t + 2000, { durationMs: 3000 }), 'retell');
    expect(r.results[0]).toMatchObject({ words: 5, pauses: [] });
    expect(r.results[0]?.wordsPerMinute).toBeCloseTo(100);
    expect(r.results[0]?.covered).toBeGreaterThanOrEqual(2); // llegar, mercado (and Marta)
    const skip = screenOf(await s.next(t + 3000), 'retell');
    expect(skip.done).toBe(true);
    expect(screenOf(await s.next(t + 4000), 'cliff').meta.chapter).toBe(2);
  });
});

describe('at the top of the frequency list', () => {
  it('keeps the story going on practice words and offers register switching, brought text and lyrics', async () => {
    const learner = new LearnerModel({ prior: () => 0.99 });
    learner.apply({ type: 'heard', key: 'es:ser', at: T0 - 1000 });
    const s = make({ model, learner, options: { sentencesPerChapter: 2 } });
    let t = T0;
    let up: StoryStep | null = null;
    let cliffs = 0;
    for (let i = 0; i < 8 && !up; i++) {
      const st = await s.next((t += 1000));
      if (st.screen.kind === 'cliff') {
        cliffs++;
        await s.handleUtterance(answerOf(s), (t += 1000));
      } else if (st.screen.kind === 'upNext') up = st;
    }
    expect(cliffs).toBe(2);
    expect(state(s).frontier).toBe('exhausted');
    expect(screenOf(up as StoryStep, 'upNext').advanced).toEqual(['register_switch', 'brought_text', 'lyrics']);
    // Skip the retell; the story still has a next sentence.
    await s.next((t += 1000));
    await s.next((t += 1000));
    expect((await s.next((t += 1000))).screen.kind).toBe('cliff');
  });

  it('switches register: hear neutral, say it street', async () => {
    const s = make({ pair: marketPair, learner: new LearnerModel({ prior: fluent }), applyEvents: false, settings: { register: 'street', regions: ['PR'] } });
    await s.next(T0);
    const r = await s.startRegisterTask(T0 + 1);
    const task = screenOf(r, 'register').task;
    expect(task.from).toBe('neutral');
    expect(task.to).toBe('street');
    expect(task.swaps.length).toBeGreaterThan(0);
    expect(r.speak).toMatchObject({ text: task.prompt, what: 'prompt' });
    const said = await s.handleUtterance(task.expected, T0 + 2);
    const done = screenOf(said, 'register').task;
    expect(done.result).toMatchObject({ understood: done.result?.total });
    expect(kinds(said.events)).toContain('spoke_correct');
    expect(screenOf(await s.next(T0 + 3), 'cliff').sentence.text).toBe(MARKET.sentences[1]?.text);
  });
});

describe('model sentences', () => {
  it('generates a sentence, cuts a cliff and checks option distractors with the model', async () => {
    const learner = new LearnerModel();
    for (const lemma of ['marta', 'llegar', 'tarde', 'al', 'mercado', 'empezar', 'a', 'leer', 'el', 'nota', 'estar', 'cansado', 'casa', 'playa', 'bonito', 'ser', 'para', 'mi'])
      learner.apply({ type: 'marked_known', key: lexemeKey('es', lemma), at: T0 - 3_600_000 });
    const s = make({ model, learner, seed: 1 });
    const st = await s.next(T0);
    const c = screenOf(st, 'cliff');
    const cur = state(s).current;
    expect(cur?.source).toBe('model');
    expect(c.meta).toMatchObject({ mode: 'story', canned: false });
    expect(cur?.alternatives.length).toBeGreaterThan(0);
    expect(cur?.cliff.wordIndex).toBeGreaterThan(0);
    if (c.cliff.rung === 'options') {
      for (const o of cur?.options ?? []) if (!o.natural) expect(o.prob).toBeLessThan(0.005);
      expect(cur?.options?.filter((o) => o.natural).map((o) => o.text)).toEqual([cur?.cliff.answer]);
    }
    expect(frequencyLexemeKeys(pack)).toContain(cur?.targets[0]);
  });

  it('falls back to the starter story when the model gives nothing usable', async () => {
    const silent = { id: 'silent', scoreContinuation: model.scoreContinuation.bind(model), nextTokens: model.nextTokens.bind(model), generate: async (_p: string, o: { n: number }) => Array.from({ length: o.n }, () => '') };
    const learner = new LearnerModel();
    learner.apply({ type: 'heard', key: 'es:ser', at: T0 - 1000 });
    const s = make({ model: silent, learner });
    const st = await s.next(T0);
    expect(screenOf(st, 'cliff').sentence.text).toBe(EN_ES_STARTER.sentences[0]?.text);
  });

  it('shows an error screen (and tries again on next) when there is nothing at all to say', async () => {
    // createDefaultPairPack() now carries EN_ES_STARTER; this case needs a pack without one.
    const s = make({ pair: { ...createDefaultPairPack(), starter: undefined } });
    const st = await s.next(T0);
    expect(screenOf(st, 'error').ui).toEqual({ key: 'story.noSentence' });
    expect((await s.next(T0 + 1)).screen.kind).toBe('error');
  });
});

describe('snapshot and restore', () => {
  it('is JSON-serializable with a format number, and resumes mid-sentence identically', async () => {
    const s = make({ startMode: 'brand_new' });
    let t = T0;
    await s.next((t += 1000));
    await s.handleUtterance(answerOf(s), (t += 1000));
    await s.next((t += 1000));
    await s.command('slower', (t += 1000));
    const snap = s.snapshot();
    expect(snap.format).toBe(1);
    expect(snap.kind).toBe('story');
    const json = JSON.parse(JSON.stringify(snap));
    expect(json).toEqual(snap);
    const learner = LearnerModel.restore(s.learner.snapshot(), { prior: buildPrior(s.prior, pack, pair) });
    const r = StorySession.restore(json, { model: null, pack, pair, learner });
    expect(r.screen).toEqual(s.screen);
    const a = await s.handleUtterance('océano', (t += 1000));
    const b = await r.handleUtterance('océano', t);
    expect(b).toEqual(a);
    expect(await r.next(t + 1000)).toEqual(await s.next(t + 1000));
  });

  it('resumes placement and retell where they were', async () => {
    const p = make({ startMode: 'placement' });
    await p.next(T0);
    await p.handleUtterance(answerOf(p), T0 + 1);
    const rp = StorySession.restore(JSON.parse(JSON.stringify(p.snapshot())), { model: null, pack, pair, learner: LearnerModel.restore(p.learner.snapshot()) });
    expect(await rp.next(T0 + 2)).toEqual(await p.next(T0 + 2));
    expect(state(rp).placement?.tracker.items.length).toBe(1);
  });

  it('rejects snapshots of another format or kind', () => {
    const snap = make().snapshot();
    const deps = { model: null, pack, pair, learner: new LearnerModel() };
    expect(() => StorySession.restore({ ...snap, format: 2 as 1 }, deps)).toThrow(/unsupported/);
    expect(() => StorySession.restore({ ...snap, kind: 'lyric' as 'story' }, deps)).toThrow(/unsupported/);
  });

  it('is deterministic: the same seed and inputs give the same session', async () => {
    const run = async () => {
      const s = make({ startMode: 'brand_new', model, seed: 5 });
      const out: unknown[] = [];
      let t = T0;
      for (let i = 0; i < 4; i++) {
        out.push(await s.next((t += 1000)));
        out.push(await s.handleUtterance(i % 2 ? answerOf(s) : 'no sé', (t += 1000)));
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });

  it('refuses overlapping steps', async () => {
    const s = make({ model, startMode: 'brand_new' });
    const p = s.next(T0);
    await expect(s.next(T0)).rejects.toThrow(/already running/);
    await p;
  });
});
