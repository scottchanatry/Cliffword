/**
 * The app end to end through the real router and root layout, on the test services (FakeSpeechIn
 * plays the learner, FakeSpeechOut the voice, the model unloaded: matching mode, sql.js storage):
 *
 * - first launch: onboarding (Living in San Juan, brand new, as a woman, the chef as her
 *   picture, typing) -> the Story home, the chef on the header button -> episode 1 -> the guide ->
 *   the line, then its gap -> an answer said with the mic -> feedback -> the next line -> back to
 *   the home;
 * - Settings: another level and form of address reach the story; "Your picture" (a character, a
 *   selfie, Remove photo) reaches the header button;
 * - reset progress: onboarding is not shown again, the experience starts again at episode 1;
 * - a restart (new services over the same storage) comes back to the home, then to the same
 *   screen, playing nothing until the learner opens the episode;
 * - (while Music is on) the Music tab and explicit lyrics, as before.
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
import { MUSIC_ENABLED } from '../../src/config/features';
import { YOU_AVATARS } from '../../src/illustrations';
import { ONBOARDED } from '../../src/storage/repos/settings';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { livingTrack } from '../../src/testing/packs';
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
  await storage.settings.update({ ...ONBOARDED, startLevel: 'brandNew', trackId: livingTrack().id, guideSeen: true, ...extra });
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

/** The cliff's answer, from the stored session (the engine's own data). */
async function storyAnswer(services: TestServices): Promise<string> {
  const storage = await services.storage.open();
  const rec = await storage.sessions.active<{ state: { current: { cliff: { answer: string } } | null } }>('story');
  return rec?.snapshot.state.current?.cliff.answer ?? '';
}

/** Tap the mic, say `text` for `ms`, tap again. */
async function sayWithMic(services: TestServices, text: string, ms = 1400) {
  await fireEvent.press(screen.getByTestId('mic-button'));
  await waitFor(() => expect(services.speechIn.isListening).toBe(true));
  services.clock.advance(ms);
  services.speechIn.queueUtterance(text);
  await fireEvent.press(screen.getByTestId('mic-button'));
}

describe('first launch', () => {
  it('onboarding, the Story home, episode 1 with its guide, a said answer, feedback, the next line', async () => {
    const services = install();
    await renderRouter(APP_DIR, { initialUrl: '/' });

    // Onboarding: welcome -> San Juan -> brand new -> as a woman -> the chef -> type instead.
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.press(await screen.findByTestId(`experience-${livingTrack().id}`));
    await fireEvent.press(await screen.findByTestId('level-new'));
    await fireEvent.press(await screen.findByTestId('address-f'));
    await fireEvent.press(await screen.findByTestId('picture-character-you-chef'));
    await waitFor(() => expect(screen.getByTestId('picture-character-you-chef').props.accessibilityState).toMatchObject({ checked: true }));
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('picture-continue'));
    await fireEvent.press(await screen.findByTestId('mic-finish'));

    // The Story home: nothing plays until the episode opens.
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(services.speechOut.spokenTexts).toEqual([]);
    expectAccessibleControls();
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({
      onboarded: true,
      level: 0,
      address: 'f',
      trackId: livingTrack().id,
      guideSeen: false,
      picture: { kind: 'character', id: 'you-chef' },
    });
    // The header's corner button shows her picture.
    expect(screen.getByTestId('profile-button-avatar', { includeHiddenElements: true }).props.source).toBe(YOU_AVATARS['you-chef']);

    // Episode 1: the guide, the whole line, then its gap with three options.
    await fireEvent.press(screen.getByTestId('home-continue'));
    expect(await screen.findByTestId('guide-listen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-skip'));
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();
    expect(screen.getByTestId('episode-progress')).toHaveTextContent(/^Line 1 of /);
    const answer = await storyAnswer(services);
    expect(services.speechOut.spokenTexts[0]).toContain(answer);
    expectAccessibleControls();

    // Said with the mic: feedback, checked by matching (the model is not loaded).
    await sayWithMic(services, answer);
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    expect(screen.getByTestId('feedback-answer')).toHaveTextContent(`You said: ${answer}`);
    expect(screen.getByTestId('feedback-story')).toHaveTextContent(`The story says: ${answer}`);
    expect(screen.getByTestId('feedback-checked')).toHaveTextContent('Checked by matching. The language model is still downloading.');
    const events = await eventually(
      () => storage.learner.eventsSince(),
      (e) => e.some((x) => x.event.type === 'cliff_answer'),
    );
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'cliff_answer', credit: 'full' })]));
    // Minutes spoken: the voiced answer is credited.
    expect(await eventually(() => storage.spokenTime.total(), (ms) => ms > 0)).toBeGreaterThan(0);
    expectAccessibleControls();

    // Next: line 2; close: the home says Continue.
    await fireEvent.press(screen.getByTestId('episode-next'));
    await waitFor(() => expect(screen.getByTestId('episode-progress')).toHaveTextContent(/^Line 2 of /));
    await fireEvent.press(screen.getByTestId('episode-close'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Continue: Episode 1 · /);
    expect(await storage.settings.get('guideSeen')).toBe(true);
  });
});

