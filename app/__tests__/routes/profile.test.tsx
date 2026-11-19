/**
 * Profile, settings, licenses and the self-test through the real router and root layout: the
 * numbers from stored minutes and the learner, settings written and seen by the other tabs, the
 * model card, Apple Music, deleting lyrics and texts, reset progress (the story starts again,
 * onboarding is not shown), and named 44 dp controls on every screen.
 */
import path from 'path';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { estimateVocabulary, frequencyLexemeKeys } from '@cliffword/engine';
import { FakeMusicPlayer } from '../../src/adapters/music/FakeMusicPlayer';
import { MUSIC_ENABLED } from '../../src/config/features';
import { CONTACT_EMAIL, PRIVACY_URL, SUPPORT_URL } from '../../src/config/links';
import { learnerPrior } from '../../src/learner/prior';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices } from '../../src/services/testServices';
import type { Services } from '../../src/services/types';
import { ONBOARDED } from '../../src/storage/repos/settings';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { livingTrack } from '../../src/testing/packs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');
const DAY = 86_400_000;

let current: Services | null = null;

beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

afterEach(async () => {
  setAppServices(undefined);
  await current?.storage.close();
  current = null;
});

function install<S extends Services>(services: S): S {
  current = services;
  setAppServices(services);
  return services;
}

/** Storage as a returning learner left it. */
async function onboarded(services: Services) {
  const storage = await services.storage.open();
  await storage.settings.update({ ...ONBOARDED, startLevel: 'brandNew', trackId: livingTrack().id });
  return storage;
}

function expectAccessibleControls() {
  const roles = ['button', 'togglebutton', 'link', 'radio', 'switch'] as const;
  const controls = roles.flatMap((role) => screen.queryAllByRole(role));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    if (String(control.props.testID ?? '').startsWith('tab-')) continue;
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({
      testID: control.props.testID,
      named: true,
    });
    const style = StyleSheet.flatten(control.props.style) ?? {};
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, name, height: height >= layout.minTouch }).toEqual({ testID: control.props.testID, name, height: true });
  }
}

const checked = (role: 'switch' | 'radio' | 'togglebutton', name: string) => screen.getByRole(role, { name }).props.accessibilityState?.checked;

/** From the Story tab through the corner button, as a learner gets there. */
async function openSettings() {
  await renderRouter(APP_DIR, { initialUrl: '/' });
  await fireEvent.press(await screen.findByRole('button', { name: 'Open profile and settings' }));
  await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
  expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
}

describe('profile', () => {
  it('shows minutes spoken today, this week and in total, the streak, words and the skill mix', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    const now = services.clock.now();
    await storage.spokenTime.addUtterance(125_000, now);
    await storage.spokenTime.addUtterance(60_000, now - DAY);
    await storage.spokenTime.addUtterance(30_000, now - 3 * DAY);
    await storage.spokenTime.addUtterance(600_000, now - 10 * DAY);

    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Open profile and settings' }));
    expect(await screen.findByTestId('profile-screen')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByTestId('minutes-total')).toHaveTextContent('13:35'));
    expect(screen.getByTestId('minutes-today')).toHaveTextContent('2:05');
    expect(screen.getByTestId('minutes-week')).toHaveTextContent('3:35');
    expect(screen.getByTestId('streak')).toHaveTextContent('2 days');
    // Minutes spoken is the first heading.
    expect(screen.getAllByRole('header')[1]).toHaveTextContent('Minutes spoken');
    // Seven bars; the week is announced as one element.
    expect(screen.getByTestId('week-bars').props.accessibilityLabel).toMatch(/^Minutes spoken in the last seven days: .*2:05$/);

    const { learner } = await storage.learner.loadLearner({ prior: learnerPrior(services.packs, 'brandNew', null) });
    const words = Math.round(estimateVocabulary(learner, services.clock.now(), frequencyLexemeKeys(services.packs.lang)));
    expect(screen.getByTestId('words-known')).toHaveTextContent(String(words));
    expect(screen.getByTestId('skill-meaning').props.accessibilityLabel).toBe(`Understand: ${words} words`);
    expect(screen.getByTestId('skill-speaking')).toBeOnTheScreen();
    expectAccessibleControls();
  });
});

