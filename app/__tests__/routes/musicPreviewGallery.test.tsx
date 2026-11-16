/**
 * The dev fixture gallery (app/(dev)/preview/[screen].tsx) renders each Music fixture by name
 * through the real router: the five previews (a3, c1, c2, b4, c3), paste, the brought text and
 * the other states. The guard (src/preview/enabled.ts) is on in Jest (__DEV__).
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

describe('music preview gallery', () => {
  it.each([
    ['a3', 'song-lines'],
    ['c1', 'lyric-gap'],
    ['c2', 'swaps-1'],
    ['b4', 'echo-landed'],
    ['c3', 'library-list'],
    ['paste', 'paste-preview'],
    ['text', 'text-sentences'],
    ['time', 'time-tap'],
    ['share', 'share-confirm'],
    ['text-paste', 'text-paste-save'],
    ['lyric-loading', 'song-loading'],
  ])('/preview/%s renders the fixture', async (name, testID) => {
    await renderRouter(APP_DIR, { initialUrl: `/preview/${name}` });
    expect(await screen.findByTestId(testID, {}, { timeout: 30000 })).toBeOnTheScreen();
    expect(screen.getByTestId('music-preview')).toBeOnTheScreen();
  }, 40000);
});
