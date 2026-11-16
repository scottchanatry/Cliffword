/**
 * The lyric controller over the real engine LyricSession, the en-es packs and the test
 * services: FakeSpeechIn plays the learner, FakeSpeechOut the voice, FakeMusicPlayer Apple
 * Music on the FakeClock, sql.js the storage, and MockModelAdapter the model (unloaded for
 * canned mode unless a test loads it).
 */
import { MockModelAdapter } from '../../adapters/model/MockModelAdapter';
import type { ScriptedUtterance } from '../../adapters/speechIn/FakeSpeechIn';
import { bootstrap } from '../../bootstrap/bootstrap';
import { saveLyrics } from '../../music/lyricsData';
import { sharedMockModel } from '../../services/defaults';
import { createTestServices, type TestServices } from '../../services/testServices';
import type { AppSettings } from '../../storage/repos/settings';
import type { Storage } from '../../storage/storage';
import type { LyricViewModel } from '../contract';
import { createLyricController, type LyricControllerHandle } from './createLyricController';
import type { LyricTarget } from './source';
import type { LyricScreen } from '@cliffword/engine';

const SECOND = 1000;

/** The previews' song, pasted as plain text (a section label the parser removes). */
const LUNA = `[Verso 1]
Esta noche salimos a janguear,
el corillo ya 'tá listo pa' janguear.
La luna de Santurce brilla en el mar,
y nadie se quiere ir pa' la casa.`;

/** The same song with LRC line times (pause at each line start). */
const LUNA_LRC = `[00:10.00]Esta noche salimos a janguear,
[00:14.00]el corillo ya 'tá listo pa' janguear.
[00:18.00]La luna de Santurce brilla en el mar,
[00:22.00]y nadie se quiere ir pa' la casa.`;

/** Enhanced LRC: word marks let the track stop right before the hidden word. */
const LUNA_WORDS = `[00:10.00]<00:10.00>Esta <00:10.40>noche <00:10.90>salimos <00:11.40>a <00:11.70>janguear,
[00:14.00]<00:14.00>el <00:14.30>corillo <00:14.90>ya <00:15.20>'tá <00:15.60>listo <00:16.00>pa' <00:16.40>janguear.`;

const EXPLICIT = `Esta noche salimos a janguear,
la calle 'tá brutal, coño, qué calor.`;

const ARTICLE = 'El metro de la ciudad abre tarde los domingos. Nadie sabe por qué cambió el horario. Los vecinos quieren una respuesta.';

interface Harness {
  services: TestServices;
  storage: Storage;
  controller: LyricControllerHandle;
  errors: unknown[];
  target: LyricTarget;
  vm: () => LyricViewModel;
  screen: () => LyricScreen;
  restart: () => Promise<LyricControllerHandle>;
}

interface SetupOptions {
  settings?: Partial<AppSettings>;
  model?: 'ready' | 'unloaded';
  lyrics?: string;
  /** apple: an Apple Music library song (FakeMusicPlayer's fake-song-1); manual: pasted only. */
  song?: 'apple' | 'manual';
  /** Apple Music access already granted. Default true. */
  authorized?: boolean;
  /** A brought text instead of a song. */
  text?: string;
  start?: boolean;
}

const live: LyricControllerHandle[] = [];

