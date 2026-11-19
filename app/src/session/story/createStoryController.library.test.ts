/**
 * The story controller in library mode: the en-es experiences (Living in San Juan is the one
 * written), the test services (FakeSpeechIn plays the learner, FakeSpeechOut the voice, FakeClock
 * the time, sql.js the storage, MockModelAdapter the model, unloaded for matching mode).
 */
import { STORY_SESSION_FORMAT, StorySession, resolveVariants, storyForEpisode, variantContext, type LibraryProgress, type StoryScreen } from '@cliffword/engine';
import { MockModelAdapter } from '../../adapters/model/MockModelAdapter';
import { bootstrap } from '../../bootstrap/bootstrap';
import { sharedMockModel } from '../../services/defaults';
import { createTestServices, type TestServices } from '../../services/testServices';
import { ONBOARDED, type AppSettings } from '../../storage/repos/settings';
import type { Storage } from '../../storage/storage';
import { libraryPacks, livingTrack } from '../../testing/packs';
import type { StoryViewModel } from '../contract';
import { createStoryController, type StoryControllerHandle } from './createStoryController';

const SECOND = 1000;

interface Harness {
  services: TestServices;
  storage: Storage;
  controller: StoryControllerHandle;
  errors: unknown[];
  vm: () => StoryViewModel;
  screen: () => StoryScreen;
  library: () => LibraryProgress;
  restart: () => Promise<StoryControllerHandle>;
}

const live: StoryControllerHandle[] = [];

async function setup(settings: Partial<AppSettings> = {}, model: 'ready' | 'unloaded' = 'unloaded'): Promise<Harness> {
  const services = createTestServices({
    model: new MockModelAdapter({ model: sharedMockModel(), status: model }),
    packs: libraryPacks(),
  }) as unknown as TestServices;
  const storage = await services.storage.open();
  await storage.settings.update({ ...ONBOARDED, trackId: livingTrack().id, ...settings });
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
      seed: () => 11,
      updateSettings: (patch) => storage.settings.update(patch),
      onError: (e) => errors.push(e),
    });
    live.push(c);
    c.actions.start();
    await c.idle();
    return c;
  };
  const h: Harness = {
    services,
    storage,
    controller: await build(),
    errors,
    vm: () => h.controller.getSnapshot(),
    screen: () => {
      const s = h.controller.getSnapshot().screen;
      if (!s) throw new Error('no screen yet');
      return s;
    },
    library: () => {
      const l = h.controller.getSnapshot().library;
      if (!l) throw new Error('not in library mode');
      return l;
    },
    restart: async () => {
      h.controller = await build();
      return h.controller;
    },
  };
  return h;
}

afterEach(() => {
  for (const c of live.splice(0)) c.dispose();
});

function as<K extends StoryScreen['kind']>(screen: StoryScreen | null, kind: K): Extract<StoryScreen, { kind: K }> {
  expect(screen?.kind).toBe(kind);
  return screen as Extract<StoryScreen, { kind: K }>;
}

async function act(h: Harness, fn: (c: StoryControllerHandle) => void): Promise<void> {
  h.services.clock.advance(SECOND);
  fn(h.controller);
  await h.controller.idle();
}

/** The cliff's answer, from the stored session (the engine's own data). */
async function answer(h: Harness): Promise<string> {
  const rec = await h.storage.sessions.active<{ state: { current: { cliff: { answer: string } } | null } }>('story');
  return rec?.snapshot.state.current?.cliff.answer ?? '';
}

