/**
 * Speech input for iOS and Android: ExpoSpeechIn over expo-speech-recognition.
 *
 * The package is required here, lazily, and nowhere else: this file has a .web.ts twin, so the
 * native package never reaches the web bundle (__tests__/importGraph.test.ts checks it). When
 * the binary lacks the native module (an old development build, Expo Go), requiring it throws;
 * the app then falls back to typed answers instead of crashing at startup.
 */
import { Platform } from 'react-native';
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { ExpoSpeechIn, type SpeechRecognitionModuleLike } from './ExpoSpeechIn';
import { TypedSpeechIn } from './TypedSpeechIn';
import type { SpeechIn } from './types';

type RecognitionPackage = typeof import('expo-speech-recognition');

// A lazy require on purpose: a static import would evaluate requireNativeModule while the app
// loads, and a binary without the module would crash before the first screen.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requirePackage = (): RecognitionPackage => require('expo-speech-recognition') as RecognitionPackage;

/** The native module, or null when this binary does not include it (`load` is for tests). */
export function loadSpeechRecognitionModule(load: () => RecognitionPackage = requirePackage): SpeechRecognitionModuleLike | null {
  try {
    return load().ExpoSpeechRecognitionModule ?? null;
  } catch (error) {
    console.warn('Speech recognition is not in this build; typed answers only.', error);
    return null;
  }
}

export function createNativeSpeechIn(
  platform: 'ios' | 'android',
  clock: Clock = systemClock,
  load: () => RecognitionPackage = requirePackage,
): SpeechIn {
  const mod = loadSpeechRecognitionModule(load);
  if (!mod) return new TypedSpeechIn();
  const version = Number(Platform.Version);
  return new ExpoSpeechIn(mod, {
    platform,
    androidApiLevel: platform === 'android' && Number.isFinite(version) ? version : undefined,
    clock,
  });
}
