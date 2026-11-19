/**
 * The Music tab's stack and the brought-text routes through the real router and root layout:
 * the library (C3) from storage, paste -> parse -> save -> the song page, the song's cliff and
 * result, a share from the inbox confirmed into a song, Apple Music on and off, and a brought
 * text read and opened at a cliff. The model is unloaded (canned mode) unless a test loads it.
 */
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { MockModelAdapter } from '../../src/adapters/model/MockModelAdapter';
import { MUSIC_ENABLED } from '../../src/config/features';
import { UnsupportedMusicPlayer } from '../../src/adapters/music/UnsupportedMusicPlayer';
import { saveLyrics } from '../../src/music/lyricsData';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');

const LUNA = `[Coro]
Esta noche salimos a janguear,
el corillo ya 'tá listo pa' janguear.
La luna de Santurce brilla en el mar,
y nadie se quiere ir pa' la casa.`;

const ARTICLE = 'El metro de la ciudad abre tarde los domingos. Nadie sabe por qué cambió el horario. Los vecinos quieren una respuesta.';

let services: TestServices;

beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

beforeEach(() => {
  services = createTestServices({ model: new MockModelAdapter({ model: sharedMockModel(), status: 'unloaded' }) }) as unknown as TestServices;
  setAppServices(services);
});

afterEach(async () => {
  setAppServices(undefined);
  await services.storage.close();
});

async function onboarded() {
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel: 'brandNew', regions: ['PR', 'CARIB'] });
  return storage;
}

/** Every control has an accessible name and a 44 dp target (the same check as routes.test.tsx). */
function expectAccessibleControls() {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('togglebutton'), ...screen.queryAllByRole('link')];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({ testID: control.props.testID, named: true });
    if (String(control.props.testID ?? '').startsWith('tab-')) continue;
    const style = StyleSheet.flatten(control.props.style) ?? {};
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, height: true });
  }
}

// Music is off in this build (src/config/features.ts): the routes redirect to the Story tab
// (musicHidden.test.tsx). These tests run again when it is turned back on.
const describeMusic = MUSIC_ENABLED ? describe : describe.skip;

