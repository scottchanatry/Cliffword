/**
 * Services for iOS and Android.
 *
 * Real now: storage (expo-sqlite, the file cliffword.db, opened on first use), text to speech
 * (expo-speech), haptics (expo-haptics), the system clock.
 * Stand-ins until the native packages land in a later stage (each swap is one line here):
 * - model: MockModelAdapter -> the llama.rn adapter, loaded from modelManager.filePath once the
 *   download is 'ready' (the mock stays in use while it downloads).
 * - modelManager: FakeModelManager (reports 'ready') -> an expo-file-system download with
 *   size and SHA-256 checks against DEFAULT_MODEL.
 * - speechIn: TypedSpeechIn (typed answers only) -> the expo-speech-recognition adapter
 *   (on-device, partials, levels, word timings).
 * - music: UnsupportedMusicPlayer -> the MusicKit adapter on iOS; Android stays unsupported.
 * - share: MemoryShareInbox -> an expo-share-intent inbox.
 * Native-only imports for those adapters must stay out of the web bundle. Services.ts imports
 * this file on every platform, so import each native adapter through a module that has a
 * .web.ts twin (Metro platform extensions), e.g. createDeviceModel.ts + createDeviceModel.web.ts.
 */
import { systemClock } from '../adapters/clock/systemClock';
import { ExpoHapticsAdapter } from '../adapters/haptics/ExpoHapticsAdapter';
import { FakeModelManager } from '../adapters/model/FakeModelManager';
import { MockModelAdapter } from '../adapters/model/MockModelAdapter';
import { UnsupportedMusicPlayer } from '../adapters/music/UnsupportedMusicPlayer';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import { TypedSpeechIn } from '../adapters/speechIn/TypedSpeechIn';
import { ExpoSpeechOut } from '../adapters/speechOut/ExpoSpeechOut';
import { openStorage, STORAGE_BACKEND } from '../storage/open';
import { defaultPacks, sharedMockModel } from './defaults';
import { createStorageService, storageClockFor } from './storageService';
import type { ServiceOverrides, Services } from './types';

export function createNativeServices(platform: 'ios' | 'android', overrides: ServiceOverrides = {}): Services {
  const clock = overrides.clock ?? systemClock;
  return {
    platform,
    clock,
    packs: overrides.packs ?? defaultPacks(),
    model: overrides.model ?? new MockModelAdapter({ model: sharedMockModel() }),
    modelManager: overrides.modelManager ?? new FakeModelManager({ initial: 'ready' }),
    speechOut: overrides.speechOut ?? new ExpoSpeechOut(undefined, clock),
    speechIn: overrides.speechIn ?? new TypedSpeechIn(),
    music: overrides.music ?? new UnsupportedMusicPlayer(),
    share: overrides.share ?? new MemoryShareInbox(clock),
    haptics: overrides.haptics ?? new ExpoHapticsAdapter(),
    storage:
      overrides.storage ?? createStorageService(STORAGE_BACKEND, () => openStorage({ clock: storageClockFor(clock) })),
  };
}
