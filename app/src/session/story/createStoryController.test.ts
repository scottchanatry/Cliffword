/**
 * The story controller over the real engine StorySession, the en-es packs and the test
 * services: FakeSpeechIn plays the learner, FakeSpeechOut the voice, FakeClock the time,
 * sql.js the storage, and MockModelAdapter the model (unloaded for canned mode).
 */
import {
  SKILLS,
  frequencyLexemeKeys,
  type LearnerModel,
  type PairPack,
  type StarterStory,
  type StoryScreen,
} from '@cliffword/engine';
import { MockModelAdapter } from '../../adapters/model/MockModelAdapter';
import type { ScriptedUtterance } from '../../adapters/speechIn/FakeSpeechIn';
import { FakeSpeechOut } from '../../adapters/speechOut/FakeSpeechOut';
import { bootstrap } from '../../bootstrap/bootstrap';
import { learnerPrior } from '../../learner/prior';
import { defaultPacks, sharedMockModel } from '../../services/defaults';
import { createTestServices, type TestServices } from '../../services/testServices';
import type { Storage } from '../../storage/storage';
import type { AppSettings } from '../../storage/repos/settings';
import type { StoryViewModel } from '../contract';
import { createStoryController, type StoryControllerDeps, type StoryControllerHandle } from './createStoryController';

const SECOND = 1000;

/** The market scene of the design, as a three-sentence starter (with a learner-turn prompt). */
const MARKET: StarterStory = {
  id: 'test.market',
  title: 'El mercado',
  character: 'Marta',
  taught: [],
  sentences: [
    { text: 'Marta llegó tarde al mercado.', answer: 'mercado', distractors: ['azul', 'feliz'], translation: 'Marta arrived late at the market.' },
    { text: 'Marta empezó a leer la nota.', answer: 'leer', distractors: ['mesa', 'azul'], accept: ['cantar'] },
    { text: 'La nota dice que el puesto está cerrado.', answer: 'cerrado', distractors: ['mesa', 'azul'] },
  ],
  prompts: [{ line: '¿Y tú? ¿Qué hiciste ayer?' }],
};

interface Harness {
  services: TestServices;
  storage: Storage;
  controller: StoryControllerHandle;
  replaced: LearnerModel[];
  errors: unknown[];
  vm: () => StoryViewModel;
  screen: () => StoryScreen;
  /** Restart the app on the same storage: bootstrap again and build a new controller. */
  restart: () => Promise<StoryControllerHandle>;
}

interface SetupOptions {
  settings?: Partial<AppSettings>;
  model?: 'ready' | 'unloaded';
  pair?: PairPack;
  speechOut?: FakeSpeechOut;
  sessionOptions?: StoryControllerDeps['sessionOptions'];
  openUrl?: StoryControllerDeps['openUrl'];
  appInfo?: StoryControllerDeps['appInfo'];
  start?: boolean;
}

const live: StoryControllerHandle[] = [];

async function setup(opts: SetupOptions = {}): Promise<Harness> {
  const packs = opts.pair ? { lang: defaultPacks().lang, pair: opts.pair } : defaultPacks();
  const services = createTestServices({
    model: new MockModelAdapter({ model: sharedMockModel(), status: opts.model ?? 'unloaded' }),
    packs,
    ...(opts.speechOut ? { speechOut: opts.speechOut } : {}),
  }) as unknown as TestServices;
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel: 'brandNew', ...opts.settings });
  const replaced: LearnerModel[] = [];
  const errors: unknown[] = [];
  const build = async () => {
    const boot = await bootstrap(services);
    const c = createStoryController({
      model: services.model,
      packs: services.packs,
      storage,
      learner: boot.learner.learner,
      settings: boot.settings,
      speechOut: services.speechOut,
      speechIn: services.speechIn,
      haptics: services.haptics,
      clock: services.clock,
      seed: () => 7,
      onLearnerReplaced: (l) => replaced.push(l),
      updateSettings: (patch) => storage.settings.update(patch),
      onError: (e) => errors.push(e),
      ...(opts.sessionOptions ? { sessionOptions: opts.sessionOptions } : {}),
      ...(opts.openUrl ? { openUrl: opts.openUrl } : {}),
      ...(opts.appInfo ? { appInfo: opts.appInfo } : {}),
    });
    live.push(c);
    return c;
  };
  const h: Harness = {
    services,
    storage,
    controller: await build(),
    replaced,
    errors,
    vm: () => h.controller.getSnapshot(),
    screen: () => {
      const s = h.controller.getSnapshot().screen;
      if (!s) throw new Error('no screen yet');
      return s;
    },
    restart: async () => {
      h.controller = await build();
      return h.controller;
    },
  };
  if (opts.start !== false) {
    h.controller.actions.start();
    await h.controller.idle();
  }
  return h;
}

afterEach(() => {
  for (const c of live.splice(0)) c.dispose();
});

