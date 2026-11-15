/**
 * Web twin of createDeviceModel.ts: there is no llama.rn on the web, so the "device model" is
 * the engine's n-gram mock, ready at once. Metro picks this file for the web bundle, which keeps
 * llama.rn out of it (nativeServices.ts is in every bundle because Services.ts imports it).
 */
import type { LanguageModel } from '@cliffword/engine';
import { MockModelAdapter } from './MockModelAdapter';
import type { ModelAdapter } from './types';

export interface DeviceModelOptions {
  /** Ignored on the web. */
  platform?: 'ios' | 'android';
  /** The mock to wrap (the services pass their shared one). Default: a new createMockModel(). */
  mockModel?: LanguageModel;
}

export function createDeviceModel(opts: DeviceModelOptions = {}): ModelAdapter {
  return new MockModelAdapter({ model: opts.mockModel });
}
