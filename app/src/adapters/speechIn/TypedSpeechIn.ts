/**
 * SpeechIn without a recognizer: answers are typed ("Type instead"). start() reports
 * 'unavailable'; submitTyped() works as everywhere. Used on web without SpeechRecognition and
 * in native builds whose binary lacks the expo-speech-recognition module (createNativeSpeechIn).
 */
import { SpeechInBase } from './SpeechInBase';
import type { ListenOptions, SpeechInCapabilities, SpeechPermission } from './types';

export class TypedSpeechIn extends SpeechInBase {
  readonly kind = 'typed' as const;
  readonly capabilities: SpeechInCapabilities = {
    speech: false,
    onDevice: false,
    partials: false,
    levels: false,
    wordTimings: false,
  };

  async permissionStatus(): Promise<SpeechPermission> {
    return 'unsupported';
  }

  async requestPermission(): Promise<SpeechPermission> {
    return 'unsupported';
  }

  async start(_opts: ListenOptions): Promise<void> {
    this.failStart({ code: 'unavailable' });
  }

  async stop(): Promise<void> {}

  abort(): void {}
}
