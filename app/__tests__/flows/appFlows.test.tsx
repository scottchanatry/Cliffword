/**
 * The app end to end through the real router and root layout, on the test services (FakeSpeechIn
 * plays the learner, FakeSpeechOut the voice, the model unloaded: canned mode, sql.js storage):
 *
 * - first launch: onboarding (brand new) -> the Story tab's canned first story -> its cliff -> a
 *   spoken answer -> the landing -> the next sentence;
 * - the Music tab: paste lyrics -> the song page -> a line's cliff -> a sung answer -> the
 *   result -> the sing-back;
 * - profile -> settings -> explicit lyrics off -> the Music tab masks the explicit word;
 * - reset progress: onboarding is not shown again, the story starts again from its first cliff;
 * - a restart (new services over the same storage) lands on the same story screen.
 *
 * Every screen on the way is checked for named controls with 44 dp targets.
 */
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { FakeClock } from '../../src/adapters/clock/FakeClock';
import { FakeModelManager } from '../../src/adapters/model/FakeModelManager';
import { MockModelAdapter } from '../../src/adapters/model/MockModelAdapter';
import { saveLyrics } from '../../src/music/lyricsData';
import { FakeSpeechIn } from '../../src/adapters/speechIn/FakeSpeechIn';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createStorageService, storageClockFor, type StorageService } from '../../src/services/storageService';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { openMemoryStorage } from '../../src/storage/testing/openTestStorage';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');

/** Sample lyrics written for the tests (Puerto Rican slang and one explicit word, "puñeta"). */
const LYRICS = [
  'Esta noche salimos a janguear,',
  "el corillo ya 'tá listo pa' janguear.",
  "La calle 'tá brutal, puñeta, qué calor,",
  'bailamos hasta que salga el sol.',
].join('\n');

let live: TestServices[] = [];
let shared: StorageService | null = null;

beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

afterEach(async () => {
  setAppServices(undefined);
  for (const s of live.splice(0)) await s.storage.close();
  await shared?.close();
  shared = null;
});

/** Test services with the model unloaded (canned mode), a microphone already allowed. */
function install(overrides: { clock?: FakeClock; storage?: StorageService } = {}): TestServices {
  const clock = overrides.clock ?? new FakeClock();
  const services = createTestServices({
    clock,
    model: new MockModelAdapter({ model: sharedMockModel(), status: 'unloaded' }),
    modelManager: new FakeModelManager({ initial: 'absent', mode: 'manual' }),
    speechIn: new FakeSpeechIn({ clock }),
    ...(overrides.storage ? { storage: overrides.storage } : {}),
  }) as unknown as TestServices;
  if (!overrides.storage) live.push(services);
  setAppServices(services);
  return services;
}

async function onboarded(services: TestServices, extra: Record<string, unknown> = {}) {
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, onboardingStep: 'done', startLevel: 'brandNew', ...extra });
  return storage;
}

/** Every control on screen has an accessible name and a 44 dp target. */
function expectAccessibleControls() {
  const roles = ['button', 'togglebutton', 'link', 'radio', 'switch'] as const;
  const controls = roles.flatMap((role) => screen.queryAllByRole(role));
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

/** The screen-reader activate action of a hold control (VoiceOver users cannot hold anywhere). */
async function activate(testID: string) {
  await fireEvent(screen.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
}

/** Hold (the hold control's toggle), speak `text` for `ms`, and let go. */
async function speak(services: TestServices, holdTestID: string, text: string, ms = 1400) {
  await activate(holdTestID);
  await waitFor(() => expect(services.speechIn.isListening).toBe(true));
  services.clock.advance(ms);
  services.speechIn.queueUtterance(text);
  await activate(holdTestID);
}

/** Storage reads go through promise queues; the router's tests run on fake timers, so poll. */
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 200 && !ok(value); i++) value = await read();
  return value;
}

