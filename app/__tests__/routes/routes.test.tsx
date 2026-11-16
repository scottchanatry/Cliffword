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

const APP_DIR = path.resolve(__dirname, '../../app');

let services: TestServices;

/** Region pills are toggle buttons: their checked state is in accessibilityState. */
const checked = (name: string): boolean | 'mixed' | undefined =>
  screen.getByRole('togglebutton', { name }).props.accessibilityState?.checked;

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

/** Storage as a returning learner left it: onboarded. */
async function onboarded() {
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel: 'brandNew' });
  return storage;
}

describe('first run', () => {
  it('shows a loading state, then sends a new learner to onboarding from any route', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding');
    expect(screen.getByText('Learn Spanish by saying what comes next.')).toBeOnTheScreen();
    expect(screen.queryByTestId('music-screen')).toBeNull();
    expectAccessibleControls();
  });

  it('stores "I’m brand new" and opens the Story tab', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'I’m brand new' }));
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    const storage = await services.storage.open();
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, startLevel: 'brandNew' });
  });

  it('stores "I know some" as placement', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/onboarding' });
    await fireEvent.press(await screen.findByRole('button', { name: 'I know some Spanish' }));
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    const storage = await services.storage.open();
    expect(await storage.settings.get('startLevel')).toBe('placement');
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
  it('opens on the Story tab with the header, both tabs and the first cliff of the story', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(screen.getByText('Cliffword')).toBeOnTheScreen();
    expect(screen.getByTestId('tab-story')).toBeOnTheScreen();
    expect(screen.getByTestId('tab-music')).toBeOnTheScreen();
    // The story controller's first screen (see story.test.tsx): the starter's first cliff.
    expect(await screen.findByTestId('cliff-options')).toBeOnTheScreen();
    expectAccessibleControls();
  });

  it('never shows onboarding again', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/onboarding' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  });

  it('hides the story text as tiles and shows it again, and keeps the choice', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await screen.findByTestId('cliff-options');
    const label = () => screen.getByTestId('text-mode').props.accessibilityLabel as string;
    const before = label();
    await fireEvent.press(screen.getByTestId('text-mode'));
    await waitFor(() => expect(label()).not.toBe(before));
    expect(await storage.settings.get('textMode')).toBe('tiles');
    const tiles = label();
    await fireEvent.press(screen.getByTestId('text-mode'));
    await waitFor(() => expect(label()).not.toBe(tiles));
    expect(await storage.settings.get('textMode')).not.toBe('tiles');
  });

  it('switches to the Music tab, which shows the stored regions', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('tab-music'));
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/music');
    expect(screen.getByText('Your music')).toBeOnTheScreen();
    expect(checked('Puerto Rico')).toBe(true);
    expect(checked('Cuba')).toBe(false);
    expectAccessibleControls();
  });

  it('saves region and explicit-lyrics choices from the Music tab', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    await fireEvent.press(await screen.findByRole('togglebutton', { name: 'Cuba' }));
    await waitFor(() => expect(checked('Cuba')).toBe(true));
    await fireEvent.press(screen.getByRole('togglebutton', { name: 'Puerto Rico' }));
    await waitFor(() => expect(checked('Puerto Rico')).toBe(false));
    expect(await storage.settings.get('regions')).toEqual(['CARIB', 'CU']);

    await fireEvent.press(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByText('Off: explicit lines are skipped')).toBeOnTheScreen();
    expect(await storage.settings.get('showExplicit')).toBe(false);
  });

  it('opens profile and settings from the corner button, with stored values, and closes it', async () => {
    const storage = await onboarded();
    await storage.spokenTime.addUtterance(125_000, services.clock.now());
    await storage.settings.set('showExplicit', false);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Open profile and settings' }));
    expect(await screen.findByTestId('profile-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/profile');
    expect(await screen.findByText('2:05')).toBeOnTheScreen();
    expect(screen.getByText('Spanish')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-explicit')).toHaveTextContent(/Off/);
    expectAccessibleControls();
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