function as<K extends StoryScreen['kind']>(screen: StoryScreen | null, kind: K): Extract<StoryScreen, { kind: K }> {
  expect(screen?.kind).toBe(kind);
  return screen as Extract<StoryScreen, { kind: K }>;
}

/** The learner holds, says `utterance` and lets go. */
async function speak(h: Harness, utterance: string | ScriptedUtterance): Promise<void> {
  h.services.clock.advance(2 * SECOND);
  h.controller.actions.holdBegin();
  h.controller.actions.holdStart();
  await h.controller.idle();
  expect(h.vm().listen.phase).toBe('listening');
  h.services.speechIn.queueUtterance(utterance);
  h.controller.actions.holdEnd();
  await h.controller.idle();
}

async function act(h: Harness, fn: (c: StoryControllerHandle) => void): Promise<void> {
  h.services.clock.advance(SECOND);
  fn(h.controller);
  await h.controller.idle();
}

/** The cliff's expected answer (the session's own data, read from the stored snapshot). */
async function expectedAnswer(h: Harness): Promise<string> {
  const rec = await h.storage.sessions.active<{ state: { current: { cliff: { answer: string } } | null } }>('story');
  return rec?.snapshot.state.current?.cliff.answer ?? '';
}

/** pKnown of every skill for `keys`, at a few moments. */
function knowledge(learner: LearnerModel, keys: readonly string[], at: number): number[] {
  const out: number[] = [];
  for (const now of [at, at + 3_600_000, at + 72 * 3_600_000]) for (const key of keys) for (const skill of SKILLS) out.push(learner.pKnown(key, skill, now));
  return out;
}

/** The learner rebuilt from storage alone, as the next start would. */
async function reloaded(h: Harness, start: AppSettings['startLevel']): Promise<LearnerModel> {
  const prior = learnerPrior(h.services.packs, start, await h.storage.learner.latestPrior());
  return (await h.storage.learner.loadLearner({ prior })).learner;
}

async function spokenTotal(storage: Storage): Promise<number> {
  return storage.spokenTime.total();
}

const marketPair = (): PairPack => ({ ...defaultPacks().pair, starter: MARKET });

