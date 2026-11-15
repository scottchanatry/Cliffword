/**
 * Jest manual mock for expo-speech-recognition (a native module; the package ships no mock and
 * jest-expo cannot find its native side). Jest uses it for every test automatically, because it
 * sits next to node_modules. ExpoSpeechRecognitionModule is a FakeSpeechRecognitionModule that a
 * test can drive (import it from 'expo-speech-recognition'); the constants are the package's own.
 */
import { FakeSpeechRecognitionModule } from '../src/testing/FakeSpeechRecognitionModule';

const constants = jest.requireActual<typeof import('expo-speech-recognition/build/constants')>(
  'expo-speech-recognition/build/constants',
);

export const ExpoSpeechRecognitionModule = new FakeSpeechRecognitionModule();

export const {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  RecognizerIntentExtraLanguageModel,
  RecognizerIntentEnableLanguageSwitch,
  AudioEncodingAndroid,
  TaskHintIOS,
  SpeechRecognizerErrorAndroid,
} = constants;

/** A no-op: the app listens through ExpoSpeechIn, not the hook. */
export function useSpeechRecognitionEvent(): void {}

/** The Web Speech API shims are not used by the app. */
export class ExpoWebSpeechRecognition {}
export class ExpoWebSpeechGrammar {}
export class ExpoWebSpeechGrammarList {}
