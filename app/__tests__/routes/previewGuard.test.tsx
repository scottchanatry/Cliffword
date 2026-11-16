/** In a store build (no __DEV__, no EXPO_PUBLIC_PREVIEW) the preview gallery cannot be opened. */
import path from 'path';
import { renderRouter, screen } from 'expo-router/testing-library';
import { setAppServices } from '../../src/services/appServices';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';

jest.mock('../../src/preview/enabled', () => ({ PREVIEW_ENABLED: false }));

const APP_DIR = path.resolve(__dirname, '../../app');
let services: TestServices;

beforeAll(async () => {
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

it('redirects /preview/<name> away when previews are off', async () => {
  await renderRouter(APP_DIR, { initialUrl: '/preview/main' });
  expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
  expect(screen.queryByTestId('story-preview')).toBeNull();
  expect(screen.queryByTestId('cliff-card')).toBeNull();
});
