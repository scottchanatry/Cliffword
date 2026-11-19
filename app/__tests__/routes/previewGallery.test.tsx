/**
 * The dev fixture gallery (app/(dev)/preview/[screen].tsx) renders each story fixture by name
 * through the real router. The guard (src/preview/enabled.ts) is on in Jest (__DEV__);
 * previewGuard.test.tsx checks that a store build cannot open it.
 */
import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';

const APP_DIR = path.resolve(__dirname, '../../app');
let services: TestServices;

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

describe('story preview gallery', () => {
  it.each([
    ['main', 'cliff-card'],
    ['b1', 'hold-area'],
    ['b2', 'landing-headline'],
    ['a2', 'repair-card'],
    ['b3', 'retell-countdown'],
    ['placementDone', 'placement-done'],
    ['loading', 'story-loading'],
    ['lib-home', 'story-home'],
    ['lib-recall-gap', 'cliff-options'],
    ['lib-feedback-model', 'feedback'],
    ['lib-episode-done', 'episode-done'],
  ])('/preview/%s renders the fixture', async (name, testID) => {
    await renderRouter(APP_DIR, { initialUrl: `/preview/${name}` });
    expect(await screen.findByTestId(testID, {}, { timeout: 30000 })).toBeOnTheScreen();
    expect(screen.getByTestId('story-preview')).toBeOnTheScreen();
  }, 40000);

  it('lists the fixtures for an unknown name', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/preview/index' });
    expect(await screen.findByTestId('story-preview-index')).toBeOnTheScreen();
    expect(screen.getByText('main')).toBeOnTheScreen();
    expect(screen.getByText('lib-home')).toBeOnTheScreen();
  });
});