describe('a brand-new learner (canned, no model)', () => {
  it('starts the starter story at its first cliff, with the brandNew prior stored and the learner handed over', async () => {
    const h = await setup();
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.sentence.text).toBe('Marta es una artista.');
    expect(cliff.meta).toMatchObject({ chapter: 1, title: 'El concierto', mode: 'starter', canned: true });
    expect(cliff.cliff).toMatchObject({ wordIndex: 3, rung: 'options' });
    expect(h.vm()).toMatchObject({ modelMode: 'canned', busy: false, listen: { phase: 'idle' }, speakingWord: null, speakingOption: null, textMode: 'auto' });
    // The sentence up to the cliff, then each option in turn.
    expect(h.services.speechOut.spokenTexts).toEqual(['Marta es una', ...(cliff.cliff.options ?? []).map((o) => o.text)]);
    expect(h.services.speechOut.calls[0]).toMatchObject({ rate: cliff.sentence.speechRate, lang: 'es-PR', voice: 'fake.es-PR' });
    expect(await h.storage.learner.latestPrior()).toEqual({ kind: 'brandNew' });
    expect(h.replaced).toEqual([h.controller.learner]);
    const rec = await h.storage.sessions.active('story');
    expect(rec).toMatchObject({ kind: 'story', version: 1, active: true });
    expect(h.errors).toEqual([]);
  });

  it('lights the tile being spoken from the voice word boundaries, then the options one by one', async () => {
    const speechOut = new FakeSpeechOut({ autoFinish: false });
    const h = await setup({ speechOut });
    expect(speechOut.lastCall?.text).toBe('Marta es una');
    expect(speechOut.lastCall?.timings.map((t) => t.text)).toEqual(['Marta', 'es', 'una']);
    speechOut.speakWords(1);
    expect(h.vm().speakingWord).toBe(0);
    speechOut.speakWords(2);
    expect(h.vm().speakingWord).toBe(2);
    speechOut.finish();
    await h.controller.idle();
    expect(h.vm().speakingWord).toBeNull();
    const options = as(h.vm().screen, 'cliff').cliff.options ?? [];
    expect(h.vm().speakingOption).toBe(options[0]?.index);
    expect(speechOut.lastCall?.text).toBe(options[0]?.text);
    speechOut.finish();
    await h.controller.idle();
    expect(h.vm().speakingOption).toBe(options[1]?.index);
    // Holding to speak stops the voice.
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(speechOut.isSpeaking).toBe(false);
    expect(h.vm().speakingOption).toBeNull();
    expect(h.vm().listen.phase).toBe('listening');
  });

  it('says an answer: listening, level and partial, then the landing, then the next sentence', async () => {
    const h = await setup();
    h.controller.actions.holdBegin();
    expect(h.vm().listen).toEqual({ phase: 'warming' });
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.vm().listen).toEqual({ phase: 'listening', level: 0, partial: '' });
    const start = h.services.speechIn.startCalls[0];
    expect(start).toMatchObject({ lang: 'es-PR', onDevice: true, interim: true, continuous: true });
    expect(start?.langFallbacks).toContain('es-US');
    expect(start?.hints).toEqual(expect.arrayContaining(['Marta', 'artista', 'hospital', 'otra vez', 'no sé']));
    expect(h.services.haptics.played).toEqual(['tap']);
    h.services.speechIn.emitLevel(-12);
    expect((h.vm().listen as { level: number }).level).toBeGreaterThan(0);
    h.services.speechIn.emitPartial('arti');
    expect(h.vm().listen).toMatchObject({ phase: 'listening', partial: 'arti' });
    h.services.speechIn.queueUtterance('artista');
    h.controller.actions.holdEnd();
    expect(h.vm().listen).toEqual({ phase: 'finishing' });
    await h.controller.idle();
    const landing = as(h.vm().screen, 'landing');
    // Saying an option picks it.
    expect(landing.outcome).toMatchObject({ answer: 'artista', credit: 'full', reason: 'actual', scoredBy: 'options' });
    expect(h.vm().listen).toEqual({ phase: 'idle' });
    expect(h.services.haptics.played).toEqual(['tap', 'selection']);
    const logged = await h.storage.learner.eventsSince();
    expect(logged.map((e) => e.event)).toEqual([expect.objectContaining({ type: 'cliff_answer', key: 'es:artista', credit: 'full', rung: 'options' })]);

    await act(h, (c) => c.actions.next());
    const next = as(h.vm().screen, 'cliff');
    expect(next.sentence.text).toBe('Ella tiene una guitarra.');
    expect(h.vm().previous?.map((s) => s.text)).toEqual(['Marta es una artista.']);
    expect(h.vm().previous?.[0]?.words.every((w) => w.display === 'text')).toBe(true);
  });

  it('picks an option on the options rung, and a second next() never lands on the next screen', async () => {
    const h = await setup();
    const natural = as(h.vm().screen, 'cliff').cliff.options?.find((o) => o.text === 'artista')?.index ?? -1;
    await act(h, (c) => c.actions.pickOption(natural));
    expect(as(h.vm().screen, 'landing').outcome).toMatchObject({ credit: 'full', scoredBy: 'options', answer: 'artista' });
    expect(await spokenTotal(h.storage)).toBe(0);
    // Two taps on "continue" while the first is still running: one step only.
    h.controller.actions.next();
    expect(h.vm().busy).toBe(true);
    h.controller.actions.next();
    await h.controller.idle();
    expect(h.vm().busy).toBe(false);
    expect(as(h.vm().screen, 'cliff').sentence.text).toBe('Ella tiene una guitarra.');
  });

  it('gives no speaking time for a typed answer, and credits a spoken one', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.typeAnswer('  artista '));
    expect(as(h.vm().screen, 'landing').outcome.answer).toBe('artista');
    expect(as(h.vm().screen, 'landing').meta.spokenMs).toBe(0);
    expect(await spokenTotal(h.storage)).toBe(0);
    expect(h.vm().spokenTodayMs).toBe(0);
    await act(h, (c) => c.actions.next());
    // Two words: 350 ms each with a 120 ms gap (FakeSpeechIn), 820 ms voiced.
    await speak(h, 'una guitarra');
    expect(await spokenTotal(h.storage)).toBe(820);
    expect(h.vm().spokenTodayMs).toBe(820);
  });

  it('runs "no sé": the answer plays, then the learner repeats it', async () => {
    const h = await setup();
    await speak(h, 'no sé');
    const ns = as(h.vm().screen, 'noSe');
    expect(ns.answer).toBe('artista');
    // The answer played to the end, so the session moved on to the repeat.
    expect(h.services.speechOut.lastCall).toMatchObject({ text: 'artista', completed: true });
    expect(ns.step).toBe('prompt_repeat');
    expect(ns.ui).toEqual({ key: 'cliff.repeatAloud' });
    await speak(h, 'artista');
    expect(as(h.vm().screen, 'noSe')).toMatchObject({ step: 'done', repeat: { understood: 1, total: 1 } });
    const logged = (await h.storage.learner.eventsSince()).map((e) => e.event.type);
    expect(logged).toEqual(['cliff_skip', 'spoke_correct']);
  });

  it('gives the target phrase for a native-language answer, then credits the repeat', async () => {
    const h = await setup({ pair: marketPair() });
    expect(as(h.vm().screen, 'cliff').sentence.text).toBe('Marta llegó tarde al mercado.');
    await speak(h, 'the market');
    const n = as(h.vm().screen, 'nativeReply');
    expect(n).toMatchObject({ heard: 'the market', target: 'mercado' });
    expect(h.services.speechOut.lastCall?.text).toBe('mercado');
    await speak(h, 'mercado');
    expect(as(h.vm().screen, 'nativeReply')).toMatchObject({ repeat: { understood: 1, total: 1 } });
    const logged = (await h.storage.learner.eventsSince()).map((e) => e.event);
    expect(logged).toEqual([expect.objectContaining({ type: 'native_gap', key: 'es:mercado' }), expect.objectContaining({ type: 'spoke_correct', key: 'es:mercado' })]);
  });

  it('runs commands from the chips and from speech', async () => {
    const h = await setup();
    const spoken = () => h.services.speechOut.spokenTexts.filter((t) => t === 'Marta es una').length;
    const rate = as(h.vm().screen, 'cliff').sentence.speechRate;
    await act(h, (c) => c.actions.command('again'));
    expect(spoken()).toBe(2);
    await speak(h, 'otra vez');
    expect(spoken()).toBe(3);
    expect(h.vm().listen.phase).toBe('idle');
    await act(h, (c) => c.actions.command('slower'));
    const slow = h.services.speechOut.calls.filter((c) => c.text === 'Marta es una').at(-1);
    expect(slow?.rate).toBeCloseTo(rate * 0.8);
    expect(as(h.vm().screen, 'cliff').sentence.speechRate).toBeCloseTo(rate * 0.8);
    // "Hear it again" replays without telling the session (no extra replay counted).
    await act(h, (c) => c.actions.replay());
    expect(h.services.speechOut.calls.filter((c) => c.text === 'Marta es una').at(-1)?.rate).toBeCloseTo(rate * 0.8);
    await act(h, (c) => c.actions.command('meaning', 'una'));
    expect(h.vm().meaning).toMatchObject({ word: 'una', key: 'es:un' });
    await act(h, (c) => c.actions.closeMeaning());
    expect(h.vm().meaning).toBeNull();
    await act(h, (c) => c.actions.command('next'));
    expect(as(h.vm().screen, 'cliff').sentence.text).toBe('Ella tiene una guitarra.');
    await speak(h, 'listo');
    expect(as(h.vm().screen, 'upNext').next).toBe('retell');
    const types = (await h.storage.learner.eventsSince()).map((e) => e.event.type);
    expect(types).toContain('gloss_lookup');
    expect(types).toContain('cliff_skip');
  });

  it('taps a tile to hear the word and holds one to see it', async () => {
    const h = await setup({ settings: { textMode: 'tiles' } });
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.sentence.words[1]?.display).toBe('tile');
    expect(h.vm().textMode).toBe('all_tiles');
    const speechOut = h.services.speechOut;
    await act(h, (c) => c.actions.hearWord(1));
    expect(speechOut.lastCall?.text).toBe('es');
    await act(h, (c) => c.actions.revealWord(1));
    expect(as(h.vm().screen, 'cliff').sentence.words[1]?.display).toBe('text');
    const types = (await h.storage.learner.eventsSince()).map((e) => e.event.type);
    expect(types).toEqual(['tap_rehear', 'hold_reveal']);
    await act(h, (c) => c.actions.setTextMode('all_text'));
    expect(as(h.vm().screen, 'cliff').sentence.words.slice(0, 3).map((w) => w.display)).toEqual(['text', 'text', 'text']);
    expect(await h.storage.settings.get('textMode')).toBe('text');
  });
});

