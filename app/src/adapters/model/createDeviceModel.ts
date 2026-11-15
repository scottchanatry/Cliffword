/**
 * The on-device model for iOS and Android: LlamaModelAdapter over llama.rn (Qwen3-1.7B Q4_K_M).
 * It starts 'unloaded'; createNativeServices loads it with keepModelLoaded() once ModelManager has
 * the file verified.
 *
 * llama.rn is a native-only package: this file is the only one that imports it, and Metro picks
 * createDeviceModel.web.ts (the mock) for the web bundle. __tests__/importGraph.test.ts checks
 * that llama.rn stays out of the web bundle. In Jest, __mocks__/llama.rn.ts replaces it.
 */
import type { LanguageModel } from '@cliffword/engine';
import * as llama from 'llama.rn';
import { Platform } from 'react-native';
import { LlamaModelAdapter } from './LlamaModelAdapter';
import type { LlamaRuntime } from './llamaRuntime';
import type { ModelAdapter } from './types';

export interface DeviceModelOptions {
  /** Picks the GPU and thread settings. Default: Platform.OS. */
  platform?: 'ios' | 'android';
  /** Web only (the mock it wraps); ignored on iOS and Android. */
  mockModel?: LanguageModel;
}

const runtime: LlamaRuntime = llama;

export function createDeviceModel(opts: DeviceModelOptions = {}): ModelAdapter {
  const platform = opts.platform ?? (Platform.OS === 'android' ? 'android' : 'ios');
  return new LlamaModelAdapter({ runtime, platform });
}
