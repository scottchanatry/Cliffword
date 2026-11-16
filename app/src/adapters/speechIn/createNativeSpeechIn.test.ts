/**
 * createNativeSpeechIn with the jest manual mock of expo-speech-recognition
 * (__mocks__/expo-speech-recognition.ts), and with a binary that lacks the native module.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { FakeClock } from '../clock/FakeClock';
import type { FakeSpeechRecognitionModule } from '../../testing/FakeSpeechRecognitionModule';
import { createNativeSpeechIn, loadSpeechRecognitionModule } from './createNativeSpeechIn';
import { ExpoSpeechIn, IOS_STARTUP_AUDIO_SESSION } from './ExpoSpeechIn';

const mod = ExpoSpeechRecognitionModule as unknown as FakeSpeechRecognitionModule;

describe('createNativeSpeechIn', () => {
  it('builds ExpoSpeechIn over the module, with no recognition call or listener until a session starts', async () => {
    const before = mod.startCalls.length;
    const speechIn = createNativeSpeechIn('ios', new FakeClock());
    expect(speechIn).toBeInstanceOf(ExpoSpeechIn);
    expect(speechIn.kind).toBe('native');
    expect(mod.listenerCount('result')).toBe(0);
    await speechIn.start({ lang: 'es-US', onDevice: true, interim: true, continuous: true });
    expect(mod.startCalls).toHaveLength(before + 1);
    expect(mod.listenerCount('result')).toBeGreaterThan(0);
    speechIn.abort();
  });

  it('sets the iOS audio session to playback once at start (text to speech not muted by the silent switch)', () => {
    const before = mod.categoryCalls.length;
    createNativeSpeechIn('ios', new FakeClock());
    expect(mod.categoryCalls.slice(before)).toEqual([IOS_STARTUP_AUDIO_SESSION]);
    expect(IOS_STARTUP_AUDIO_SESSION).toEqual({ category: 'playback', categoryOptions: [], mode: 'default' });
    createNativeSpeechIn('android', new FakeClock());
    expect(mod.categoryCalls).toHaveLength(before + 1);
  });

  it('falls back to typed answers when the binary lacks the native module', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = () => {
      throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
    };
    expect(loadSpeechRecognitionModule(missing)).toBeNull();
    const speechIn = createNativeSpeechIn('android', new FakeClock(), missing);
    expect(speechIn.kind).toBe('typed');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(loadSpeechRecognitionModule()).toBe(ExpoSpeechRecognitionModule);
  });
});