describe('first launch', () => {
  it('onboarding (brand new), the canned first story, a spoken answer, the landing, the next sentence', async () => {
    const services = install();
    const starter = services.packs.pair.starter;
    if (!starter) throw new Error('the en-es pair has a starter story');
    await renderRouter(APP_DIR, { initialUrl: '/' });

    // Onboarding: welcome -> model (not now) -> voice -> slang -> done.
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'I’m brand new' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    await fireEvent.press(await screen.findByTestId('voice-continue'));
    await fireEvent.press(await screen.findByTestId('onboarding-finish'));

    // The Story tab: the starter story, canned (no model), stops at its first cliff.
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(await screen.findByTestId('cliff-card')).toBeOnTheScreen();
    expect(screen.getByTestId('story-screen')).toHaveTextContent(/Marta/);
    await waitFor(() => expect(services.speechOut.spokenTexts[0]).toBe('Marta es una'));
    expectAccessibleControls();
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, startLevel: 'brandNew', modelDeclined: true });

    // A spoken answer: hold, say "artista", let go.
    await speak(services, 'hold-button', 'artista');
    expect(await screen.findByTestId('landing-headline')).toBeOnTheScreen();
    expect(screen.queryByTestId('cliff-card')).toBeNull();
    const events = await eventually(
      () => storage.learner.eventsSince(),
      (e) => e.length > 0,
    );
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'cliff_answer', key: 'es:artista', credit: 'full' })]));
    // Minutes spoken: the voiced answer is credited, and shown in the header.
    expect(await eventually(() => storage.spokenTime.total(), (ms) => ms > 0)).toBeGreaterThan(0);
    expectAccessibleControls();

    // Siguiente: the next sentence of the starter story, at its cliff.
    const spokenBefore = services.speechOut.spokenTexts.length;
    await fireEvent.press(screen.getByTestId('command-next'));
    expect(await screen.findByTestId('cliff-card')).toBeOnTheScreen();
    const second = starter.sentences[1]?.text ?? '';
    await waitFor(() => expect(services.speechOut.spokenTexts.length).toBeGreaterThan(spokenBefore));
    // The sentence up to its cliff is read (then the options, on the options rung).
    expect(services.speechOut.spokenTexts.slice(spokenBefore).some((text) => text.length > 0 && second.startsWith(text))).toBe(true);
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  });
});

describe('the Music tab', () => {
  it('pastes lyrics, opens the song, answers a line by singing, gets the result and sings it back', async () => {
    const services = install();
    const storage = await onboarded(services, { regions: ['PR', 'CARIB'] });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('tab-music'));
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expectAccessibleControls();

    // Paste the lyrics; the preview counts them; save opens the song page (A3).
    await fireEvent.press(within(screen.getByTestId('source-lyrics')).getByRole('button'));
    expect(await screen.findByTestId('paste-screen')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('paste-title'), 'Noche de prueba');
    await fireEvent.changeText(screen.getByTestId('paste-artist'), 'Los Ensayos');
    await fireEvent.changeText(screen.getByTestId('paste-text'), LYRICS);
    expect(await screen.findByTestId('paste-preview')).toHaveTextContent(/4 lines/);
    await fireEvent.press(screen.getByTestId('paste-save'));
    expect(await screen.findByTestId('song-lines')).toBeOnTheScreen();
    expect(screen.getByTestId('slang-note-janguear')).toBeOnTheScreen();
    expectAccessibleControls();
    const [song] = await storage.songs.list();
    expect(song).toMatchObject({ title: 'Noche de prueba', artist: 'Los Ensayos' });

    // The first line's cliff (C1): the voice reads the line up to the gap (manual mode).
    await fireEvent.press(screen.getByTestId('sing-next-word'));
    expect(await screen.findByTestId('lyric-current')).toHaveTextContent(/Esta noche salimos a/);
    await waitFor(() => expect(services.speechOut.spokenTexts).toContain('Esta noche salimos a'));
    expectAccessibleControls();

    // Sing the answer: hold "SING IT", sing "janguear", let go.
    await speak(services, 'sing-it', 'janguear');
    expect(await screen.findByTestId('result-headline')).toBeOnTheScreen();
    const events = await eventually(
      () => storage.learner.eventsSince(),
      (e) => e.length > 0,
    );
    expect(events.map((e) => e.event)).toEqual([expect.objectContaining({ type: 'cliff_answer', key: 'es:janguear', credit: 'full' })]);
    expect(await eventually(() => storage.spokenTime.total(), (ms) => ms > 0)).toBeGreaterThan(0);
    expectAccessibleControls();

    // The sing-back (B4): sing the whole line; the learner's row shows what landed.
    await fireEvent.press(screen.getByTestId('start-echo'));
    expect(await screen.findByTestId('echo-eyebrow')).toBeOnTheScreen();
    expectAccessibleControls();
    await speak(services, 'hold-area', 'Esta noche salimos a janguear', 2600);
    expect(await screen.findByTestId('echo-landed')).toHaveTextContent(/of/);
    expect(screen.getByTestId('echo-tiles-learner')).toBeOnTheScreen();
    expect(await storage.sessions.get(`lyric:${song?.id}`)).toMatchObject({ kind: 'lyric' });
  });
});