describe('learner turns and retell', () => {
  async function throughChapter(h: Harness) {
    for (let i = 0; i < MARKET.sentences.length; i++) {
      if (i > 0) await act(h, (c) => c.actions.next());
      await speak(h, await expectedAnswer(h));
      expect(h.vm().screen?.kind).toBe('landing');
    }
    await act(h, (c) => c.actions.next());
  }

  it('asks the learner, prompts a self-repair on an asserted error, and accepts the repaired sentence (mock model)', async () => {
    const h = await setup({ pair: marketPair(), model: 'ready' });
    await throughChapter(h);
    const turn = as(h.vm().screen, 'turn');
    expect(turn.prompt).toEqual({ speaker: 'Marta', line: '¿Y tú? ¿Qué hiciste ayer?' });
    expect(h.services.speechOut.lastCall?.text).toBe('¿Y tú? ¿Qué hiciste ayer?');
    await speak(h, 'Soy cansado.');
    const rep = as(h.vm().screen, 'repair');
    expect(rep).toMatchObject({ phase: 'prompt_repair', ui: { key: 'repair.prompt' }, highlight: 0, explanation: null });
    expect(rep.said.map((w) => w.text)).toEqual(['Soy', 'cansado']);
    await speak(h, 'Estoy cansado.');
    expect(as(h.vm().screen, 'repair')).toMatchObject({ phase: 'repaired', done: true });
    const events = (await h.storage.learner.eventsSince()).map((e) => e.event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'spoke_error', key: 'es:ser' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'spoke_correct', key: 'es:cansado' }));
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'upNext').next).toBe('retell');
  });

  it('runs a retell round from the recognizer word timings, with pauses, and credits the time', async () => {
    const h = await setup({ pair: marketPair() });
    await throughChapter(h);
    expect(as(h.vm().screen, 'upNext').next).toBe('retell');
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'retell')).toMatchObject({ round: 0, laneMs: 60000, done: false });
    const before = await spokenTotal(h.storage);
    // Five words with a second between them: four pauses (>= 700 ms).
    await speak(h, { text: 'Marta llegó tarde al mercado', gapMs: 1000 });
    const r = as(h.vm().screen, 'retell');
    expect(r.round).toBe(1);
    expect(r.results[0]).toMatchObject({ round: 0, laneMs: 60000, words: 5 });
    expect(r.results[0]?.pauses).toHaveLength(4);
    expect(r.results[0]?.tiles[1]).toEqual({ startMs: 1350, endMs: 1700 });
    expect((await spokenTotal(h.storage)) - before).toBe(4 * 1350 + 350);
  });
});

