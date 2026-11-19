/**
 * Every route renders through the real expo-router tree (app/app) and the real root layout:
 * AppProviders, AppBootstrap (storage opened, settings read, learner restored) and the
 * onboarding guard. Each test gets fresh test services, so storage starts empty.
 */
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { layout } from '../../src/theme';
import { sharedMockModel, defaultPacks } from '../../src/services/defaults';
import { setAppServices } from '../../src/services/appServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { ONBOARDED } from '../../src/storage/repos/settings';
import { livingTrack } from '../../src/testing/packs';

const APP_DIR = path.resolve(__dirname, '../../app');

let services: TestServices;

// Load the shared, immutable parts once (sql.js WebAssembly, packs, trained mock model), so the
// first test's startup is not slower than findBy's timeout.
beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

beforeEach(() => {
  services = createTestServices();
  setAppServices(services);
});

afterEach(async () => {
  setAppServices(undefined);
  await services.storage.close();
});

/**
 * Every control on screen has a name for screen readers and a touch target of at least 44 dp
 * (tab bar buttons fill the tab bar, whose height is checked instead).
 */
function expectAccessibleControls() {
  const controls = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('togglebutton'), ...screen.queryAllByRole('link')];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const name: unknown = control.props.accessibilityLabel ?? within(control).queryAllByText(/\S/)[0]?.props.children;
    expect({ testID: control.props.testID, named: typeof name === 'string' && name.trim().length > 0 }).toEqual({
      testID: control.props.testID,
      named: true,
    });
    if (String(control.props.testID ?? '').startsWith('tab-')) continue;
    const style = StyleSheet.flatten(control.props.style) ?? {};
    const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
    expect({ testID: control.props.testID, name, height: height >= layout.minTouch }).toEqual({
      testID: control.props.testID,
      name,
      height: true,
    });
  }
}

/** Storage as a returning learner left it: onboarded into Living in San Juan. */
async function onboarded() {
  const storage = await services.storage.open();
  await storage.settings.update({ ...ONBOARDED, startLevel: 'brandNew', trackId: livingTrack().id });
  return storage;
}

describe('first run', () => {
  it('shows a loading state, then sends a new learner to onboarding from any route', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/profile/settings' });
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding');
    expect(screen.getByText('Learn Spanish with short, funny stories.')).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-screen')).toBeNull();
    expectAccessibleControls();
  });

  it('goes from the welcome to the experience picker (the rest: onboarding.test.tsx)', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    expect(await screen.findByTestId('onboarding-experience')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding/experience');
    const storage = await services.storage.open();
    expect(await storage.settings.get('onboardingStep')).toBe('experience');
    expect(await storage.settings.get('onboarded')).toBe(false);
  });

  it('shows the startup error with Try again, and starts once storage opens', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const realOpen = services.storage.open;
    let failures = 1;
    jest.spyOn(services.storage, 'open').mockImplementation(() =>
      failures-- > 0 ? Promise.reject(new Error('disk full')) : realOpen(),
    );
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('boot-error')).toBeOnTheScreen();
    expect(screen.getByText('Cliffword could not start')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith('[bootstrap] startup failed', expect.any(Error));
    warn.mockRestore();
  });
});

describe('returning learner', () => {
  it('opens on the Story home with the header and no tab bar; Continue opens the first line, close goes back', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(screen.getByText('Cliffword')).toBeOnTheScreen();
    expect(screen.getByTestId('home-title')).toHaveTextContent('Living in San Juan');
    // Music is off: the Story tab is the only one, so there is no tab bar.
    expect(screen.queryByTestId('tab-music')).toBeNull();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('home-continue'));
    expect(await screen.findByTestId('episode-screen')).toBeOnTheScreen();
    // Recall: the line played (the fake voice finishes at once), then the gap with three options.
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();
    expect(screen.getByTestId('mic-button')).toBeOnTheScreen();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('episode-close'));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.getByTestId('home-continue').props.accessibilityLabel).toMatch(/^Continue: Episode 1 · /);
  });

  it('never shows onboarding again', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  });

  it.each(['/music', '/music/paste', '/text/paste'])('keeps Music out: %s goes to the Story tab', async (url) => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: url });
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(screen.queryByTestId('music-screen')).toBeNull();
    expect(screen).toHavePathname('/');
  });

  it('opens profile and settings from the corner button, with stored values, and closes it', async () => {
    const storage = await onboarded();
    await storage.spokenTime.addUtterance(125_000, services.clock.now());
    await storage.settings.update({ level: 3, address: 'f' });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Open profile and settings' }));
    expect(await screen.findByTestId('profile-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/profile');
    await waitFor(() => expect(screen.getByTestId('minutes-total')).toHaveTextContent('2:05'));
    expectAccessibleControls();
    await fireEvent.press(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/profile/settings');
    expect(screen.getByTestId('settings-experience-title')).toHaveTextContent('Living in San Juan');
    expect(screen.getByRole('radio', { name: 'As a woman' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.getByRole('radio', { name: '3' }).props.accessibilityState?.checked).toBe(true);
    expect(screen.queryByTestId('settings-explicit')).toBeNull();
    expectAccessibleControls();
    await fireEvent.press(screen.getByTestId('settings-back'));
    expect(await screen.findByTestId('profile-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
  });

  it('shows a translated not-found screen for unknown routes', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/nowhere' });
    expect(await screen.findByTestId('not-found-screen')).toBeOnTheScreen();
    expect(screen.getByText('This screen does not exist.')).toBeOnTheScreen();
    expectAccessibleControls();
  });
});