/** Play the episode on screen to its end: each cliff answered by `how`, each turn replied to. */
async function playEpisode(h: Harness, how: 'say' | 'tap'): Promise<Extract<StoryScreen, { kind: 'episodeDone' }>> {
  for (let guard = 0; guard < 200; guard++) {
    const s = h.screen();
    if (s.kind === 'episodeDone') return s;
    if (s.kind === 'cliff') {
      if (s.phase === 'playing') await act(h, (c) => c.actions.replay());
      else if (how === 'tap' && s.cliff.options?.length) {
        const right = await answer(h);
        const option = s.cliff.options.find((o) => o.text === right) ?? s.cliff.options[0];
        await act(h, (c) => c.actions.pickOption(option?.index ?? 0));
      } else {
        const right = await answer(h);
        await act(h, (c) => c.actions.typeAnswer(right));
      }
    } else if (s.kind === 'turn' && !s.reply && !s.example) {
      await act(h, (c) => c.actions.typeAnswer('Sí, muy bien, gracias.'));
    } else {
      await act(h, (c) => c.actions.next());
    }
  }
  throw new Error(`the episode did not end (on ${h.screen().kind})`);
}

describe('story controller, library mode', () => {
  it('starts on the Story home with the experiences, playing nothing until the episode opens', async () => {
    const h = await setup();
    expect(h.vm().view).toBe('home');
    expect(h.screen().kind).toBe('idle');
    expect(h.library().track).toBe(livingTrack().id);
    expect(h.library().tracks).toHaveLength(6);
    expect(h.library().tracks.filter((t) => t.comingSoon)).toHaveLength(5);
    expect(h.services.speechOut.calls).toEqual([]);
    const rec = await h.storage.sessions.active('story');
    expect(rec).toMatchObject({ kind: 'story', version: STORY_SESSION_FORMAT, active: true });
    expect(h.errors).toEqual([]);
  });

  it('recall (level 0): the whole line plays and shows, then the gap with three options; a tap lands', async () => {
    const h = await setup({ level: 0 });
    await act(h, (c) => c.actions.openEpisode());
    expect(h.vm().view).toBe('episode');
    const gap = as(h.screen(), 'cliff');
    expect(gap.mode).toBe('recall');
    // The line played whole (and was shown), then the session moved to the gap by itself.
    const line = h.services.speechOut.calls[0];
    expect(line?.text).toBe(gap.sentence.text);
    expect(gap.phase).toBe('gap');
    expect(gap.cliff.options).toHaveLength(3);
    expect(gap.translation).toEqual(expect.any(String));
    expect(gap.meta.library).toMatchObject({ episode: 1, line: 1 });
    expect(h.services.speechOut.calls[1]?.text).toBe(gap.sentence.text.slice(0, gap.sentence.text.indexOf(await answer(h))).trim());
    const right = await answer(h);
    const option = gap.cliff.options?.find((o) => o.text === right);
    expect(option).toBeDefined();
    await act(h, (c) => c.actions.pickOption(option?.index ?? -1));
    const landing = as(h.screen(), 'landing');
    expect(landing).toMatchObject({ expected: right, answer: right, scoredBy: 'options' });
    expect(landing.outcome.credit).toBe('full');
    await act(h, (c) => c.actions.next());
    expect(as(h.screen(), 'cliff').meta.library?.line).toBe(2);
  });

  it('addresses the learner as chosen ({you:...}), from onboarding and from Settings', async () => {
    const h = await setup({ address: 'f' });
    expect(h.library().address).toBe('f');
    // The first line of episode 1 that addresses the learner, resolved for a woman.
    const { pair } = libraryPacks();
    const raw = storyForEpisode(pair.library, livingTrack().id, 1, 0);
    const index = raw?.sentences.findIndex((x) => x.text.includes('{you:')) ?? -1;
    expect(index).toBeGreaterThanOrEqual(0);
    const track = pair.tracks?.find((t) => t.id === livingTrack().id);
    const want = resolveVariants(raw?.sentences[index]?.text ?? '', variantContext(track, 'f'));
    expect(want).not.toBe(resolveVariants(raw?.sentences[index]?.text ?? '', variantContext(track, 'm')));
    await act(h, (c) => c.actions.openEpisode());
    for (let guard = 0; guard < 40 && h.screen().meta.library?.line !== index + 1; guard++) {
      const s = h.screen();
      if (s.kind === 'cliff' && s.cliff.options?.length) await act(h, (c) => c.actions.pickOption(0));
      else if (s.kind === 'turn' && !s.example) await act(h, (c) => c.actions.command('dont_know'));
      else await act(h, (c) => c.actions.next());
    }
    expect(as(h.screen(), 'cliff').sentence.text).toBe(want);
    h.controller.setAppSettings({ ...(await h.storage.settings.getAll()), address: 'm' });
    await h.controller.idle();
    expect(h.library().address).toBe('m');
  });

  it('hint (level 2): the translation with the word in bold; a miss brings the options', async () => {
    const h = await setup({ level: 2 });
    await act(h, (c) => c.actions.openEpisode());
    const cliff = as(h.screen(), 'cliff');
    expect(cliff.mode).toBe('hint');
    expect(cliff.cliff.options).toBeUndefined();
    expect(cliff.translationHint?.text).toEqual(expect.any(String));
    await act(h, (c) => c.actions.typeAnswer('mesa'));
    const missed = as(h.screen(), 'cliff');
    expect(missed.missed).toBe('mesa');
    expect(missed.cliff.options).toHaveLength(3);
  });

  it('predict (level 4) with the model: a said answer is checked by the model, with other natural answers', async () => {
    const h = await setup({ level: 4 }, 'ready');
    await act(h, (c) => c.actions.openEpisode());
    const cliff = as(h.screen(), 'cliff');
    expect(cliff.mode).toBe('predict');
    expect(cliff.translation).toBeNull();
    const right = await answer(h);
    await act(h, (c) => c.actions.typeAnswer(right));
    const landing = as(h.screen(), 'landing');
    expect(landing.scoredBy).toBe('model');
    expect(landing.alternatives?.length ?? 0).toBeLessThanOrEqual(3);
    expect(h.vm().modelMode).toBe('model');
  });

  it('"No sé" in predict mode gives the options first, then the answer', async () => {
    const h = await setup({ level: 4 });
    await act(h, (c) => c.actions.openEpisode());
    await act(h, (c) => c.actions.command('dont_know'));
    expect(as(h.screen(), 'cliff').cliff.options).toHaveLength(3);
    await act(h, (c) => c.actions.command('dont_know'));
    expect(h.screen().kind).toBe('noSe');
  });

  it('plays a whole episode: turns are answered, the level goes up and is stored in the settings', async () => {
    const h = await setup({ level: 0 });
    await act(h, (c) => c.actions.openEpisode());
    const done = await playEpisode(h, 'say');
    expect(done).toMatchObject({ episode: 1, levelBefore: 0, levelAfter: 1, levelChange: 1 });
    expect(done.next?.episode).toBe(livingTrack().episodes[1]);
    expect(await h.storage.settings.get('level')).toBe(1);
    expect(h.library().tracks.find((t) => t.current)?.completed).toEqual([1]);
    // Next goes on with episode 2.
    await act(h, (c) => c.actions.next());
    expect(as(h.screen(), 'cliff').meta.library?.episode).toBe(2);
  });

  it('closes the episode to the home, and resumes the line on screen when it opens again', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openEpisode());
    const text = as(h.screen(), 'cliff').sentence.text;
    await act(h, (c) => c.actions.closeEpisode());
    expect(h.vm().view).toBe('home');
    const before = h.services.speechOut.calls.length;
    // On the home nothing plays, even after a restart.
    await h.restart();
    expect(h.vm().view).toBe('home');
    expect(as(h.screen(), 'cliff').sentence.text).toBe(text);
    expect(h.services.speechOut.calls.length).toBe(before);
    await act(h, (c) => c.actions.openEpisode());
    expect(h.services.speechOut.calls.length).toBeGreaterThan(before);
  });

  it('follows the settings: another level, a coming-soon experience refused, choices kept per track', async () => {
    const h = await setup({ level: 0 });
    const settings = await h.storage.settings.getAll();
    h.controller.setAppSettings({ ...settings, level: 3 });
    await h.controller.idle();
    expect(h.library().level).toBe(3);
    h.controller.setAppSettings({ ...settings, level: 3, trackId: 'en-es.track.dating', trackChoices: { 'en-es.track.dating': { partner: 'mateo' } } });
    await h.controller.idle();
    // Dating is coming soon in this build: the learner stays in San Juan.
    expect(h.library().track).toBe(livingTrack().id);
    expect(h.errors).toEqual([]);
  });

  it('replays a finished episode from the list', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openEpisode());
    await playEpisode(h, 'tap');
    await act(h, (c) => c.actions.closeEpisode());
    await act(h, (c) => c.actions.replayEpisode(1));
    expect(h.vm().view).toBe('episode');
    expect(as(h.screen(), 'cliff').meta.library).toMatchObject({ episode: 1, replay: true });
  });

  it('the mic button: a tap listens, a second tap sends; silence after speech stops it by itself', async () => {
    const h = await setup({ level: 0 });
    await act(h, (c) => c.actions.openEpisode());
    const right = await answer(h);
    h.controller.actions.micTap();
    await h.controller.idle();
    expect(h.vm().listen.phase).toBe('listening');
    expect(h.vm().micLatched).toBe(true);
    h.services.speechIn.queueUtterance(right);
    h.controller.actions.micTap();
    await h.controller.idle();
    expect(as(h.screen(), 'landing').answer).toBe(right);
    expect(h.vm().micLatched).toBe(false);

    await act(h, (c) => c.actions.next());
    while (h.screen().kind !== 'cliff') await act(h, (c) => c.actions.next());
    const next = await answer(h);
    h.controller.actions.micTap();
    await h.controller.idle();
    h.services.speechIn.queueUtterance(next);
    h.services.speechIn.emitLevel(-12);
    h.services.clock.advance(1600);
    h.services.speechIn.emitLevel(-58);
    await h.controller.idle();
    expect(as(h.screen(), 'landing').answer).toBe(next);
  });

  it("runs the session without the model's next-word guesses; the writer's listed answers still show", async () => {
    const create = jest.spyOn(StorySession, 'create');
    const restore = jest.spyOn(StorySession, 'restore');
    try {
      const h = await setup({ level: 0, address: 'f' }, 'ready');
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]?.[0].options?.library).toMatchObject({ modelAlternatives: false });
      await h.restart();
      expect(restore).toHaveBeenCalledTimes(1);
      expect(restore.mock.calls[0]?.[2]?.options?.library).toMatchObject({ modelAlternatives: false });
      // Typed answers are scored by the model; the feedback lists only the story's own other answers.
      const { pair } = libraryPacks();
      const raw = storyForEpisode(pair.library, livingTrack().id, 1, 0);
      const ctx = variantContext(pair.tracks?.find((t) => t.id === livingTrack().id), 'f');
      await act(h, (c) => c.actions.openEpisode());
      const seen: string[] = [];
      for (let guard = 0; guard < 40 && seen.length < 6; guard++) {
        const s = h.screen();
        if (s.kind === 'cliff') {
          const right = await answer(h);
          await act(h, (c) => c.actions.typeAnswer(right));
        } else if (s.kind === 'landing') {
          const id = s.meta.library?.lineId ?? '';
          const listed = (raw?.sentences.find((x) => x.id === id)?.cliff.accept ?? []).map((a) => resolveVariants(a, ctx)).slice(0, 3);
          expect({ id, scoredBy: s.scoredBy, alternatives: s.alternatives }).toEqual({ id, scoredBy: 'model', alternatives: listed });
          seen.push(id);
          await act(h, (c) => c.actions.next());
        } else if (s.kind === 'turn' && !s.example) await act(h, (c) => c.actions.command('dont_know'));
        else await act(h, (c) => c.actions.next());
      }
      expect(seen).toHaveLength(6);
      // Episode 1, line 5 ('Pancho es mi bebé') lists 'hijo' and 'mascota'.
      expect(raw?.sentences[4]?.cliff.accept).toEqual(['hijo', 'mascota']);
    } finally {
      create.mockRestore();
      restore.mockRestore();
    }
  });

  it('publishes the episode so far (lines, questions, replies), keeps it across a restart and starts empty with the next episode', async () => {
    const h = await setup({ level: 0, address: 'f' });
    expect(h.vm().transcript).toBeNull();
    await act(h, (c) => c.actions.openEpisode());
    expect(h.vm().transcript).toMatchObject({ track: livingTrack().id, episode: 1, replay: false, entries: [] });
    // Through the first question, answered, to the line after it.
    for (let guard = 0; guard < 40; guard++) {
      const s = h.screen();
      if (s.kind === 'cliff' && (h.vm().transcript?.entries ?? []).some((e) => e.kind === 'reply')) break;
      if (s.kind === 'cliff') {
        const right = await answer(h);
        await act(h, (c) => c.actions.pickOption(s.cliff.options?.find((o) => o.text === right)?.index ?? 0));
      } else if (s.kind === 'turn' && !s.reply && !s.example) await act(h, (c) => c.actions.typeAnswer('Estoy cansada, gracias.'));
      else await act(h, (c) => c.actions.next());
    }
    const { pair } = libraryPacks();
    const raw = storyForEpisode(pair.library, livingTrack().id, 1, 0);
    const ctx = variantContext(pair.tracks?.find((t) => t.id === livingTrack().id), 'f');
    const cliff = as(h.screen(), 'cliff');
    const index = raw?.sentences.findIndex((x) => x.id === cliff.meta.library?.lineId) ?? -1;
    const entries = h.vm().transcript?.entries ?? [];
    expect(entries.flatMap((e) => (e.kind === 'line' ? [e.text] : []))).toEqual(raw?.sentences.slice(0, index).map((x) => resolveVariants(x.text, ctx)));
    const turn = raw?.turns?.find((x) => x.after < index);
    expect(entries.filter((e) => e.kind !== 'line')).toEqual([
      { kind: 'question', id: turn?.id, speakerId: turn?.speaker, speaker: 'Doña Mari', text: turn?.line, translation: turn?.translation },
      { kind: 'reply', turnId: turn?.id, text: 'Estoy cansada, gracias.' },
    ]);
    expect(cliff.meta.library?.speakerId).toBe(raw?.sentences[index]?.speaker ?? null);
    // The app is killed mid-episode: the restored session gives the same story so far.
    const before = h.vm().transcript;
    await h.restart();
    expect(h.vm().view).toBe('home');
    expect(h.vm().transcript).toEqual(before);
    await act(h, (c) => c.actions.openEpisode());
    expect(h.vm().transcript).toEqual(before);
    await playEpisode(h, 'tap');
    expect(h.vm().transcript).toBeNull();
    await act(h, (c) => c.actions.next());
    expect(as(h.screen(), 'cliff').meta.library?.episode).toBe(2);
    expect(h.vm().transcript).toMatchObject({ episode: 2, entries: [] });
  });

  it('press and hold is push-to-talk: nothing stops it until the release', async () => {
    const h = await setup({ level: 0 });
    await act(h, (c) => c.actions.openEpisode());
    const right = await answer(h);
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.vm().micLatched).toBe(false);
    h.services.speechIn.emitLevel(-12);
    h.services.clock.advance(10 * SECOND);
    h.services.speechIn.emitLevel(-58);
    await h.controller.idle();
    expect(h.vm().listen.phase).toBe('listening');
    h.services.speechIn.queueUtterance(right);
    h.controller.actions.holdEnd();
    await h.controller.idle();
    expect(as(h.screen(), 'landing').answer).toBe(right);
  });
});