describeMusic('Music tab', () => {
  it('pastes lyrics, previews them, saves the song and opens its page with the slang notes', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('library-empty')).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByTestId('source-lyrics')).getByRole('button'));
    expect(await screen.findByTestId('paste-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/music/paste');

    await fireEvent.changeText(screen.getByTestId('paste-title'), 'Luna de Santurce');
    await fireEvent.changeText(screen.getByTestId('paste-artist'), 'Rayo K.');
    await fireEvent.changeText(screen.getByTestId('paste-text'), LUNA);
    expect(await screen.findByTestId('paste-preview')).toBeOnTheScreen();
    expect(screen.getByTestId('paste-preview')).toHaveTextContent(/4 lines/);
    expectAccessibleControls();

    await fireEvent.press(screen.getByTestId('paste-save'));
    expect(await screen.findByTestId('song-lines')).toBeOnTheScreen();
    const [song] = await storage.songs.list();
    expect(song).toMatchObject({ source: 'manual', title: 'Luna de Santurce', artist: 'Rayo K.' });
    expect(screen).toHavePathname(`/music/${song?.id}`);
    expect((await storage.lyrics.get(song?.id ?? ''))?.rawText).toBe(LUNA);
    expect(screen.getByTestId('slang-note-janguear')).toBeOnTheScreen();
    expect(screen.getByTestId('slang-note-corillo')).toBeOnTheScreen();
    expectAccessibleControls();

    // Back in the library, the song's row tells its region and slang.
    await fireEvent.press(screen.getByTestId('tab-music'));
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(await screen.findByText('Luna de Santurce')).toBeOnTheScreen();
  });

  it("opens a song's line at a cliff, takes an option and lands on the result, then sings it back", async () => {
    const storage = await onboarded();
    const song = await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce', artist: 'Rayo K.' });
    await saveLyrics(storage, song.id, LUNA, services.packs.lang);
    await renderRouter(APP_DIR, { initialUrl: `/music/${song.id}` });
    await fireEvent.press(await screen.findByTestId('sing-next-word'));
    expect(await screen.findByTestId('lyric-current')).toBeOnTheScreen();
    expect(screen.getByTestId('lyric-current')).toHaveTextContent(/Esta noche salimos a/);
    // The voice read the line up to the gap (manual mode: no Apple Music here).
    await waitFor(() => expect(services.speechOut.spokenTexts[0]).toBe('Esta noche salimos a'));
    expectAccessibleControls();

    await fireEvent.press(screen.getByTestId('show-options'));
    await fireEvent.press(within(await screen.findByTestId('options-sheet')).getByText('janguear'));
    expect(await screen.findByTestId('result-headline')).toBeOnTheScreen();
    // The step was written before the result showed (the router's tests run on fake timers: poll the promises).
    expect((await storage.learner.eventsSince()).map((e) => e.event)).toEqual([expect.objectContaining({ type: 'cliff_answer', key: 'es:janguear', credit: 'full' })]);
    await fireEvent.press(screen.getByTestId('start-echo'));
    expect(await screen.findByTestId('echo-eyebrow')).toBeOnTheScreen();
    expect(await storage.sessions.get(`lyric:${song.id}`)).toMatchObject({ kind: 'lyric' });
  });

  it('confirms a shared song from the inbox, then asks for its lyrics', async () => {
    const storage = await onboarded();
    const item = services.share.receive({ url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', text: 'Luna de Santurce - Rayo K.' });
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    await fireEvent.press(await screen.findByTestId(`share-${item?.id}`));
    expect(await screen.findByTestId('share-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('share-title').props.value).toBe('Luna de Santurce');
    expect(screen.getByTestId('share-artist').props.value).toBe('Rayo K.');
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('share-confirm'));

    expect(await screen.findByTestId('paste-screen')).toBeOnTheScreen();
    const [song] = await storage.songs.list();
    expect(song).toMatchObject({ source: 'spotify_share', externalId: '4uLU6hMCjMI75M1A2tKUQC', title: 'Luna de Santurce' });
    expect(services.share.pending()).toEqual([]);
    expect(screen.getByTestId('paste-song')).toHaveTextContent(/Luna de Santurce/);
    await fireEvent.changeText(screen.getByTestId('paste-text'), LUNA);
    await fireEvent.press(await screen.findByTestId('paste-save'));
    expect(await screen.findByTestId('song-lines')).toBeOnTheScreen();
    expect(screen).toHavePathname(`/music/${song?.id}`);
  });

  it('shows the two registers of a song side by side, then the song again', async () => {
    const storage = await onboarded();
    const song = await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce', artist: 'Rayo K.' });
    await saveLyrics(storage, song.id, LUNA, services.packs.lang);
    await renderRouter(APP_DIR, { initialUrl: `/music/registers?songId=${song.id}` });
    expect(await screen.findByTestId('register-pair-1')).toBeOnTheScreen();
    expect(screen.getByTestId('register-neutral-1')).toHaveTextContent(/el grupo ya está listo para salir/);
    expect(screen.getByTestId('register-street-1')).toHaveTextContent(/el corillo ya 'tá listo pa' janguear/);
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('show-song'));
    expect(await screen.findByTestId('song-lines')).toBeOnTheScreen();
  });

  it('times the lines of an Apple Music song while it plays', async () => {
    const storage = await onboarded();
    services.music.authorization = 'authorized';
    const song = await storage.songs.upsert({ source: 'apple_music', externalId: 'fake-song-1', title: 'Luna de Santurce', artist: 'Rayo K.' });
    await saveLyrics(storage, song.id, LUNA, services.packs.lang);
    await renderRouter(APP_DIR, { initialUrl: `/music/time?songId=${song.id}` });
    expect(await screen.findByTestId('time-screen')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId('now-playing-toggle'));
    await waitFor(() => expect(services.music.state().status).toBe('playing'));
    expectAccessibleControls();
    services.clock.advance(3000);
    await fireEvent.press(screen.getByTestId('time-tap'));
    services.clock.advance(4000);
    await fireEvent.press(screen.getByTestId('time-tap'));
    await waitFor(() => expect(screen.getByTestId('time-at-1')).toHaveTextContent(/0:07/));
    expect(screen.getByTestId('time-at-0')).toHaveTextContent(/0:03/);
    let snapshot = (await storage.sessions.get<{ state: { taps: Record<string, number> } }>(`lyric:${song.id}`))?.snapshot;
    for (let i = 0; i < 50 && Object.keys(snapshot?.state.taps ?? {}).length < 2; i++) {
      snapshot = (await storage.sessions.get<{ state: { taps: Record<string, number> } }>(`lyric:${song.id}`))?.snapshot;
    }
    expect(snapshot?.state.taps).toEqual({ l0: 3000, l1: 7000 });
  });

  it('shows a song without lyrics as waiting for them', async () => {
    const storage = await onboarded();
    const song = await storage.songs.upsert({ source: 'manual', title: 'Malecón a las dos', artist: 'Brisa 809' });
    await renderRouter(APP_DIR, { initialUrl: `/music/${song.id}` });
    expect(await screen.findByTestId('needs-lyrics-screen')).toBeOnTheScreen();
    expect(screen.getByText('Malecón a las dos')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('needs-lyrics-paste'));
    expect(await screen.findByTestId('paste-screen')).toBeOnTheScreen();
  });

  it('lists the Apple Music library once access is granted, and adds a song from it', async () => {
    const storage = await onboarded();
    services.music.authorization = 'authorized';
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('apple-library')).toBeOnTheScreen();
    expect(screen.getByText('Janguea Conmigo')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('apple-add-fake-song-2'));
    expect(await screen.findByTestId('needs-lyrics-screen')).toBeOnTheScreen();
    expect(await storage.songs.findByExternal('apple_music', 'fake-song-2')).toMatchObject({ title: 'Janguea Conmigo' });
  });

  it('asks for Apple Music access only when the learner connects', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(services.music.authorization).toBe('notDetermined');
    await fireEvent.press(within(await screen.findByTestId('source-apple-music')).getByRole('button'));
    expect(await screen.findByTestId('apple-library')).toBeOnTheScreen();
    expect(services.music.authorization).toBe('authorized');
  });

  it('shows Apple Music as not available where MusicKit does not exist', async () => {
    services = createTestServices({ music: new UnsupportedMusicPlayer() }) as unknown as TestServices;
    setAppServices(services);
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    const row = await screen.findByTestId('source-apple-music');
    await waitFor(() => expect(within(row).queryByRole('button')).toBeNull());
    expect(within(screen.getByTestId('source-lyrics')).getByRole('button')).toBeOnTheScreen();
  });
});

describeMusic('brought text', () => {
  it('pastes an article, saves it on the device and opens it at its first cliff', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    await fireEvent.press(await screen.findByTestId('bring-text'));
    expect(await screen.findByTestId('text-paste-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/text/paste');
    await fireEvent.changeText(screen.getByTestId('text-paste-title'), 'El metro');
    await fireEvent.changeText(screen.getByTestId('text-paste-text'), ARTICLE);
    expect(await screen.findByTestId('text-paste-preview')).toHaveTextContent(/3 sentences/);
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('text-paste-save'));

    expect(await screen.findByTestId('text-sentences')).toBeOnTheScreen();
    const [text] = await storage.texts.list();
    expect(text).toMatchObject({ title: 'El metro', rawText: ARTICLE });
    expect(screen).toHavePathname(`/text/${text?.id}`);
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('text-start'));
    expect(await screen.findByTestId('text-current')).toBeOnTheScreen();
    expect(await storage.sessions.get(`text:${text?.id}`)).toMatchObject({ kind: 'lyric' });
  });
});
