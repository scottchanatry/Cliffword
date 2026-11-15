/**
 * The model file manager for iOS and Android: ExpoModelManager (expo-file-system download into
 * the document directory, size and SHA-256 checks, model_files records, keep-awake while it runs).
 *
 * expo-file-system, expo-keep-awake and the cliffword-native module are reached only from here
 * (ExpoModelManager and fileHash import them). Metro picks createModelManager.web.ts for the web
 * bundle, which keeps them out of it: the web preview runs the mock model with a FakeModelManager
 * that is ready at once. __tests__/importGraph.test.ts checks both bundles.
 */
import type { Clock } from '../clock/types';
import { ExpoModelManager, type ModelFilesStore } from './ExpoModelManager';
import type { ModelDescriptor, ModelManager } from './types';

export interface CreateModelManagerOptions {
  platform: 'ios' | 'android';
  /** The model_files repository, opened on demand: () => storage.open().then((s) => s.modelFiles). */
  modelFiles: () => Promise<ModelFilesStore>;
  clock?: Clock;
  /** Default DEFAULT_MODEL. */
  descriptor?: ModelDescriptor;
}

export function createModelManager(opts: CreateModelManagerOptions): ModelManager {
  return new ExpoModelManager({
    platform: opts.platform,
    modelFiles: opts.modelFiles,
    clock: opts.clock,
    descriptor: opts.descriptor,
  });
}
