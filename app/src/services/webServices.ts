/**
 * Services for the web build (a preview of the app): the mock model (ready at once), storage in
 * memory (sql.js through src/storage/open.web.ts, which Metro picks for web; nothing persists
 * across reloads), the browser's voices through expo-speech, the browser recognizer when there is
 * one (else typed answers), no Apple Music, and an in-memory share inbox.
 */
import { systemClock } from '../adapters/clock/systemClock';
import { ExpoHapticsAdapter } from '../adapters/haptics/ExpoHapticsAdapter';
import { FakeModelManager } from '../adapters/model/FakeModelManager';
import { MockModelAdapter } from '../adapters/model/MockModelAdapter';
import { UnsupportedMusicPlayer } from '../adapters/music/UnsupportedMusicPlayer';
import { FixedNetworkInfo } from '../adapters/network/FixedNetworkInfo';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import type { BrowserSpeechEnv } from '../adapters/speechIn/browserTypes';
import { createBrowserSpeechIn } from '../adapters/speechIn/createBrowserSpeechIn';
import { ExpoSpeechOut } from '../adapters/speechOut/ExpoSpeechOut';
import { openStorage, STORAGE_BACKEND } from '../storage/open';
import { defaultPacks, sharedMockModel } from './defaults';
import { createStorageService, storageClockFor } from './storageService';
import type { ServiceOverrides, Services } from './types';

export function createWebServices(
  overrides: ServiceOverrides = {},
  env: BrowserSpeechEnv = globalThis as unknown as BrowserSpeechEnv,
): Services {
  const clock = overrides.clock ?? systemClock;
  return {
    platform: 'web',
    clock,
    packs: overrides.packs ?? defaultPacks(),
    model: overrides.model ?? new MockModelAdapter({ model: sharedMockModel() }),
    modelManager: overrides.modelManager ?? new FakeModelManager({ initial: 'ready' }),
    speechOut: overrides.speechOut ?? new ExpoSpeechOut(undefined, clock),
    speechIn: overrides.speechIn ?? createBrowserSpeechIn(env, clock),
    music: overrides.music ?? new UnsupportedMusicPlayer(),
    share: overrides.share ?? new MemoryShareInbox(clock),
    haptics: overrides.haptics ?? new ExpoHapticsAdapter(),
    // The preview's model is ready at once: nothing waits for Wi-Fi.
    network: overrides.network ?? new FixedNetworkInfo('unknown'),
    // '../storage/open' is open.web.ts in the web bundle (sql.js in memory).
    storage:
      overrides.storage ?? createStorageService(STORAGE_BACKEND, () => openStorage({ clock: storageClockFor(clock) })),
  };
}
