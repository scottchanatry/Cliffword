/**
 * Web twin of createNativeSpeechIn.ts: Metro picks this file for the web bundle, so
 * expo-speech-recognition stays out of it. The web keeps the browser recognizer when the page
 * has one, else typed answers (the same as createWebServices).
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import type { BrowserSpeechEnv } from './browserTypes';
import { createBrowserSpeechIn } from './createBrowserSpeechIn';
import type { SpeechIn } from './types';

export function createNativeSpeechIn(_platform: 'ios' | 'android', clock: Clock = systemClock): SpeechIn {
  return createBrowserSpeechIn(globalThis as unknown as BrowserSpeechEnv, clock);
}