async function setup(opts: SetupOptions = {}): Promise<Harness> {
  const services = createTestServices({
    model: new MockModelAdapter({ model: sharedMockModel(), status: opts.model ?? 'unloaded' }),
  }) as unknown as TestServices;
  if (opts.authorized !== false) services.music.authorization = 'authorized';
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel: 'brandNew', ...opts.settings });
  let target: LyricTarget;
  if (opts.text !== undefined) {
    const text = await storage.texts.add({ title: 'El metro', rawText: opts.text });
    target = { kind: 'text', textId: text.id };
  } else {
    const song =
      opts.song === 'apple'
        ? await storage.songs.upsert({ source: 'apple_music', externalId: 'fake-song-1', title: 'Luna de Santurce', artist: 'Rayo K.', genre: 'Reggaeton' })
        : await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce', artist: 'Rayo K.' });
    if (opts.lyrics !== '') await saveLyrics(storage, song.id, opts.lyrics ?? LUNA, services.packs.lang);
    target = { kind: 'song', songId: song.id };
  }
  const errors: unknown[] = [];
  const build = async () => {
    const boot = await bootstrap(services);
    const c = createLyricController({
      target,
      model: services.model,
      packs: services.packs,
      storage,
      learner: boot.learner.learner,
      settings: boot.settings,
      speechOut: services.speechOut,
      speechIn: services.speechIn,
      haptics: services.haptics,
      clock: services.clock,
      music: services.music,
      seed: () => 7,
      ticker: null,
      updateSettings: (patch) => storage.settings.update(patch),
      onError: (e) => errors.push(e),
    });
    live.push(c);
    return c;
  };
  const h: Harness = {
    services,
    storage,
    controller: await build(),
    errors,
    target,
    vm: () => h.controller.getSnapshot(),
    screen: () => {
      const s = h.controller.getSnapshot().screen;
      if (!s) throw new Error('no screen yet');
      return s;
    },
    restart: async () => {
      h.controller.dispose();
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

function as<K extends LyricScreen['kind']>(screen: LyricScreen | null, kind: K): Extract<LyricScreen, { kind: K }> {
  expect(screen?.kind).toBe(kind);
  return screen as Extract<LyricScreen, { kind: K }>;
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

async function act(h: Harness, fn: (c: LyricControllerHandle) => void): Promise<void> {
  h.services.clock.advance(SECOND);
  fn(h.controller);
  await h.controller.idle();
}

/** Let the fake track run for `ms` and read it (FakeMusicPlayer pauses on the read that passes a target). */
async function runTrack(h: Harness, ms: number): Promise<void> {
  h.services.clock.advance(ms);
  h.services.music.tick();
  await h.controller.idle();
}

async function eventTypes(storage: Storage): Promise<string[]> {
  return (await storage.learner.eventsSince()).map((e) => `${e.event.type} ${e.event.key}`);
}

describe('a song with pasted lyrics', () => {
  it('parses and saves the lyrics, then opens the song page with its slang notes, silently', async () => {
    const h = await setup({ settings: { regions: ['PR', 'CARIB'] } });
    const read = as(h.vm().screen, 'read');
    expect(read.lines.map((l) => l.text)).toEqual([
      'Esta noche salimos a janguear,',
      "el corillo ya 'tá listo pa' janguear.",
      'La luna de Santurce brilla en el mar,',
      "y nadie se quiere ir pa' la casa.",
    ]);
    expect(read.meta).toMatchObject({ title: 'Luna de Santurce', artist: 'Rayo K.', total: 4, canned: true, source: 'lyrics' });
    expect(read.notes.map((n) => n.form)).toEqual(['janguear', 'corillo', "'tá", "pa'"]);
    expect(read.notes[0]).toMatchObject({ gloss: 'to hang out, go out', regions: ['PR'] });
    expect(read.playback).toBe('manual');
    expect(h.controller.getSource()).toMatchObject({ status: 'ready', kind: 'song', title: 'Luna de Santurce', linked: false });
    expect(h.vm()).toMatchObject({ busy: false, modelMode: 'canned', register: 'neutral', showExplicit: true, regions: ['PR', 'CARIB'], playback: { available: false } });
    // Opening a song plays nothing: sound only follows the learner's actions.
    expect(h.services.speechOut.calls).toEqual([]);
    expect((await h.storage.lyrics.get(h.target.kind === 'song' ? h.target.songId : ''))?.rawText).toBe(LUNA);
    expect(await h.storage.sessions.get(`lyric:${h.target.kind === 'song' ? h.target.songId : ''}`)).toMatchObject({ kind: 'lyric', version: 1, active: false });
    expect(h.errors).toEqual([]);
  });

  it('opens a line to its cliff, reads it up to the gap and the options, and lands a spoken answer with minutes spoken', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openLine(0));
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff).toMatchObject({ lineIndex: 0, before: 'Esta noche salimos a ', gapLength: 1, rung: 'options', play: { mode: 'manual' } });
    expect(h.services.speechOut.spokenTexts).toEqual(['Esta noche salimos a', ...(cliff.options ?? []).map((o) => o.text)]);
    expect(h.services.speechOut.calls[0]).toMatchObject({ lang: 'es-PR', rate: 1 });

    await speak(h, 'janguear');
    const result = as(h.vm().screen, 'result');
    expect(result.outcome).toMatchObject({ answer: 'janguear', credit: 'full', expected: 'janguear' });
    expect(result.line).toBe('Esta noche salimos a janguear,');
    expect(await eventTypes(h.storage)).toEqual(['cliff_answer es:janguear']);
    const spoken = await h.storage.spokenTime.total();
    expect(spoken).toBeGreaterThan(0);
    expect(h.vm().spokenTodayMs).toBe(spoken);
    expect(h.vm().listen).toEqual({ phase: 'idle' });
    expect(h.errors).toEqual([]);
  });

  it('takes a tapped option on the options rung, with no speaking time', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.next());
    const cliff = as(h.vm().screen, 'cliff');
    const right = (cliff.options ?? []).find((o) => o.text === 'janguear');
    expect(right).toBeDefined();
    await act(h, (c) => c.actions.pickOption(right?.index ?? -1));
    expect(as(h.vm().screen, 'result').outcome).toMatchObject({ credit: 'full', scoredBy: 'options', rung: 'options' });
    expect(await h.storage.spokenTime.total()).toBe(0);
    // A typed answer also earns no speaking time.
    await act(h, (c) => c.actions.next());
    await act(h, (c) => c.actions.typeAnswer('janguear'));
    expect(as(h.vm().screen, 'result').outcome.credit).toBe('full');
    expect(await h.storage.spokenTime.total()).toBe(0);
  });

  it('"no sé" plays the answer, then the repeat aloud is aligned', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openLine(1));
    await act(h, (c) => c.actions.command('dont_know'));
    // The voice played the answer, and the session moved on to the repeat.
    expect(h.services.speechOut.lastCall?.text).toBe('janguear');
    const noSe = as(h.vm().screen, 'noSe');
    expect(noSe).toMatchObject({ step: 'prompt_repeat', answer: 'janguear', ui: { key: 'cliff.repeatAloud' } });
    await speak(h, 'janguear');
    expect(as(h.vm().screen, 'noSe')).toMatchObject({ step: 'done', repeat: { understood: 1, total: 1 } });
    expect(await eventTypes(h.storage)).toEqual(['cliff_skip es:janguear', 'spoke_correct es:janguear']);
    expect(await h.storage.spokenTime.total()).toBeGreaterThan(0);
  });

  it('sings the line back: the echo is aligned word by word, clipped forms included', async () => {
    const h = await setup({ settings: { regions: ['PR', 'CARIB'] } });
    await act(h, (c) => c.actions.openLine(1));
    await act(h, (c) => c.actions.pickOption(0));
    await act(h, (c) => c.actions.startEcho());
    const echo = as(h.vm().screen, 'echo');
    expect(echo).toMatchObject({ lineIndex: 1, tiles: null, total: 7, ui: { key: 'music.singBack' } });
    expect(h.services.speechOut.lastCall?.text).toBe("el corillo ya 'tá listo pa' janguear.");
    await speak(h, 'el corillo ya está listo pa janguear');
    const sung = as(h.vm().screen, 'echo');
    expect(sung.landed).toBe(6);
    expect(sung.ui).toEqual({ key: 'echo.landed', params: { n: 6, m: 7 } });
    expect(sung.tiles?.find((t) => t.text === 'corillo')).toMatchObject({ slang: true, status: 'landed' });
    // Tap a tile: hear that word slowly (tap_rehear).
    await act(h, (c) => c.actions.hearWord(1));
    expect(h.services.speechOut.lastCall).toMatchObject({ text: 'corillo', rate: 0.7 });
    expect(await eventTypes(h.storage)).toContain('tap_rehear es:corillo');
  });

  it('shows the two registers side by side and keeps the chosen register', async () => {
    const h = await setup({ settings: { regions: ['PR', 'CARIB'] } });
    await act(h, (c) => c.actions.setRegister('street'));
    const reg = as(h.vm().screen, 'registers');
    expect(reg.pairs.find((p) => p.lineIndex === 1)).toEqual({
      lineIndex: 1,
      street: "el corillo ya 'tá listo pa' janguear.",
      neutral: 'el grupo ya está listo para salir.',
      swaps: [
        { from: 'grupo', to: 'corillo' },
        { from: 'está', to: "'tá" },
        { from: 'para', to: "pa'" },
        { from: 'salir', to: 'janguear' },
      ],
    });
    expect(h.vm().register).toBe('street');
    expect(await h.storage.settings.get('register')).toBe('street');
    await act(h, (c) => c.actions.showSong());
    expect(as(h.vm().screen, 'read').meta.register).toBe('street');
  });

  it('masks explicit slang while explicit lyrics are off, and keeps the stored text', async () => {
    const h = await setup({ lyrics: EXPLICIT, settings: { showExplicit: false } });
    const line = as(h.vm().screen, 'read').lines[1];
    expect(line?.masked).toHaveLength(1);
    const span = line?.masked[0];
    expect(line?.text.slice(span?.start, span?.end)).toBe('coño');
    expect(as(h.vm().screen, 'read').notes.some((n) => n.explicit)).toBe(false);
    expect(h.vm().showExplicit).toBe(false);
    await act(h, (c) => c.actions.setShowExplicit(true));
    expect(as(h.vm().screen, 'read').lines[1]?.masked).toEqual([]);
    expect(as(h.vm().screen, 'read').notes.some((n) => n.explicit)).toBe(true);
    expect(await h.storage.settings.get('showExplicit')).toBe(true);
    expect((await h.storage.lyrics.get(h.target.kind === 'song' ? h.target.songId : ''))?.rawText).toBe(EXPLICIT);
  });

  it('marks only the slang of the selected regions', async () => {
    const h = await setup({ settings: { regions: ['DO'] } });
    const forms = () => as(h.vm().screen, 'read').notes.map((n) => n.form);
    expect(forms()).not.toContain('janguear');
    expect(forms()).not.toContain('corillo');
    const boot = await bootstrap(h.services);
    h.controller.setAppSettings({ ...boot.settings, regions: ['PR'] });
    await h.controller.idle();
    expect(forms()).toEqual(expect.arrayContaining(['janguear', 'corillo']));
    expect(h.vm().regions).toEqual(['PR']);
  });

  it('restores the song session after a restart, on the same screen and silently', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openLine(0));
    await speak(h, 'janguear');
    const before = as(h.vm().screen, 'result');
    const calls = h.services.speechOut.calls.length;
    await h.restart();
    h.controller.actions.start();
    await h.controller.idle();
    expect(h.vm().screen).toEqual(before);
    expect(h.services.speechOut.calls).toHaveLength(calls);
    expect(h.vm().spokenTodayMs).toBeGreaterThan(0);
    // It goes on from there.
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').lineIndex).toBe(1);
  });

  it('starts afresh when the lyrics were pasted again', async () => {
    const h = await setup();
    await act(h, (c) => c.actions.openLine(0));
    expect(h.vm().screen?.kind).toBe('cliff');
    const songId = h.target.kind === 'song' ? h.target.songId : '';
    await saveLyrics(h.storage, songId, 'Otra canción, otra noche.\nY el corillo se fue.', h.services.packs.lang);
    h.controller.reload();
    await h.controller.idle();
    expect(as(h.vm().screen, 'read').lines.map((l) => l.text)).toEqual(['Otra canción, otra noche.', 'Y el corillo se fue.']);
  });

  it('tells a song without lyrics from a song that does not exist', async () => {
    const h = await setup({ lyrics: '' });
    expect(h.controller.getSource()).toMatchObject({ status: 'needsLyrics', title: 'Luna de Santurce', artist: 'Rayo K.' });
    expect(h.vm().screen).toBeNull();
    const missing = createLyricController({
      ...(await (async () => {
        const boot = await bootstrap(h.services);
        return { learner: boot.learner.learner, settings: boot.settings };
      })()),
      target: { kind: 'song', songId: 'nope' },
      model: h.services.model,
      packs: h.services.packs,
      storage: h.storage,
      speechOut: h.services.speechOut,
      speechIn: h.services.speechIn,
      haptics: h.services.haptics,
      clock: h.services.clock,
      music: h.services.music,
      ticker: null,
    });
    live.push(missing);
    missing.actions.start();
    await missing.idle();
    expect(missing.getSource()).toEqual({ status: 'missing' });
  });
});

