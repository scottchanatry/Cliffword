/**
 * Onboarding end to end through the real router and root layout (OUTLINE 5.3): welcome, model,
 * voice, slang, done; brand new and placement; a declined or failed download; a refused
 * microphone with typed practice; and a relaunch that resumes at the stored step.
 */
import path from 'path';
import { Linking, StyleSheet } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { FakeModelManager } from '../../src/adapters/model/FakeModelManager';
import { FakeSpeechIn } from '../../src/adapters/speechIn/FakeSpeechIn';
import { PRIVACY_URL } from '../../src/config/links';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices } from '../../src/services/testServices';
import type { Services } from '../../src/services/types';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');

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

const activate = async (testID: string) => {
  await fireEvent(screen.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
};

describe('onboarding', () => {
  it('brand new: download in the background, permission, voice and practice, slang, then the story', async () => {
    const services = install(
      createTestServices({
        modelManager: new FakeModelManager({ initial: 'absent', mode: 'manual', freeBytes: 23_400_000_000 }),
        speechIn: new FakeSpeechIn({ permission: 'undetermined' }),
      }),
    );
    await renderRouter(APP_DIR, { initialUrl: '/' });

    // Welcome
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen.getByText('Learn Spanish by saying what comes next.')).toBeOnTheScreen();
    expect(screen.getByTestId('welcome-sample')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'I’m brand new' }));

    // Model: size, free space, the Wi-Fi note; start, then continue while it downloads
    expect(await screen.findByTestId('onboarding-model')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding/model');
    expect(screen.getByTestId('model-size')).toHaveTextContent('1.1 GB');
    expect(screen.getByTestId('model-free-space')).toHaveTextContent('23.4 GB free on this phone');
    expect(screen.getByTestId('model-wifi-note')).toHaveTextContent(/Wi-Fi/);
    expectAccessibleControls();
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({ startLevel: 'brandNew', onboardingStep: 'model', onboarded: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Download (1.1 GB)' }));
    await act(async () => services.modelManager.progressTo(services.modelManager.descriptor.bytes / 2));
    expect(await screen.findByText('Downloading… 50%')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue while it downloads' }));

    // Voice: the permission card with its reasons, then allowed
    expect(await screen.findByTestId('onboarding-voice')).toBeOnTheScreen();
    expect(await screen.findByText('Cliffword listens only while you hold to speak.')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Ready. Speech is recognized on this phone, offline.')).toBeOnTheScreen();
    expect(services.speechIn.permission).toBe('granted');

    // The voice: pick one and play the sample (the starter story's first sentence)
    await fireEvent.press(await screen.findByRole('radio', { name: 'Marisol' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Marisol' }).props.accessibilityState?.checked).toBe(true));
    expect(await storage.settings.get('voiceId')).toBe('fake.es-PR');
    await fireEvent.press(screen.getByRole('button', { name: 'Play a sample' }));
    await waitFor(() => expect(services.speechOut.lastCall).toMatchObject({ text: 'Marta es una artista.', voice: 'fake.es-PR', lang: 'es-PR' }));

    // Practice: hold (the screen-reader toggle), say "otra vez", let go
    await activate('practice-hold');
    await waitFor(() => expect(screen.getByTestId('practice-hold').props.accessibilityLabel).toBe('Stop listening'));
    expect(services.speechIn.isListening).toBe(true);
    services.speechIn.queueUtterance('otra vez');
    await activate('practice-hold');
    expect(await screen.findByText('Heard “otra vez”: again.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Otra vez, again. Done' })).toBeOnTheScreen();
    expect(screen.getByTestId('practice-count')).toHaveTextContent('1 of 6 tried');
    // A tap on a command plays it.
    await fireEvent.press(screen.getByRole('button', { name: 'Más despacio, slower' }));
    await waitFor(() => expect(services.speechOut.lastCall?.text).toMatch(/despacio/i));
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('voice-continue'));

    // Slang: Puerto Rico preselected, explicit on with its note; street, plus Cuba
    expect(await screen.findByTestId('onboarding-slang')).toBeOnTheScreen();
    expect(screen.getByRole('togglebutton', { name: 'Puerto Rico' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByTestId('explicit-hint')).toHaveTextContent('On: nothing is skipped');
    expect(screen.getByTestId('explicit-note')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('radio', { name: 'Street · with friends' }));
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Cuba' }));
    await waitFor(() => expect(screen.getByRole('togglebutton', { name: 'Cuba' }).props.accessibilityState?.checked).toBe(true));
    expect(await storage.settings.get('regions')).toEqual(['PR', 'CARIB', 'CU']);
    await fireEvent.press(screen.getByRole('button', { name: 'Start the story' }));

    // Done: the guard opens the Story tab; the download goes on
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(await storage.settings.getAll()).toMatchObject({
      onboarded: true,
      onboardingStep: 'done',
      startLevel: 'brandNew',
      register: 'street',
      showExplicit: true,
      voiceId: 'fake.es-PR',
      modelDeclined: false,
    });
    expect(services.modelManager.status()).toBe('downloading');
  });

  it('placement: "Start the first story" with the model already there', async () => {
    const services = install(createTestServices());
    await renderRouter(APP_DIR, { initialUrl: '/onboarding' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Start the first story' }));
    expect(await screen.findByText('Ready. Stories and corrections use it.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('model-continue'));
    await fireEvent.press(await screen.findByTestId('voice-continue'));
    await fireEvent.press(await screen.findByTestId('onboarding-finish'));
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, startLevel: 'placement', modelDeclined: false });
  });

  it('the welcome footer links the privacy policy, and a link no browser takes changes nothing', async () => {
    install(createTestServices());
    const open = jest.mocked(Linking.openURL);
    open.mockClear();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding' });
    await fireEvent.press(await screen.findByRole('link', { name: 'Privacy policy' }));
    expect(open).toHaveBeenCalledWith(PRIVACY_URL);
    open.mockRejectedValueOnce(new Error('no browser'));
    await fireEvent.press(screen.getByRole('link', { name: 'Privacy policy' }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding');
  });

  it('"Not now" declines the download; the story runs and Settings offers the download', async () => {
    const services = install(createTestServices({ modelManager: new FakeModelManager({ initial: 'absent', mode: 'manual' }) }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'I’m brand new' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    await fireEvent.press(await screen.findByTestId('voice-continue'));
    await fireEvent.press(await screen.findByTestId('onboarding-finish'));
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    const storage = await services.storage.open();
    expect(await storage.settings.get('modelDeclined')).toBe(true);
    expect(services.modelManager.downloadsStarted).toBe(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Open profile and settings' }));
    await fireEvent.press(await screen.findByRole('link', { name: 'Settings' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Download (1.1 GB)' }));
    expect(services.modelManager.downloadsStarted).toBe(1);
    expect(await screen.findByRole('button', { name: 'Pause download' })).toBeOnTheScreen();
    expect(await storage.settings.get('modelDeclined')).toBe(false);
  });

  it('a download that runs out of space says so and still moves on', async () => {
    const services = install(createTestServices({ modelManager: new FakeModelManager({ initial: 'absent', mode: 'manual' }) }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'I’m brand new' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Download (1.1 GB)' }));
    await act(async () => services.modelManager.fail('insufficient-storage'));
    expect(await screen.findByText(/Not enough free space/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue without it' }));
    expect(await screen.findByTestId('onboarding-voice')).toBeOnTheScreen();
    expect(await (await services.storage.open()).settings.get('modelDeclined')).toBe(true);
  });

  it('a refused microphone offers Settings, and practice takes typed commands', async () => {
    const services = install(createTestServices({ speechIn: new FakeSpeechIn({ permission: 'undetermined', requestResult: 'denied' }) }));
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'I’m brand new' }));
    await fireEvent.press(await screen.findByTestId('model-continue'));
    expect(await screen.findByTestId('onboarding-voice')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Allow' }));
    expect(services.speechIn.permission).toBe('denied');
    expect(await screen.findByTestId('speech-status')).toHaveTextContent(/Turn it on in Settings, or type instead/);
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeOnTheScreen();
    expect(screen.queryByTestId('practice-hold')).toBeNull();
    expectAccessibleControls();

    await fireEvent.press(screen.getByTestId('practice-type'));
    await fireEvent.changeText(await screen.findByPlaceholderText('What comes next?'), 'no sé');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Heard “no sé”: skip.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'No sé, skip. Done' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('voice-continue'));
    expect(await screen.findByTestId('onboarding-slang')).toBeOnTheScreen();
  });

  it('a relaunch resumes at the stored step, and Back leads to the step before', async () => {
    const services = install(createTestServices());
    const storage = await services.storage.open();
    await storage.settings.update({ onboardingStep: 'voice', startLevel: 'placement' });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('onboarding-voice')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding/voice');
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('onboarding-model')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding/model');
  });

  it('never resumes past a finished onboarding: the story opens', async () => {
    const services = install(createTestServices());
    await (await services.storage.open()).settings.update({ onboarded: true, onboardingStep: 'done' });
    await renderRouter(APP_DIR, { initialUrl: '/onboarding/voice' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
  });
});