describe('settings reach the other tabs', () => {
  it('turning explicit lyrics off in Settings masks the explicit word on the song page', async () => {
    const services = install();
    const storage = await onboarded(services, { regions: ['PR', 'CARIB'] });
    const song = await storage.songs.upsert({ source: 'manual', title: 'Noche de prueba', artist: 'Los Ensayos' });
    await saveLyrics(storage, song.id, LYRICS, services.packs.lang);
    await renderRouter(APP_DIR, { initialUrl: `/music/${song.id}` });

    // Explicit lyrics are on by default: the word is there.
    expect(await screen.findByTestId('song-lines')).toBeOnTheScreen();
    expect(within(screen.getByTestId('song-lines')).getByText(/puñeta/)).toBeOnTheScreen();
    expect(screen.queryAllByLabelText('Hidden word (explicit lyrics are off)')).toHaveLength(0);

    // Profile -> Settings -> Explicit lyrics off.
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Explicit lyrics' }).props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(screen.getByRole('switch', { name: 'Explicit lyrics' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Explicit lyrics' }).props.accessibilityState?.checked).toBe(false));
    expect(await storage.settings.get('showExplicit')).toBe(false);
    // Back to the profile, then close the modal (screens under a modal are hidden from queries).
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(await screen.findByTestId('close-profile'));

    // Back on the song: the word is a blank chip, named for screen readers, and its text is gone.
    await waitFor(() => expect(screen.queryAllByLabelText('Hidden word (explicit lyrics are off)').length).toBeGreaterThan(0));
    expect(within(screen.getByTestId('song-lines')).queryByText(/puñeta/)).toBeNull();
    expectAccessibleControls();
  });
});

describe('reset progress', () => {
  it('clears the progress and restarts the story; onboarding is not shown again', async () => {
    const services = install();
    const storage = await onboarded(services);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('cliff-card')).toBeOnTheScreen();

    // Some progress: answer the first cliff, move to the next sentence.
    await speak(services, 'hold-button', 'artista');
    expect(await screen.findByTestId('landing-headline')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('command-next'));
    expect(await screen.findByTestId('cliff-card')).toBeOnTheScreen();
    expect((await eventually(() => storage.learner.eventsSince(), (e) => e.length > 0)).length).toBeGreaterThan(0);
    const before = await storage.sessions.active('story');

    // Settings -> Reset progress -> confirm.
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Reset progress' }));
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));

    // The Story tab again, at the first cliff of the starter story, with nothing learned.
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();
    expect(within(screen.getByTestId('cliff-options')).getByText('artista')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(await storage.learner.eventsSince()).toEqual([]);
    expect(await storage.spokenTime.total()).toBe(0);
    const after = await eventually(
      () => storage.sessions.active('story'),
      (s) => s !== null,
    );
    expect(after?.id).not.toBe(before?.id);
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, onboardingStep: 'done' });

    // The old session wrote nothing back after the reset.
    expect((await storage.sessions.list({ kind: 'story' })).map((s) => s.id)).toEqual([after?.id]);
  });
});

describe('restart', () => {
  it('new services over the same storage restore the story screen where the learner left it', async () => {
    const clock = new FakeClock();
    let ids = 0;
    const inner = createStorageService('sql.js-memory', () => openMemoryStorage(storageClockFor(clock, () => `flow-${++ids}`)));
    // The database outlives the first app (closing it is the app's exit, not the data's end).
    shared = inner;
    const persistent: StorageService = { backend: inner.backend, open: () => inner.open(), close: async () => undefined };

    // First run: answer the first cliff and land.
    const first = install({ clock, storage: persistent });
    await onboarded(first);
    const app = await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('cliff-card')).toBeOnTheScreen();
    await speak(first, 'hold-button', 'artista');
    expect(await screen.findByTestId('landing-headline')).toBeOnTheScreen();
    const headline = screen.getByTestId('landing-headline').props.children as string;
    const storage = await persistent.open();
    await eventually(
      () => storage.sessions.active<{ screen?: { kind?: string } }>('story'),
      (s) => s !== null,
    );
    await app.unmount();
    setAppServices(undefined);

    // Second run: new services (voice, microphone, model, app state) over the same storage.
    clock.advance(3_600_000);
    const second = install({ clock, storage: persistent });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('landing-headline')).toBeOnTheScreen();
    expect(screen.getByTestId('landing-headline').props.children).toBe(headline);
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    // Restoring plays nothing: audio only follows a learner's action.
    expect(second.speechOut.spokenTexts).toEqual([]);
    expectAccessibleControls();
  });
});
