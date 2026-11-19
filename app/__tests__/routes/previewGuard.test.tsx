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

describe('the gallery stays out of store bundles', () => {
  const fs = jest.requireActual<typeof import('fs')>('fs');
  const APP_ROOT = path.resolve(__dirname, '../..');
  const read = (rel: string) => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(path.join(APP_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [rel] : [];
    });
  }

  it('requires the gallery only behind the build-time condition that constant folding removes', () => {
    const route = read('app/(dev)/preview/[screen].tsx');
    // No static import of the gallery or any fixture from the route.
    expect(route).not.toMatch(/^import .*(preview\/Gallery|fixtures|Preview)'/m);
    expect(route).toMatch(/__DEV__ \|\| process\.env\.EXPO_PUBLIC_PREVIEW === '1'\s*\?[^:]*require\('\.\.\/\.\.\/\.\.\/src\/preview\/Gallery'\)/);
  });

  it('no app module outside the gallery imports a fixture or a preview screen', () => {
    const galleryOnly = new Set([
      'src/preview/Gallery',
      'src/features/story/StoryPreview',
      'src/features/music/MusicPreview',
      'src/features/profile/AccountPreview',
      'src/features/story/fixtures',
      'src/features/story/library/libraryFixtures',
      'src/features/music/fixtures',
      'src/features/profile/accountFixtures',
    ]);
    const isGalleryFile = (file: string) => galleryOnly.has(file.split(path.sep).join('/').replace(/\.tsx?$/, ''));
    const importsOf = (file: string) =>
      [...read(file).matchAll(/(?:from\s+|import\s+|require\()'(\.[^']+)'/g)].map((m) =>
        path.relative(APP_ROOT, path.resolve(path.dirname(path.join(APP_ROOT, file)), m[1] ?? '')).split(path.sep).join('/'),
      );
    const offenders = [...sourceFiles('app'), ...sourceFiles('src')]
      .filter((file) => !file.includes(`${path.sep}testing${path.sep}`) && !isGalleryFile(file))
      .filter((file) => file !== path.join('app', '(dev)', 'preview', '[screen].tsx'))
      .flatMap((file) => importsOf(file).filter((spec) => galleryOnly.has(spec)).map((spec) => `${file} -> ${spec}`));
    expect(offenders).toEqual([]);
  });
});
