/**
 * Onboarding end to end through the real router and root layout: welcome, the experience picker
 * (coming-soon cards closed), "How much Spanish do you know?", "How should people address you?",
 * an experience's choices (the mechanism, on a test pair where Dating has an episode), the
 * microphone (allowed, refused, typed), then the Story home; the language model downloading by
 * itself on Wi-Fi; a relaunch resuming at the stored step; and a learner onboarded by the earlier
 * build going through the new onboarding once.
 */
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { LibraryStory, PairPack } from '@cliffword/engine';
import { FakeModelManager } from '../../src/adapters/model/FakeModelManager';
import { FixedNetworkInfo } from '../../src/adapters/network/FixedNetworkInfo';
import { FakeSpeechIn } from '../../src/adapters/speechIn/FakeSpeechIn';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices } from '../../src/services/testServices';
import type { Services } from '../../src/services/types';
import { ONBOARDING_VERSION } from '../../src/storage/repos/settings';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { libraryPacks, livingTrack } from '../../src/testing/packs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');
const DATING = 'en-es.track.dating';

let current: Services | null = null;

// Each test walks the whole onboarding through the real router and storage.
jest.setTimeout(30_000);

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

/** Every control has a name and a 44 dp target (buttons, toggles, links, radios and switches). */
function expectAccessibleControls() {
  const roles = ['button', 'togglebutton', 'link', 'radio', 'switch'] as const;
  const controls = roles.flatMap((role) => screen.queryAllByRole(role));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
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

/** The en-es pair where Dating has episodes too (Living's, moved), to try the choices step. */
function datingPair(): PairPack {
  const { pair } = libraryPacks();
  const living = (pair.library ?? []).filter((s) => s.track === livingTrack().id);
  const dating: LibraryStory[] = living.map((s) => ({ ...s, id: s.id.replace('living', 'dating-test'), track: DATING }));
  return { ...pair, library: [...(pair.library ?? []), ...dating] };
}

async function welcomeToPicker() {
  expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
  expect(screen.getByText('Learn Spanish with short, funny stories.')).toBeOnTheScreen();
  expect(screen.getByTestId('welcome-steps')).toBeOnTheScreen();
  expect(screen.getByTestId('welcome-gap', { includeHiddenElements: true })).toBeOnTheScreen();
  expectAccessibleControls();
  await fireEvent.press(screen.getByTestId('onboarding-start'));
  expect(await screen.findByTestId('onboarding-experience')).toBeOnTheScreen();
}

describe('onboarding', () => {
  it('brand new, as a woman, microphone allowed: the Story home of San Juan, and the model downloads on Wi-Fi', async () => {
    const network = new FixedNetworkInfo('cellular');
    const modelManager = new FakeModelManager({ initial: 'absent', mode: 'manual' });
    const services = install(createTestServices({ packs: libraryPacks(), modelManager, network, speechIn: new FakeSpeechIn({ permission: 'undetermined' }) }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await welcomeToPicker();

    // The picker: six experiences, five coming soon (shown, closed).
    expect(screen.getAllByText('Coming soon')).toHaveLength(5);
    expect(screen.getByTestId(`experience-${DATING}`)).toBeDisabled();
    expect(screen.getByText('Living in San Juan')).toBeOnTheScreen();
    expect(screen.getByText('Dating in Buenos Aires')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId(`experience-${livingTrack().id}`));

    expect(await screen.findByTestId('onboarding-level')).toBeOnTheScreen();
    expect(screen.getByText('How much Spanish do you know?')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('level-new'));

    expect(await screen.findByTestId('onboarding-address')).toBeOnTheScreen();
    expect(screen.getByText(/some words change with gender/)).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('address-f'));

    // San Juan has no choices: the microphone is next.
    expect(await screen.findByTestId('onboarding-mic')).toBeOnTheScreen();
    expect(screen.getByText(/any natural answer counts/)).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('mic-allow'));

    // Allowed: onboarding ends by itself on the Story home.
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Start: Episode 1 · /);
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({
      onboarded: true,
      onboardingStep: 'done',
      onboardingVersion: ONBOARDING_VERSION,
      trackId: livingTrack().id,
      level: 0,
      startLevel: 'brandNew',
      address: 'f',
    });
    // The session plays San Juan for a woman at level 0 (stored before the home shows).
    const rec = await storage.sessions.active<{ state: { library: { track: string; level: number; address: string } } }>('story');
    expect(rec?.snapshot.state.library).toMatchObject({ track: livingTrack().id, level: 0, address: 'f' });
    // On mobile data nothing downloads; on Wi-Fi it starts by itself.
    expect(modelManager.downloadsStarted).toBe(0);
    network.set('wifi');
    await waitFor(() => expect(modelManager.downloadsStarted).toBe(1));
  });

  it('comfortable, microphone refused: Settings or typing, then the home at level 4', async () => {
    const services = install(createTestServices({ packs: libraryPacks(), speechIn: new FakeSpeechIn({ permission: 'undetermined', requestResult: 'denied' }) }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await welcomeToPicker();
    await fireEvent.press(screen.getByTestId(`experience-${livingTrack().id}`));
    await fireEvent.press(await screen.findByTestId('level-comfortable'));
    await fireEvent.press(await screen.findByTestId('address-m'));
    expect(await screen.findByTestId('onboarding-mic')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('mic-allow'));
    expect(await screen.findByTestId('mic-settings')).toBeOnTheScreen();
    expect(screen.getByTestId('mic-status')).toHaveTextContent(/off for Cliffword/);
    await fireEvent.press(screen.getByTestId('mic-type'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-level')).toHaveTextContent('Level 4 · say what comes next');
    expect(await (await services.storage.open()).settings.getAll()).toMatchObject({ level: 4, startLevel: 'placement', address: 'm' });
  });

  it('asks an experience its choices, and the choice reaches the session (Dating, on a test pair)', async () => {
    const services = install(createTestServices({ packs: { lang: libraryPacks().lang, pair: datingPair() } }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await welcomeToPicker();
    await fireEvent.press(screen.getByTestId(`experience-${DATING}`));
    await fireEvent.press(await screen.findByTestId('level-little'));
    await fireEvent.press(await screen.findByTestId('address-m'));
    expect(await screen.findByTestId('onboarding-choices')).toBeOnTheScreen();
    expect(screen.getByText('Who do you match with?')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-step')).toHaveTextContent('Step 5 of 6');
    expect(screen.getByTestId('choices-continue')).toBeDisabled();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('choice-partner-valentina'));
    await fireEvent.press(screen.getByTestId('choices-continue'));
    expect(await screen.findByTestId('onboarding-mic')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('mic-finish'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    const storage = await services.storage.open();
    expect((await storage.settings.getAll()).trackChoices).toEqual({ [DATING]: { partner: 'valentina' } });
    const rec = await storage.sessions.active<{ state: { library: { track: string; tracks: Record<string, { choices: Record<string, string> }> } } }>('story');
    expect(rec?.snapshot.state.library.track).toBe(DATING);
    expect(rec?.snapshot.state.library.tracks[DATING]?.choices).toEqual({ partner: 'valentina' });
  });

  it('goes back a step, and a relaunch resumes at the stored step', async () => {
    const services = install(createTestServices({ packs: libraryPacks() }));
    const storage = await services.storage.open();
    await storage.settings.update({ onboardingStep: 'address', trackId: livingTrack().id });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('onboarding-address')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(await screen.findByTestId('onboarding-level')).toBeOnTheScreen();
  });

  it('shows a learner onboarded by the earlier build the new onboarding once', async () => {
    const services = install(createTestServices({ packs: libraryPacks() }));
    const storage = await services.storage.open();
    await storage.settings.update({ onboarded: true, onboardingStep: 'done', startLevel: 'placement' });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-screen')).toBeNull();
  });
});
