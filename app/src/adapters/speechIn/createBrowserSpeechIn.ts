import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { BrowserSpeechIn } from './BrowserSpeechIn';
import { findRecognition, type BrowserSpeechEnv } from './browserTypes';
import { TypedSpeechIn } from './TypedSpeechIn';
import type { SpeechIn } from './types';

/** Web: the browser recognizer when there is one, else typed answers only. */
export function createBrowserSpeechIn(
  env: BrowserSpeechEnv = globalThis as unknown as BrowserSpeechEnv,
  clock: Clock = systemClock,
): SpeechIn {
  const Recognition = findRecognition(env);
  return Recognition ? new BrowserSpeechIn(Recognition, env, clock) : new TypedSpeechIn();
}