describe('playback', () => {
  it('manual mode without a player: the voice reads each line and the track never plays', async () => {
    const h = await setup({ song: 'apple', lyrics: LUNA_LRC, authorized: false });
    expect(h.vm().playback).toEqual({ available: false, playing: false, positionMs: 0, durationMs: null });
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').play).toMatchObject({ mode: 'timed', pauseAtMs: 10000 });
    expect(h.services.speechOut.spokenTexts[0]).toBe('Esta noche salimos a');
    await act(h, (c) => c.actions.play());
    expect(h.services.music.played).toEqual([]);
  });

  it('timed mode: the track runs up to the cliff, pauses at pauseAtMs, and resumes only on the next action', async () => {
    const h = await setup({ song: 'apple', lyrics: LUNA_LRC });
    expect(h.controller.getSource()).toMatchObject({ status: 'ready', linked: true, genre: 'Reggaeton' });
    expect(h.vm().genre).toBe('Reggaeton');
    expect(h.vm().playback).toMatchObject({ available: true, playing: false });
    await act(h, (c) => c.actions.next());
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.play).toEqual({ mode: 'timed', startMs: 10000, endMs: 14000, pauseAtMs: 10000, precise: false });
    expect(h.services.music.played).toEqual(['fake-song-1']);
    // A run-up before the first line, and nothing said over the song.
    expect(h.services.music.positionMs()).toBe(4000);
    expect(h.vm().playback).toMatchObject({ playing: true });
    expect(h.services.speechOut.calls).toEqual([]);

    await runTrack(h, 5000);
    expect(h.services.music.state().status).toBe('playing');
    await runTrack(h, 1500);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 10000 });
    expect(h.vm().playback).toMatchObject({ playing: false, positionMs: 10000, durationMs: 200000 });
    // Paused at the line start: the voice reads the line up to the gap, then the options.
    expect(h.services.speechOut.spokenTexts[0]).toBe('Esta noche salimos a');

    await speak(h, 'janguear');
    expect(as(h.vm().screen, 'result').outcome.credit).toBe('full');
    await runTrack(h, 10_000);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 10000 });

    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').play.pauseAtMs).toBe(14000);
    expect(h.services.music.state().status).toBe('playing');
    expect(h.services.music.positionMs()).toBe(10000);
    await runTrack(h, 4000);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 14000 });
    expect(h.services.music.played).toEqual(['fake-song-1']);
  });

  it('with word marks the track stops right before the hidden word, and "otra vez" replays the run-up', async () => {
    const h = await setup({ song: 'apple', lyrics: LUNA_WORDS });
    await act(h, (c) => c.actions.openLine(1));
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.play).toMatchObject({ mode: 'timed', startMs: 14000, pauseAtMs: 16400, precise: true });
    expect(h.services.music.positionMs()).toBe(14000);
    await runTrack(h, 2400);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 16400 });
    // The singer carried the line up to the gap: the voice only reads the options.
    expect(h.services.speechOut.spokenTexts).toEqual((cliff.options ?? []).map((o) => o.text));

    await act(h, (c) => c.actions.command('again'));
    expect(h.services.music.state()).toMatchObject({ status: 'playing', positionMs: 14000 });
    await runTrack(h, 2400);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 16400 });
  });

  it('holding pauses the track before the microphone listens, and the sing-back starts stopped', async () => {
    const h = await setup({ song: 'apple', lyrics: LUNA_LRC });
    await act(h, (c) => c.actions.next());
    expect(h.services.music.state().status).toBe('playing');
    h.controller.actions.holdBegin();
    h.controller.actions.holdStart();
    await h.controller.idle();
    expect(h.services.music.state().status).toBe('paused');
    expect(h.services.speechIn.isListening).toBe(true);
    h.services.speechIn.queueUtterance('janguear');
    h.controller.actions.holdEnd();
    await h.controller.idle();
    expect(as(h.vm().screen, 'result').outcome.credit).toBe('full');

    await act(h, (c) => c.actions.play());
    expect(h.services.music.state().status).toBe('playing');
    await act(h, (c) => c.actions.startEcho());
    expect(as(h.vm().screen, 'echo').lineIndex).toBe(0);
    // The echo replays the line on the track from its start (stopped first, then a learner's tap started it).
    expect(h.services.music.positionMs()).toBe(10000);
    await runTrack(h, 4000);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 14000 });
  });

  it('times lines tapped while listening, then pauses at the tapped starts', async () => {
    const h = await setup({ song: 'apple', lyrics: LUNA });
    expect(as(h.vm().screen, 'read').playback).toBe('manual');
    await act(h, (c) => c.playFrom(0));
    expect(h.services.music.state().status).toBe('playing');
    for (const [index, ms] of [
      [0, 3000],
      [1, 4000],
      [2, 4000],
    ] as const) {
      h.services.clock.advance(ms);
      h.controller.actions.markLine(index, h.controller.positionMs());
      await h.controller.idle();
    }
    expect(h.controller.timingLines().map((l) => l.startMs)).toEqual([3000, 7000, 11000, null]);
    expect(as(h.vm().screen, 'read').playback).toBe('tapped');
    await act(h, (c) => c.actions.openLine(1));
    expect(as(h.vm().screen, 'cliff').play).toMatchObject({ mode: 'tapped', startMs: 7000, pauseAtMs: 7000 });
    expect(h.services.music.positionMs()).toBe(3000);
    await runTrack(h, 4000);
    expect(h.services.music.state()).toMatchObject({ status: 'paused', positionMs: 7000 });
  });
});