describe('placement', () => {
  it('runs placement in the first story to placementDone, stores the prior and hands over the new learner', async () => {
    const h = await setup({ settings: { startLevel: 'placement' } });
    const first = as(h.vm().screen, 'cliff');
    expect(first.meta.mode).toBe('placement');
    let done: Extract<StoryScreen, { kind: 'placementDone' }> | null = null;
    for (let i = 0; i < 30 && !done; i++) {
      const s = h.screen();
      if (s.kind === 'placementDone') done = s;
      else if (s.kind === 'cliff') await act(h, (c) => c.actions.command('dont_know'));
      else await act(h, (c) => c.actions.next());
    }
    expect(done).not.toBeNull();
    expect(done?.items).toBeGreaterThan(0);
    const prior = await h.storage.learner.latestPrior();
    expect(prior?.kind).toBe('placement');
    // The placement tracker is stored as the prior and the session's new learner is in use.
    expect(h.replaced.at(-1)).toBe(h.controller.learner);
    const keys = [...frequencyLexemeKeys(h.services.packs.lang).slice(0, 40), 'es:sombrero', 'es:llegar'];
    const at = h.services.clock.now() + 1000;
    expect(knowledge(await reloaded(h, 'placement'), keys, at)).toEqual(knowledge(h.controller.learner, keys, at));
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').meta).toMatchObject({ chapter: 2 });
    expect(as(h.vm().screen, 'cliff').meta.mode).not.toBe('placement');
  });
});

describe('the model', () => {
  it('switches to the model when it becomes ready mid-session: answers are scored by it and the next sentence uses it', async () => {
    const h = await setup();
    expect(as(h.vm().screen, 'cliff').meta.canned).toBe(true);
    expect(h.vm().modelMode).toBe('canned');
    await h.services.model.load('/models/qwen.gguf');
    await h.controller.idle();
    expect(h.vm().modelMode).toBe('model');
    await act(h, (c) => c.actions.typeAnswer('cantante'));
    expect(as(h.vm().screen, 'landing').outcome.scoredBy).toBe('model');
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').meta.canned).toBe(false);
    await h.services.model.unload();
    await h.controller.idle();
    expect(h.vm().modelMode).toBe('canned');
    await act(h, (c) => c.actions.command('next'));
    expect(as(h.vm().screen, 'cliff').meta.canned).toBe(true);
  });
});