// Music is off in this build (src/config/features.ts); its rows come back with it.
const itMusic = MUSIC_ENABLED ? it : it.skip;

describe('settings', () => {
  it('stores the story rows: another experience refused while coming soon, the address, the level', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    await openSettings();
    expectAccessibleControls();
    expect(screen.getByTestId('settings-experience-title')).toHaveTextContent('Living in San Juan');
    await fireEvent.press(screen.getByRole('radio', { name: 'As a woman' }));
    await fireEvent.press(screen.getByRole('radio', { name: '4' }));
    await waitFor(() => expect(checked('radio', '4')).toBe(true));
    expect(screen.getByText(/^Level 4: say what comes next/)).toBeOnTheScreen();
    expect(await storage.settings.getAll()).toMatchObject({ address: 'f', level: 4 });
    // Change: the picker, with the experiences not written yet closed.
    await fireEvent.press(screen.getByTestId('settings-experience-change'));
    expect(await screen.findByTestId('experience-picker')).toBeOnTheScreen();
    expect(screen.getByTestId('experience-en-es.track.food')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('picker-close'));
    expect(screen.queryByTestId('experience-picker')).toBeNull();
    // Music is off: no explicit lyrics, Apple Music or lyrics rows.
    expect(screen.queryByTestId('settings-explicit')).toBeNull();
    expect(screen.queryByTestId('settings-apple-music')).toBeNull();
    expect(screen.queryByTestId('settings-delete-content')).toBeNull();
  });

  itMusic('stores each change, and the Music tab sees explicit lyrics off and the regions', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    await openSettings();
    expectAccessibleControls();

    await fireEvent.press(screen.getByRole('switch', { name: 'Explicit lyrics' }));
    await waitFor(() => expect(checked('switch', 'Explicit lyrics')).toBe(false));
    expect(screen.getByTestId('settings-explicit')).toHaveTextContent(/Off: explicit lines are skipped/);
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Dominican Republic' }));
    await waitFor(() => expect(checked('togglebutton', 'Dominican Republic')).toBe(true));
    await fireEvent.press(screen.getByRole('radio', { name: 'Always hidden' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Faster' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Street' }));
    await fireEvent.press(screen.getByRole('switch', { name: 'Answers in English' }));
    await fireEvent.press(screen.getByRole('switch', { name: 'On-device recognition only' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Paulina' }));
    await waitFor(() => expect(checked('radio', 'Paulina')).toBe(true));
    expect(screen.getByTestId('rate-stepper-value')).toHaveTextContent('110%');
    expect(await storage.settings.getAll()).toMatchObject({
      showExplicit: false,
      regions: ['PR', 'CARIB', 'DO'],
      textMode: 'tiles',
      speechRateBias: 0.1,
      register: 'street',
      nativeAnswersAllowed: false,
      allowNetworkRecognition: true,
      voiceId: 'fake.es-MX',
    });

    await fireEvent.press(screen.getByTestId('settings-back'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    await fireEvent.press(await screen.findByTestId('tab-music'));
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('explicit-hint')).toHaveTextContent('Off: explicit lines are skipped');
    expect(checked('togglebutton', 'Dominican Republic')).toBe(true);
  });

  it('shows the stored values when it opens', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    await storage.settings.update({ textMode: 'text', speechRateBias: -0.3, register: 'street', regions: ['CU'], voiceId: 'fake.es-ES.enhanced' });
    await openSettings();
    expect(checked('radio', 'Always shown')).toBe(true);
    expect(checked('radio', 'Street')).toBe(true);
    expect(checked('togglebutton', 'Cuba')).toBe(true);
    expect(checked('togglebutton', 'Puerto Rico')).toBe(false);
    expect(checked('radio', 'Lucía')).toBe(true);
    expect(checked('switch', 'On-device recognition only')).toBe(true);
    expect(screen.getByTestId('rate-stepper-value')).toHaveTextContent('70%');
  });

  it('deletes the model after a confirmation, then downloads it again', async () => {
    const services = install(createTestServices());
    await onboarded(services);
    await openSettings();
    expect(screen.getByTestId('model-status-line')).toHaveTextContent('Ready. Stories and corrections use it.');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete the model' }));
    expect(await screen.findByText('Delete the language model?')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('confirm-sheet-cancel'));
    expect(services.modelManager.status()).toBe('ready');

    await fireEvent.press(screen.getByRole('button', { name: 'Delete the model' }));
    await fireEvent.press(await screen.findByTestId('confirm-sheet-confirm'));
    await waitFor(() => expect(services.modelManager.status()).toBe('absent'));
    expect(await screen.findByText('The model was deleted. Download it again to use it.')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Download again' }));
    expect(services.modelManager.downloadsStarted).toBe(1);
    await waitFor(() => expect(services.modelManager.status()).toBe('ready'));
  });

  itMusic('connects Apple Music from its row', async () => {
    const services = install(createTestServices({ music: new FakeMusicPlayer({ authorization: 'notDetermined' }) }));
    await onboarded(services);
    await openSettings();
    expect(await screen.findByTestId('settings-apple-music-hint')).toHaveTextContent('Play songs from your library');
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByTestId('settings-apple-music-hint')).toHaveTextContent('Connected · your library plays here'));
    expect(services.music.authorization).toBe('authorized');
  });

  itMusic('deletes every lyric and text, keeping the songs and the story', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    const song = await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce', artist: 'Rayo K.' });
    await storage.lyrics.put(song.id, 'Esta noche salgo con el corillo', {});
    const text = await storage.texts.add({ title: 'Una nota', rawText: 'Marta llegó tarde al mercado.' });
    await storage.sessions.save({ id: `lyric:${song.id}`, kind: 'lyric', version: 1, snapshot: {}, active: false });
    await storage.sessions.save({ id: `text:${text.id}`, kind: 'lyric', version: 1, snapshot: {}, active: false });
    await storage.sessions.save({ id: 'story-1', kind: 'story', version: 1, snapshot: {}, active: false });

    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all lyrics and texts' }));
    expect(await screen.findByText('Delete all lyrics and texts?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-sheet-confirm'));
    expect(await screen.findByText('All lyrics and texts were deleted.')).toBeOnTheScreen();
    expect(await storage.lyrics.get(song.id)).toBeNull();
    expect(await storage.texts.list()).toEqual([]);
    expect(await storage.songs.get(song.id)).not.toBeNull();
    const left = await storage.sessions.list();
    expect(left.filter((s) => s.kind === 'lyric')).toEqual([]);
    expect(left.map((s) => s.id)).toContain('story-1');
  });

  it('resets progress: learner, sessions, stories and minutes go; settings, songs and the model stay; the story starts again', async () => {
    const services = install(createTestServices());
    const storage = await onboarded(services);
    await storage.settings.update({ register: 'street', regions: ['CU'] });
    const at = services.clock.now();
    const { learner } = await storage.learner.loadLearner({ prior: learnerPrior(services.packs, 'brandNew', null) });
    await storage.learner.record(learner, [{ type: 'marked_known', key: 'es:mercado', at }]);
    await storage.learner.saveSnapshot(learner, at);
    await storage.spokenTime.addUtterance(90_000, at);
    const story = await storage.stories.create({ title: 'El mercado' });
    await storage.stories.putSentence(story.id, 0, 'Marta llegó tarde al mercado.', {});
    const song = await storage.songs.upsert({ source: 'manual', title: 'Luna de Santurce' });
    await storage.modelFiles.upsert({ id: 'qwen3-1.7b-q4_k_m', path: '/models/q.gguf', status: 'ready' });

    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Reset progress' }));
    expect(await screen.findByText('Reset your progress?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-sheet-confirm'));

    // Back on the Story tab (no onboarding), where the experience starts again.
    await waitFor(() => expect(screen).toHavePathname('/'));
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Start: Episode 1 · /);

    expect(await storage.learner.eventsForKey('es:mercado')).toEqual([]);
    expect(await storage.spokenTime.total()).toBe(0);
    expect(await storage.stories.get(story.id)).toBeNull();
    expect(await storage.songs.get(song.id)).not.toBeNull();
    expect(await storage.modelFiles.get('qwen3-1.7b-q4_k_m')).not.toBeNull();
    expect(await storage.settings.getAll()).toMatchObject({
      onboarded: true,
      onboardingStep: 'done',
      register: 'street',
      regions: ['CU'],
      startLevel: 'brandNew',
    });
  });

  it('lists the licenses with their full texts', async () => {
    const services = install(createTestServices());
    await onboarded(services);
    await openSettings();
    await fireEvent.press(screen.getByRole('link', { name: 'Licenses' }));
    expect(await screen.findByTestId('licenses-screen')).toBeOnTheScreen();
    expect(screen.getByText('Qwen3-1.7B')).toBeOnTheScreen();
    expect(within(screen.getByTestId('license-qwen3')).getByText('Apache License 2.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('license-llama.cpp')).getByText('MIT License')).toBeOnTheScreen();
    expect(within(screen.getByTestId('license-newsreader')).getByText('SIL Open Font License 1.1')).toBeOnTheScreen();
    expect(screen.getByText('sql.js')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Read the Apache License 2.0 of Qwen3-1.7B' }));
    expect(screen.getByTestId('license-qwen3-text')).toHaveTextContent(/TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  });

  it('About opens the privacy policy, support and a mail to the contact address; one no app opens says where it is', async () => {
    const services = install(createTestServices());
    await onboarded(services);
    const open = jest.mocked(Linking.openURL);
    open.mockClear();
    await openSettings();
    await fireEvent.press(screen.getByRole('link', { name: 'Privacy policy, opens in another app' }));
    expect(open).toHaveBeenLastCalledWith(PRIVACY_URL);
    await fireEvent.press(screen.getByRole('link', { name: 'Support, opens in another app' }));
    expect(open).toHaveBeenLastCalledWith(SUPPORT_URL);
    expect(screen.getByTestId('settings-contact')).toHaveTextContent(new RegExp(`Email ${CONTACT_EMAIL}`));
    await fireEvent.press(screen.getByRole('link', { name: 'Contact, opens in another app' }));
    expect(open).toHaveBeenLastCalledWith(`mailto:${CONTACT_EMAIL}`);
    expect(screen.queryByTestId('settings-link-notice')).toBeNull();

    open.mockRejectedValueOnce(new Error('no mail app'));
    await fireEvent.press(screen.getByRole('link', { name: 'Contact, opens in another app' }));
    expect(await screen.findByTestId('settings-link-notice')).toHaveTextContent(`No email app opened. You can write to ${CONTACT_EMAIL}`);
    open.mockRejectedValueOnce(new Error('no browser'));
    await fireEvent.press(screen.getByRole('link', { name: 'Support, opens in another app' }));
    await waitFor(() => expect(screen.getByTestId('settings-link-notice')).toHaveTextContent(`That page could not be opened. It is at ${SUPPORT_URL}`));
    expectAccessibleControls();
  });

  it('opens the hidden self-test after seven taps on the version, and runs it on the mock model', async () => {
    const services = install(createTestServices());
    await onboarded(services);
    await openSettings();
    for (let i = 0; i < 6; i++) await fireEvent.press(screen.getByTestId('settings-version'));
    expect(screen.queryByTestId('selftest-screen')).toBeNull();
    await fireEvent.press(screen.getByTestId('settings-version'));
    expect(await screen.findByTestId('selftest-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/profile/selftest');
    expect(screen.getByTestId('selftest-backend')).toHaveTextContent('Mock model (no real scores)');
    expect(screen.getByTestId('selftest-scoring')).toHaveTextContent('Exact');
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Run the self-test' }));
    expect(await screen.findByTestId('selftest-verdict-title')).toHaveTextContent('Mock model: the proof values do not apply. Totals and timings only.');
    expect(screen.getByTestId('selftest-pair-pairs#1')).toHaveTextContent(/Mi hermano está enfermo hoy\./);
  });
});

describe('gallery', () => {
  it.each(['onboarding-welcome', 'onboarding-mic', 'profile', 'settings', 'selftest'])('/preview/%s renders the fixture', async (name) => {
    install(createTestServices());
    await renderRouter(APP_DIR, { initialUrl: `/preview/${name}` });
    expect(await screen.findByTestId('account-preview')).toBeOnTheScreen();
  });
});