describe('a brought text', () => {
  it('opens in canned mode without the model, with cliffs and no shading', async () => {
    const h = await setup({ text: ARTICLE });
    const read = as(h.vm().screen, 'read');
    expect(read.meta.source).toBe('text');
    expect(read.lines).toHaveLength(3);
    expect(h.vm().surprise).toBeNull();
    await act(h, (c) => c.actions.next());
    expect(as(h.vm().screen, 'cliff').lineIndex).toBe(0);
  });

  it('with the model: surprise shading for the reader, cliffs scored by the model, minutes spoken', async () => {
    const h = await setup({ text: ARTICLE, model: 'ready' });
    const surprise = h.vm().surprise;
    expect(surprise).toHaveLength(3);
    expect(surprise?.[0]?.words.length).toBeGreaterThan(3);
    expect(surprise?.some((u) => u.words.some((w) => w.heat > 0))).toBe(true);
    expect(h.vm().modelMode).toBe('model');
    await act(h, (c) => c.actions.next());
    const cliff = as(h.vm().screen, 'cliff');
    expect(cliff.meta.canned).toBe(false);
    await act(h, (c) => c.actions.command('dont_know'));
    const answer = as(h.vm().screen, 'noSe').answer;
    await speak(h, answer);
    expect(as(h.vm().screen, 'noSe').repeat?.understood).toBeGreaterThan(0);
    expect(await h.storage.spokenTime.total()).toBeGreaterThan(0);
    const textId = h.target.kind === 'text' ? h.target.textId : '';
    expect(await h.storage.sessions.get(`text:${textId}`)).toMatchObject({ kind: 'lyric' });
    expect(h.errors).toEqual([]);
  });
});
