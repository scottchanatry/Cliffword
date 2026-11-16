/**
 * Share-in through the real router and root layout: ShareIntentBridge (expo-share-intent is the
 * Jest mock driven by fakeShareIntent) feeds the container's share inbox and opens the Music tab;
 * app/+native-intent.tsx turns the iOS share-extension deep link into the Music tab.
 */
import path from 'path';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { redirectSystemPath } from '../../app/+native-intent';
import { ExpoShareInbox } from '../../src/adapters/share/ExpoShareInbox';
import { setAppServices } from '../../src/services/appServices';
import { defaultPacks, sharedMockModel } from '../../src/services/defaults';
import { createTestServices, type TestServices } from '../../src/services/testServices';
import { loadSqlJs } from '../../src/storage/sql/sqljs';
import { fakeShareIntent } from '../../src/testing/fakeShareIntent';

const APP_DIR = path.resolve(__dirname, '../../app');
const TRACK = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc';

let services: TestServices;

beforeAll(async () => {
  defaultPacks();
  sharedMockModel();
  await loadSqlJs();
});

beforeEach(() => {
  fakeShareIntent.clear();
  services = createTestServices();
  setAppServices(services);
});

afterEach(async () => {
  setAppServices(undefined);
  await services.storage.close();
});

async function onboarded() {
  const storage = await services.storage.open();
  await storage.settings.update({ onboarded: true, startLevel: 'brandNew' });
  return storage;
}

describe('share-in', () => {
  it('sends the iOS share-extension deep link to the Music tab (app/+native-intent.tsx)', async () => {
    const link = 'cliffword://dataUrl=cliffwordShareKey?nonce=7A1C2F#weburl';
    expect(redirectSystemPath({ path: link, initial: true })).toBe('/music');
    expect(redirectSystemPath({ path: 'cliffword://dataUrl=cliffwordShareKey#text', initial: false })).toBe('/music');
    expect(redirectSystemPath({ path: 'cliffword://profile', initial: false })).toBe('cliffword://profile');
    expect(redirectSystemPath({ path: '/music', initial: true })).toBe('/music');

    // The test router cannot take a custom-scheme URL (it keeps only path, query and hash), so it
    // starts from the redirected path, as expo-router does on the device.
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: redirectSystemPath({ path: link, initial: true }) });
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/music');
  });

  it('puts a share into the inbox, clears the native copy and opens the Music tab', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();

    await act(async () => fakeShareIntent.deliver({ text: `Despacito - Luis Fonsi ${TRACK}`, webUrl: TRACK }));
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/music');
    expect(services.share.pending()).toEqual([
      expect.objectContaining({ url: TRACK, text: `Despacito - Luis Fonsi ${TRACK}` }),
    ]);
    expect(fakeShareIntent.resets).toBe(1);
  });

  it('keeps one item when the same share is delivered twice', async () => {
    await onboarded();
    const seen = jest.fn();
    services.share.onShare(seen);
    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();

    await act(async () => fakeShareIntent.deliver({ text: 'Ella y Yo - Aventura' }));
    await act(async () => fakeShareIntent.deliver({ text: 'Ella y Yo - Aventura' }));
    await waitFor(() => expect(fakeShareIntent.resets).toBe(2));
    expect(services.share.pending()).toHaveLength(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('takes a share that arrives while startup is still loading, then opens the Music tab', async () => {
    await onboarded();
    let finishOpen: () => void = () => undefined;
    const realOpen = services.storage.open;
    const gate = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    jest.spyOn(services.storage, 'open').mockImplementation(() => gate.then(() => realOpen()));

    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('boot-loading')).toBeOnTheScreen();
    await act(async () => fakeShareIntent.deliver({ text: 'Tití Me Preguntó - Bad Bunny' }));
    expect(services.share.pending()).toHaveLength(1);

    await act(async () => finishOpen());
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    expect(screen).toHavePathname('/music');
  });

  it('feeds a persistent inbox: stored in share_inbox and restored at start', async () => {
    const storage = await onboarded();
    await storage.shareInbox.add({ text: 'Left - Over', receivedAt: 1 });
    const inbox = new ExpoShareInbox(() => services.storage.open().then((s) => s.shareInbox), services.clock, jest.fn());
    setAppServices(createTestServices({ share: inbox, storage: services.storage, clock: services.clock }));

    await renderRouter(APP_DIR, { initialUrl: '/music' });
    expect(await screen.findByTestId('music-screen')).toBeOnTheScreen();
    await waitFor(() => expect(inbox.pending().map((i) => i.text)).toEqual(['Left - Over']));

    await act(async () => fakeShareIntent.deliver({ webUrl: TRACK, text: TRACK }));
    await waitFor(() => expect(inbox.pending()).toHaveLength(2));
    expect((await storage.shareInbox.pending()).map((r) => r.url)).toEqual([null, TRACK]);
  });

  it('ignores file shares (they only get cleared)', async () => {
    await onboarded();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(await screen.findByTestId('story-screen')).toBeOnTheScreen();
    await act(async () =>
      fakeShareIntent.deliver({
        type: 'file',
        files: [{ path: 'file:///a.mp3', mimeType: 'audio/mpeg', fileName: 'a.mp3', size: 1, width: null, height: null, duration: null }],
      }),
    );
    expect(fakeShareIntent.resets).toBe(1);
    expect(services.share.pending()).toEqual([]);
    expect(screen).toHavePathname('/');
  });
});