describe('settings reach the story', () => {
  it('another level and form of address in Settings reach the session', async () => {
    const services = install();
    const storage = await onboarded(services);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: '2' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'As a woman' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'As a woman' }).props.accessibilityState?.checked).toBe(true));
    expect(await storage.settings.getAll()).toMatchObject({ level: 2, address: 'f' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(await screen.findByTestId('close-profile'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('home-level')).toHaveTextContent('Level 2 · say the word in bold'));
    const rec = await eventually(
      () => storage.sessions.active<{ state: { library: { level: number; address: string } } }>('story'),
      (r) => r?.snapshot.state.library.level === 2,
    );
    expect(rec?.snapshot.state.library).toMatchObject({ level: 2, address: 'f' });
  });
});

describe('your picture', () => {
  it('a character, then a selfie, chosen in Settings show on the header button; Remove photo deletes the photo', async () => {
    const services = install();
    const storage = await onboarded(services);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    const header = () => screen.getByTestId('profile-button-avatar', { includeHiddenElements: true }).props.source as unknown;
    expect(header()).toBe(YOU_AVATARS.you);

    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-picture')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-picture-name')).toHaveTextContent('Smiling person waving hello');
    expect(screen.queryByTestId('settings-picture-remove')).toBeNull();
    expectAccessibleControls();

    // Change: the same chooser, in a sheet.
    await fireEvent.press(screen.getByTestId('settings-picture-change'));
    expect(await screen.findByTestId('settings-picture-chooser')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('picture-character-you-musician'));
    await waitFor(() => expect(screen.getByTestId('settings-picture-name')).toHaveTextContent('Older musician with a guitar'));
    // A selfie replaces it.
    await fireEvent.press(screen.getByTestId('picture-camera'));
    await waitFor(() => expect(screen.getByTestId('settings-picture-name')).toHaveTextContent('Your photo'));
    const [photo] = services.photos.stored();
    expect(await storage.settings.get('picture')).toEqual({ kind: 'photo', uri: photo });
    await fireEvent.press(screen.getByTestId('settings-picture-done'));
    await waitFor(() => expect(screen.queryByTestId('settings-picture-chooser')).toBeNull());

    // Back on the Story tab, the header shows the photo as a circle.
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(await screen.findByTestId('close-profile'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(header()).toEqual({ uri: photo });

    // Remove photo, from the Settings row: the default character again, and the file is gone.
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    await fireEvent.press(await screen.findByTestId('settings-picture-remove'));
    await waitFor(() => expect(screen.getByTestId('settings-picture-name')).toHaveTextContent('Smiling person waving hello'));
    expect(services.photos.stored()).toEqual([]);
    expect(services.photos.removed).toEqual([photo]);
    expect(await storage.settings.get('picture')).toEqual({ kind: 'character', id: 'you' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(await screen.findByTestId('close-profile'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(header()).toBe(YOU_AVATARS.you);
  });
});

// Music is off in this build (src/config/features.ts); these run again when it is back on.
const describeMusic = MUSIC_ENABLED ? describe : describe.skip;

describeMusic('the Music tab', () => {
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

describeMusic('settings reach the other tabs', () => {
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
  it('clears the progress and starts the experience again; onboarding is not shown again', async () => {
    const services = install();
    const storage = await onboarded(services);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('home-continue'));
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();

    // Some progress: answer the first line, move to the next one.
    await sayWithMic(services, await storyAnswer(services));
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('episode-next'));
    await waitFor(() => expect(screen.getByTestId('episode-progress')).toHaveTextContent(/^Line 2 of /));
    expect((await eventually(() => storage.learner.eventsSince(), (e) => e.length > 0)).length).toBeGreaterThan(0);
    const before = await storage.sessions.active('story');

    // Settings -> Reset progress -> confirm.
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Reset progress' }));
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));

    // The Story home again, episode 1 from its start, nothing learned.
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Start: Episode 1 · /);
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(await storage.learner.eventsSince()).toEqual([]);
    expect(await storage.spokenTime.total()).toBe(0);
    const after = await eventually(
      () => storage.sessions.active('story'),
      (x) => x !== null,
    );
    expect(after?.id).not.toBe(before?.id);
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, onboardingStep: 'done', trackId: livingTrack().id });
    // The old session wrote nothing back after the reset.
    expect((await storage.sessions.list({ kind: 'story' })).map((x) => x.id)).toEqual([after?.id]);
  });
});

describe('restart', () => {
  it('new services over the same storage come back to the home, then to the same screen', async () => {
    const clock = new FakeClock();
    let ids = 0;
    const inner = createStorageService('sql.js-memory', () => openMemoryStorage(storageClockFor(clock, () => `flow-${++ids}`)));
    // The database outlives the first app (closing it is the app's exit, not the data's end).
    shared = inner;
    const persistent: StorageService = { backend: inner.backend, open: () => inner.open(), close: async () => undefined };

    // First run: answer the first line and get the feedback.
    const first = install({ clock, storage: persistent });
    await onboarded(first);
    const app = await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('home-continue'));
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();
    const answer = await storyAnswer(first);
    await sayWithMic(first, answer);
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    const storage = await persistent.open();
    await eventually(
      () => storage.sessions.active<{ state: { screen?: { kind?: string } } }>('story'),
      (x) => x?.snapshot.state.screen?.kind === 'landing',
    );
    await app.unmount();
    setAppServices(undefined);

    // Second run: new services over the same storage. The home first, playing nothing.
    clock.advance(3_600_000);
    const second = install({ clock, storage: persistent });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(second.speechOut.spokenTexts).toEqual([]);
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    // Continue: the same feedback, where the learner left it.
    await fireEvent.press(screen.getByTestId('home-continue'));
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    expect(screen.getByTestId('feedback-story')).toHaveTextContent(`The story says: ${answer}`);
    expectAccessibleControls();
  });
});
