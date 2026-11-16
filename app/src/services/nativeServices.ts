/**
 * Services for iOS and Android.
 *
 * Real now: storage (expo-sqlite, the file cliffword.db, opened on first use), text to speech
 * (expo-speech), speech recognition (ExpoSpeechIn over expo-speech-recognition, on-device by
 * default; typed answers only if the binary lacks the module), haptics (expo-haptics), the
 * system clock, the model file: ExpoModelManager (createModelManager; expo-file-system download
 * of DEFAULT_MODEL into the document directory, size and SHA-256 checks, recorded in model_files),
 * and the model: LlamaModelAdapter over llama.rn (createDeviceModel), 'unloaded'
 * until keepModelLoaded() loads it from modelManager.filePath once the file is 'ready'; model
 * calls reject with ModelNotReadyError until then, and modelAvailability() tells the UI why.
 * Music: MusicKitPlayer over modules/cliffword-music on iOS (createNativeMusicPlayer);
 * UnsupportedMusicPlayer on Android and on an iOS binary without the module.
 * Share-in: ExpoShareInbox (createNativeShareInbox) over the share_inbox table, fed by
 * ShareIntentBridge (expo-share-intent) in the root layout.
 * Native-only imports for those adapters must stay out of the web bundle. Services.ts imports
 * this file on every platform, so import each native adapter through a module that has a
 * .web.ts twin (Metro platform extensions), e.g. createDeviceModel.ts + createDeviceModel.web.ts.
 */
import { systemClock } from '../adapters/clock/systemClock';
import { ExpoHapticsAdapter } from '../adapters/haptics/ExpoHapticsAdapter';
import { createDeviceModel } from '../adapters/model/createDeviceModel';
import { createModelManager } from '../adapters/model/createModelManager';
import { keepModelLoaded } from '../adapters/model/keepModelLoaded';
import type { ModelAdapter } from '../adapters/model/types';
import { createNativeMusicPlayer } from '../adapters/music/createNativeMusicPlayer';
import { createNativeShareInbox } from '../adapters/share/createNativeShareInbox';
import { createNativeSpeechIn } from '../adapters/speechIn/createNativeSpeechIn';
import { ExpoSpeechOut } from '../adapters/speechOut/ExpoSpeechOut';
import { openStorage, STORAGE_BACKEND } from '../storage/open';
import { defaultPacks } from './defaults';
import { createStorageService, storageClockFor } from './storageService';
import type { ServiceOverrides, Services } from './types';

export function createNativeServices(platform: 'ios' | 'android', overrides: ServiceOverrides = {}): Services {
  const clock = overrides.clock ?? systemClock;
  const storage =
    overrides.storage ?? createStorageService(STORAGE_BACKEND, () => openStorage({ clock: storageClockFor(clock) }));
  // The model file (web: createModelManager.web.ts, a FakeModelManager that is ready at once).
  const modelManager =
    overrides.modelManager ??
    createModelManager({ platform, clock, modelFiles: () => storage.open().then((opened) => opened.modelFiles) });
  let model: ModelAdapter | undefined = overrides.model;
  if (!model) {
    // llama.rn (Qwen3-1.7B); loaded as soon as the model file is verified, unloaded if it goes.
    model = createDeviceModel({ platform });
    keepModelLoaded(model, modelManager);
  }
  return {
    platform,
    clock,
    packs: overrides.packs ?? defaultPacks(),
    model,
    modelManager,
    speechOut: overrides.speechOut ?? new ExpoSpeechOut(undefined, clock),
    speechIn: overrides.speechIn ?? createNativeSpeechIn(platform, clock),
    // Apple Music (web: createNativeMusicPlayer.web.ts, UnsupportedMusicPlayer).
    music: overrides.music ?? createNativeMusicPlayer(platform, clock),
    // Shared links and text, kept in share_inbox (web: createNativeShareInbox.web.ts, in memory).
    share: overrides.share ?? createNativeShareInbox(storage, clock),
    haptics: overrides.haptics ?? new ExpoHapticsAdapter(),
    storage,
  };
}