describe('storage', () => {
  it('lands on the same screen after a restart', async () => {
    const h = await setup();
    await speak(h, 'artista');
    await act(h, (c) => c.actions.next());
    await act(h, (c) => c.actions.command('slower'));
    const before = h.vm().screen;
    await h.controller.suspend();
    h.controller.dispose();
    const spokenBefore = h.services.speechOut.calls.length;
    const c2 = await h.restart();
    c2.actions.start();
    await c2.idle();
    expect(c2.getSnapshot().screen).toEqual(before);
    // Restoring does not talk over the learner; "Hear it again" plays the screen's cue.
    expect(h.services.speechOut.calls.length).toBe(spokenBefore);
    await act(h, (c) => c.actions.replay());
    expect(h.services.speechOut.spokenTexts[spokenBefore]).toBe('Ella tiene una');
    // The story goes on from there.
    await speak(h, 'guitarra');
    expect(as(c2.getSnapshot().screen, 'landing').outcome.credit).toBe('full');
  });

  it('applies every event exactly once: the learner rebuilt from storage equals the live one', async () => {
    const h = await setup({ settings: { textMode: 'tiles' } });
    await act(h, (c) => c.actions.hearWord(1));
    await act(h, (c) => c.actions.revealWord(2));
    await act(h, (c) => c.actions.command('meaning'));
    await speak(h, 'artista');
    await act(h, (c) => c.actions.next());
    await speak(h, 'no sé');
    await speak(h, 'guitarra');
    await act(h, (c) => c.actions.next());
    await act(h, (c) => c.actions.typeAnswer('importante'));
    await act(h, (c) => c.actions.next());
    const events = (await h.storage.learner.eventsSince()).map((e) => e.event);
    expect(events.length).toBeGreaterThan(6);
    const keys = [...new Set([...events.map((e) => e.key), 'es:hospital', ...frequencyLexemeKeys(h.services.packs.lang).slice(0, 30)])];
    const at = h.services.clock.now() + 1000;
    expect(knowledge(await reloaded(h, 'brandNew'), keys, at)).toEqual(knowledge(h.controller.learner, keys, at));
    // After a restart the restored learner is the same too.
    await h.controller.suspend();
    const c2 = await h.restart();
    c2.actions.start();
    await c2.idle();
    expect(knowledge(c2.learner, keys, at)).toEqual(knowledge(h.replaced[0] as LearnerModel, keys, at));
  });

  it('keeps minutes spoken per local day: today counts stored time and every credited utterance', async () => {
    const h = await setup({ start: false });
    const now = h.services.clock.now();
    await h.storage.spokenTime.addUtterance(60_000, now);
    await h.storage.spokenTime.addUtterance(30_000, now - 86_400_000);
    h.controller.actions.start();
    await h.controller.idle();
    expect(h.vm().spokenTodayMs).toBe(60_000);
    await speak(h, 'artista'); // 350 ms
    await act(h, (c) => c.actions.next());
    await speak(h, 'una guitarra'); // 820 ms
    await speak(h, 'eh'); // 350 ms, nothing to answer on a landing, still spoken
    expect(await h.storage.spokenTime.today(h.services.clock.now())).toBe(60_000 + 350 + 820 + 350);
    expect(h.vm().spokenTodayMs).toBe(60_000 + 350 + 820 + 350);
    expect(await spokenTotal(h.storage)).toBe(90_000 + 350 + 820 + 350);
  });
});

describe('settings and failures', () => {
  it('applies settings changed elsewhere to the session, also on restore', async () => {
    const h = await setup();
    const settings = await h.storage.settings.getAll();
    h.controller.setAppSettings({ ...settings, textMode: 'tiles' });
    await h.controller.idle();
    expect(h.vm().textMode).toBe('all_tiles');
    expect(as(h.vm().screen, 'cliff').sentence.words.slice(0, 3).map((w) => w.display)).toEqual(['tile', 'tile', 'tile']);
    await h.controller.suspend();
    // Changed while the story was away: the restored session takes them.
    await h.storage.settings.update({ textMode: 'text' });
    const c2 = await h.restart();
    c2.actions.start();
    await c2.idle();
    expect(as(c2.getSnapshot().screen, 'cliff').sentence.words.slice(0, 3).map((w) => w.display)).toEqual(['text', 'text', 'text']);
  });

  it("speaks with the learner's chosen voice and listens on the device unless network recognition is allowed", async () => {
    const h = await setup({ settings: { voiceId: 'fake.es-MX' } });
    expect(h.services.speechOut.lastCall).toMatchObject({ voice: 'fake.es-MX', lang: 'es-MX' });
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.services.speechIn.currentOptions).toMatchObject({ onDevice: true });
    h.controller.actions.holdCancel();
    const settings = await h.storage.settings.getAll();
    h.controller.setAppSettings({ ...settings, voiceId: null, allowNetworkRecognition: true });
    h.controller.actions.replay();
    await h.controller.idle();
    expect(h.services.speechOut.lastCall).toMatchObject({ voice: 'fake.es-PR', lang: 'es-PR' });
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.services.speechIn.currentOptions).toMatchObject({ onDevice: false });
  });

  it('writes nothing for a step that fails, keeps the screen and says so', async () => {
    const h = await setup({ model: 'ready' });
    jest.spyOn(h.services.model, 'nextTokens').mockRejectedValue(new Error('model crashed'));
    jest.spyOn(h.services.model, 'scoreContinuation').mockRejectedValue(new Error('model crashed'));
    const saved = (await h.storage.sessions.active('story'))?.updatedAt;
    await act(h, (c) => c.actions.typeAnswer('cantante'));
    expect(h.vm().screen?.kind).toBe('cliff');
    expect(h.vm().notice).toEqual({ key: 'story.notice.stepFailed' });
    expect(h.vm().busy).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(await h.storage.learner.countEvents()).toBe(0);
    expect((await h.storage.sessions.active('story'))?.updatedAt).toBe(saved);
    await act(h, (c) => c.actions.dismissNotice());
    expect(h.vm().notice).toBeNull();
  });

  it('tells the learner when the voice fails, and the no-sé flow still moves on', async () => {
    const h = await setup();
    jest.spyOn(h.services.speechOut, 'speak').mockRejectedValue(new Error('no voice'));
    await act(h, (c) => c.actions.command('dont_know'));
    expect(h.vm().notice).toEqual({ key: 'story.notice.speechOut' });
    expect(as(h.vm().screen, 'noSe').step).toBe('prompt_repeat');
    // Shown once: a device without voices fails every cue.
    await act(h, (c) => c.actions.dismissNotice());
    await act(h, (c) => c.actions.replay());
    expect(h.vm().notice).toBeNull();
  });
});

