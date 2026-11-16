/**
 * The on-device model for iOS and Android: LlamaModelAdapter over llama.rn (Qwen3-1.7B Q4_K_M).
 * It starts 'unloaded'; createNativeServices loads it with keepModelLoaded() once ModelManager has
 * the file verified.
 *
 * On iOS the adapter follows AppState: while the app is in the background, model calls that have
 * not started wait for the foreground (iOS refuses Metal work from background apps, so a decode
 * started then would fail). Android runs on the CPU and needs no such gate.
 *
 * llama.rn is a native-only package: this file is the only one that imports it, and Metro picks
 * createDeviceModel.web.ts (the mock) for the web bundle. __tests__/importGraph.test.ts checks
 * that llama.rn stays out of the web bundle. In Jest, __mocks__/llama.rn.ts replaces it.
 */
import type { LanguageModel } from '@cliffword/engine';
import * as llama from 'llama.rn';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { LlamaModelAdapter } from './LlamaModelAdapter';
import type { LlamaRuntime } from './llamaRuntime';
import type { ModelAdapter } from './types';

export interface DeviceModelOptions {
  /** Picks the GPU and thread settings. Default: Platform.OS. */
  platform?: 'ios' | 'android';
  /** Web only (the mock it wraps); ignored on iOS and Android. */
  mockModel?: LanguageModel;
}

/** The part of React Native's AppState the background gate uses (injectable for tests). */
export interface AppStateLike {
  readonly currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

const runtime: LlamaRuntime = llama;

export function createDeviceModel(opts: DeviceModelOptions = {}, appState: AppStateLike = AppState): ModelAdapter {
  const platform = opts.platform ?? (Platform.OS === 'android' ? 'android' : 'ios');
  const adapter = new LlamaModelAdapter({ runtime, platform });
  if (platform === 'ios') {
    // The container lives as long as the app, so the subscription is never removed.
    adapter.setInBackground(appState.currentState === 'background');
    appState.addEventListener('change', (state) => adapter.setInBackground(state === 'background'));
  }
  return adapter;
}
