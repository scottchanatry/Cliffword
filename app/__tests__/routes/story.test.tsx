/**
 * The Story tab through the real router and root layout: the route builds the story
 * controller from the services and the app state, and StoryView renders its first screen.
 * The model is unloaded (canned mode). With the en-es experiences (the app's packs): the Story
 * home, the episode, feedback, the first-episode guide (once) and changing experience. Without
 * them (generatedPacks: the earlier generated flow, kept behind an option) a brand-new learner
 * gets the en-es starter story.
 */
import path from 'path';
import { AppState, StyleSheet } from 'react-native';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { MockModelAdapter } from '../../src/adapters/model/MockModelAdapter';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { ONBOARDED } from '../../src/storage/repos/settings';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { generatedPacks, libraryPacks, livingTrack } from '../../src/testing/packs';
import { layout } from '../../src/theme';

const APP_DIR = path.resolve(__dirname, '../../app');

let services: TestServices;

beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

function install(packs = generatedPacks()) {
  services = createTestServices({ packs, model: new MockModelAdapter({ model: sharedMockModel(), status: 'unloaded' }) }) as unknown as TestServices;
  setAppServices(services);
}

beforeEach(() => install());

afterEach(async () => {
  setAppServices(undefined);
  await services.storage.close();
});

async function onboarded(startLevel: 'brandNew' | 'placement' = 'brandNew') {
  const storage = await services.storage.open();
  await storage.settings.update({ ...ONBOARDED, startLevel, trackId: livingTrack().id });
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

describe('Story tab with the experiences', () => {
  beforeEach(() => install(libraryPacks()));

  it('home, then the first line: the guide once, a picked answer, matching feedback, the next line', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('home-continue'));
    // The first-episode guide: listen, answer, then feedback.
    await fireEvent.press(await screen.findByTestId('guide-next'));
    await fireEvent.press(await screen.findByTestId('guide-next'));
    const options = await screen.findByTestId('cliff-options');
    const rec = await storage.sessions.active<{ state: { current: { cliff: { answer: string } } } }>('story');
    const answer = rec?.snapshot.state.current.cliff.answer ?? '';
    // The whole line played first, then the line up to the gap.
    expect(services.speechOut.spokenTexts[0]).toContain(answer);
    await fireEvent.press(within(options).getByText(answer));
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    expect(screen.getByTestId('feedback-story')).toHaveTextContent(`The story says: ${answer}`);
    expect(screen.getByTestId('guide-feedback')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('guide-next'));
    expect(screen.queryByTestId(/^guide-/)).toBeNull();
    expect(await storage.settings.get('guideSeen')).toBe(true);
    expect((await storage.learner.eventsSince()).map((e) => e.event)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cliff_answer', credit: 'full', rung: 'options' })]),
    );
    await fireEvent.press(screen.getByTestId('episode-next'));
    await waitFor(() => expect(screen.getByTestId('episode-progress')).toHaveTextContent(/^Line 2 of /));
    expectAccessibleControls();
  });

  it('a said answer goes through the mic: tap, the recognizer hears it, tap again', async () => {
    const storage = await onboarded();
    await storage.settings.set('guideSeen', true);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('home-continue'));
    await screen.findByTestId('cliff-options');
    const rec = await storage.sessions.active<{ state: { current: { cliff: { answer: string } } } }>('story');
    const answer = rec?.snapshot.state.current.cliff.answer ?? '';
    await fireEvent.press(screen.getByTestId('mic-button'));
    await waitFor(() => expect(screen.getByTestId('mic-button-label')).toHaveTextContent('Listening… tap to send'));
    services.speechIn.queueUtterance(answer);
    await fireEvent.press(screen.getByTestId('mic-button'));
    expect(await screen.findByTestId('feedback')).toBeOnTheScreen();
    expect(screen.getByTestId('feedback-answer')).toHaveTextContent(`You said: ${answer}`);
    expect(screen.getByTestId('feedback-checked')).toHaveTextContent('Checked by matching. The language model is still downloading.');
  });

  it('changes experience from the home: coming soon cannot be picked, the picker closes on the current one', async () => {
    const storage = await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(await screen.findByTestId('home-change'));
    expect(await screen.findByTestId('experience-picker')).toBeOnTheScreen();
    expect(screen.getByTestId('experience-en-es.track.dating')).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`experience-${livingTrack().id}`));
    expect(await screen.findByTestId('story-home')).toBeOnTheScreen();
    expect(await storage.settings.get('trackId')).toBe(livingTrack().id);
  });
});

describe('Story tab, generated flow', () => {
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