describe('listening', () => {
  it('shows the speech-in error key when the microphone is refused, and typing still works', async () => {
    const h = await setup();
    h.services.speechIn.permission = 'denied';
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.vm().listen).toEqual({ phase: 'error', messageKey: 'speechIn.error.notAllowed' });
    expect(h.services.speechIn.startCalls).toHaveLength(0);
    expect(h.services.haptics.played).toContain('error');
    await act(h, (c) => c.actions.typeAnswer('artista'));
    expect(h.vm().screen?.kind).toBe('landing');
  });

  it('shows recognizer errors, nothing heard, and drops a cancelled hold', async () => {
    const h = await setup();
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    h.services.speechIn.emitError('no-match');
    expect(h.vm().listen).toEqual({ phase: 'error', messageKey: 'speechIn.error.noMatch' });
    // A hold released with nothing said.
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    h.controller.actions.holdEnd();
    await h.controller.idle();
    expect(h.vm().listen).toEqual({ phase: 'error', messageKey: 'speechIn.error.noSpeech' });
    // A cancelled hold: aborted, nothing sent.
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    h.controller.actions.holdCancel();
    expect(h.services.speechIn.abortCalls).toBe(1);
    expect(h.vm().listen).toEqual({ phase: 'idle' });
    // A quick tap (released before the hold began) never listens.
    const starts = h.services.speechIn.startCalls.length;
    h.controller.actions.holdBegin();
    h.controller.actions.holdEnd();
    await h.controller.idle();
    expect(h.services.speechIn.startCalls.length).toBe(starts);
    expect(h.vm().listen).toEqual({ phase: 'idle' });
    expect(h.vm().screen?.kind).toBe('cliff');
    expect(await h.storage.learner.countEvents()).toBe(0);
  });
});

describe('report this sentence', () => {
  const APP = { version: '1.0.0', build: '12', platform: 'ios 18.2' };

  /** The decoded fields of a mailto: URL. */
  function mail(url: string): { to: string; subject: string; body: string } {
    const [to = '', query = ''] = url.replace(/^mailto:/, '').split('?');
    const fields = new Map(query.split('&').map((pair) => [pair.split('=')[0], decodeURIComponent(pair.split('=')[1] ?? '')] as const));
    return { to, subject: fields.get('subject') ?? '', body: fields.get('body') ?? '' };
  }

  it('opens a mail to the contact address with the sentence, canned or not, the version and the platform, then thanks', async () => {
    const opened: string[] = [];
    const h = await setup({ pair: marketPair(), openUrl: async (url) => void opened.push(url), appInfo: APP });
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.meta.canned).toBe(true);
    expect(h.controller.actions.reportSentence).toBeDefined();
    h.controller.actions.reportSentence?.();
    await h.controller.idle();
    expect(opened).toHaveLength(1);
    const m = mail(opened[0] ?? '');
    expect(m.to).toBe('hello@scottchanatry.com');
    expect(m.subject).toBe('Cliffword: report a sentence');
    expect(m.body).toContain(`Sentence: ${cliff.sentence.text}`);
    expect(m.body).toContain('Source: canned (a built-in starter sentence)');
    expect(m.body).toContain('Screen: cliff, chapter 1');
    expect(m.body).toContain('App version: 1.0.0 (build 12)');
    expect(m.body).toContain('Platform: ios 18.2');
    // Line breaks travel as CRLF, so every mail app shows the same lines.
    expect(opened[0]).toContain('%0D%0A');
    expect(h.vm().notice).toEqual({ key: 'story.notice.reported' });
    // The session did not move, and no step was written for the report.
    expect(h.vm().screen).toBe(cliff);
  });

  it('names a sentence the model wrote, and the line a character says on a turn', async () => {
    const opened: string[] = [];
    const h = await setup({ pair: marketPair(), model: 'ready', openUrl: async (url) => void opened.push(url), appInfo: { ...APP, build: null } });
    expect(as(h.vm().screen, 'cliff').meta.canned).toBe(false);
    h.controller.actions.reportSentence?.();
    await h.controller.idle();
    const body = mail(opened[0] ?? '').body;
    expect(body).toContain('Source: written by the on-device model');
    expect(body).toContain('App version: 1.0.0\r\n');

    for (let i = 0; i < MARKET.sentences.length; i++) {
      if (i > 0) await act(h, (c) => c.actions.next());
      await speak(h, await expectedAnswer(h));
    }
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'turn').prompt.line).toBe('¿Y tú? ¿Qué hiciste ayer?');
    h.controller.actions.reportSentence?.();
    await h.controller.idle();
    expect(mail(opened[1] ?? '').body).toContain('Sentence: ¿Y tú? ¿Qué hiciste ayer?\r\nSource: written by the on-device model\r\nScreen: turn, chapter 1');
  });

  it('says where to write when no mail app opens it', async () => {
    const h = await setup({ pair: marketPair(), openUrl: () => Promise.reject(new Error('no mail app')), appInfo: APP });
    h.controller.actions.reportSentence?.();
    await h.controller.idle();
    expect(h.vm().notice).toEqual({ key: 'story.notice.reportFailed', params: { email: 'hello@scottchanatry.com' } });
    expect(h.errors).toEqual([]);
  });

  it('is absent without a way to open mail, and reports nothing before the first screen', async () => {
    const without = await setup({ pair: marketPair() });
    expect(without.controller.actions.reportSentence).toBeUndefined();
    const opened: string[] = [];
    const h = await setup({ pair: marketPair(), openUrl: async (url) => void opened.push(url), start: false });
    h.controller.actions.reportSentence?.();
    await h.controller.idle();
    expect(opened).toEqual([]);
    expect(h.vm().notice).toBeNull();
  });
});

