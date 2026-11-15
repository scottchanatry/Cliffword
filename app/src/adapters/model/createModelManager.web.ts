/**
 * Web twin of createModelManager.ts: the web preview has no file system download and runs the
 * mock model, so the model file is a FakeModelManager that is ready at once (instant mode).
 * Metro picks this file for the web bundle, which keeps expo-file-system's download code,
 * expo-keep-awake and the cliffword-native module out of it.
 */
import type { Clock } from '../clock/types';
import { FakeModelManager } from './FakeModelManager';
import type { ModelDescriptor, ModelManager } from './types';
import type { ModelFilesStore } from './ExpoModelManager';

export interface CreateModelManagerOptions {
  /** Ignored on the web. */
  platform: 'ios' | 'android';
  /** Ignored on the web. */
  modelFiles: () => Promise<ModelFilesStore>;
  clock?: Clock;
  descriptor?: ModelDescriptor;
}

export function createModelManager(opts: CreateModelManagerOptions): ModelManager {
  return new FakeModelManager({ initial: 'ready', mode: 'instant', descriptor: opts.descriptor });
}
