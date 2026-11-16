/**
 * The Story tab through the real router and root layout: the route builds the story
 * controller from the services and the app state, and StoryView renders its first screen.
 * The model is unloaded (canned mode), so a brand-new learner gets the en-es starter story.
 */
import path from 'path';
import { AppState, StyleSheet } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { MockModelAdapter } from '../../src/adapters/model/MockModelAdapter';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');

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

async function onboarded(startLevel: 'brandNew' | 'placement' = 'brandNew') {
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel });
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

describe('Story tab', () => {
  it("renders the controller's first screen: the starter story stops at its first cliff", async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    const options = await screen.findByTestId('cliff-options');
    for (const option of ['artista', 'hospital', 'rápido']) expect(within(options).getByText(option)).toBeOnTheScreen();
    expect(screen.getByTestId('story-screen')).toBeOnTheScreen();
    // The controller spoke the sentence up to the cliff and stored its session (before it
    // published the screen).
    expect(services.speechOut.spokenTexts[0]).toBe('Marta es una');
    expect(await storage.sessions.active('story')).toMatchObject({ kind: 'story', active: true });
    expectAccessibleControls();

    // Picking the natural option lands, and the answer is in the learner's log.
    await fireEvent.press(within(options).getByText('artista'));
    expect(await screen.findByTestId('landing-headline')).toBeOnTheScreen();
    expect(screen.queryByTestId('cliff-options')).toBeNull();
    expect((await storage.learner.eventsSince()).map((e) => e.event)).toEqual([
      expect.objectContaining({ type: 'cliff_answer', key: 'es:artista', credit: 'full' }),
    ]);
  });

  it('suspends the story when the app goes to the background', async () => {
    const storage = await onboarded();
    // Watch the app-state listeners the screens add (the real ones stay in place).
    const spy = jest.spyOn(AppState, 'addEventListener');
    const listeners = () => spy.mock.calls.filter(([type]) => type === 'change').map(([, listener]) => listener as (status: string) => void);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await screen.findByTestId('cliff-options');
    await waitFor(() => expect(listeners().length).toBeGreaterThan(0));
    const saved = (await storage.sessions.active('story'))?.updatedAt ?? 0;
    services.clock.advance(60_000);
    await act(async () => {
      for (const listener of listeners()) listener('background');
    });
    // The suspend's save runs through the controller's queue and the database's (promises only;
    // the router's tests run on fake timers).
    let updatedAt = saved;
    for (let i = 0; i < 200 && updatedAt === saved; i++) updatedAt = (await storage.sessions.active('story'))?.updatedAt ?? saved;
    expect(updatedAt).toBe(saved + 60_000);
    spy.mockRestore();
  });
});