describe('app lifecycle', () => {
  it('suspends: stops the voice and listening and stores the session and a learner checkpoint', async () => {
    const speechOut = new FakeSpeechOut({ autoFinish: false });
    const h = await setup({ speechOut });
    expect(speechOut.isSpeaking).toBe(true);
    h.services.clock.advance(5 * SECOND);
    await h.controller.suspend();
    expect(speechOut.isSpeaking).toBe(false);
    const rec = await h.storage.sessions.active('story');
    expect(rec?.updatedAt).toBe(h.services.clock.now());
    expect(await h.storage.learner.latestPrior()).toEqual({ kind: 'brandNew' });
    // While listening: the recognizer is aborted.
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    await h.controller.suspend();
    expect(h.services.speechIn.abortCalls).toBe(1);
    expect(h.vm().listen).toEqual({ phase: 'idle' });
    // Nothing is lost: the same screen, and the story goes on.
    expect(h.vm().screen?.kind).toBe('cliff');
    await act(h, (c) => c.actions.typeAnswer('artista'));
    expect(h.vm().screen?.kind).toBe('landing');
  });
});

describe('actions that do not apply', () => {
  it('ignores every action before the first screen', async () => {
    const h = await setup({ start: false });
    const vm = h.vm();
    const c = h.controller;
    c.actions.next();
    c.actions.hearWord(0);
    c.actions.revealWord(0);
    c.actions.replay();
    c.actions.startRegisterTask();
    c.actions.holdBegin();
    c.actions.holdStart();
    c.actions.holdEnd();
    c.actions.holdCancel();
    c.actions.typeAnswer('hola');
    c.actions.command('next');
    c.actions.pickOption(0);
    c.actions.closeMeaning();
    c.actions.dismissNotice();
    await c.idle();
    expect(h.vm()).toBe(vm);
    expect(h.services.speechIn.startCalls).toHaveLength(0);
    expect(await h.storage.sessions.active('story')).toBeNull();
  });

  it('ignores actions that do not fit the cliff or the landing', async () => {
    const h = await setup();
    const c = h.controller;
    const quiet = async (fn: () => void) => {
      const vm = h.vm();
      const calls = h.services.speechOut.calls.length;
      const saved = (await h.storage.sessions.active('story'))?.updatedAt;
      h.services.clock.advance(SECOND);
      fn();
      await c.idle();
      expect(h.vm()).toBe(vm);
      expect(h.services.speechOut.calls.length).toBe(calls);
      expect((await h.storage.sessions.active('story'))?.updatedAt).toBe(saved);
    };
    // On the cliff: continue (skipping is the 'next' command), the register task, the gap
    // word, a word shown as text, an option that does not exist, no meaning or notice open.
    await quiet(() => c.actions.next());
    await quiet(() => c.actions.startRegisterTask());
    await quiet(() => c.actions.hearWord(3));
    await quiet(() => c.actions.revealWord(3));
    await quiet(() => c.actions.revealWord(0));
    await quiet(() => c.actions.hearWord(42));
    await quiet(() => c.actions.pickOption(7));
    await quiet(() => c.actions.closeMeaning());
    await quiet(() => c.actions.dismissNotice());
    await quiet(() => c.actions.typeAnswer('   '));
    await act(h, (x) => x.actions.pickOption(0));
    expect(h.vm().screen?.kind).toBe('landing');
    // On the landing: options and the register task.
    await quiet(() => c.actions.pickOption(0));
    await quiet(() => c.actions.startRegisterTask());
    await quiet(() => c.actions.revealWord(0));
    expect(await h.storage.learner.countEvents()).toBe(1);
  });
});
