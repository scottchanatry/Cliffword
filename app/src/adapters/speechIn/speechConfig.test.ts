/**
 * app.json configures expo-speech-recognition: the plugin's permission strings are the same as the
 * iOS usage strings (the plugin writes its own over infoPlist, so they must not drift), the
 * microphone permission is declared on Android, and the recognition services the app may bind
 * to are visible to it (Android 11+ package visibility).
 */
import fs from 'fs';
import path from 'path';

const APP_ROOT = path.resolve(__dirname, '../../..');

interface AppJson {
  expo: {
    plugins: unknown[];
    ios: { infoPlist: Record<string, string> };
    android: { permissions: string[] };
  };
}

interface SpeechPluginOptions {
  microphonePermission: string;
  speechRecognitionPermission: string;
  androidSpeechServicePackages: string[];
}

const appJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'app.json'), 'utf8')) as AppJson;

describe('expo-speech-recognition config', () => {
  const entries = appJson.expo.plugins.filter(
    (p) => p === 'expo-speech-recognition' || (Array.isArray(p) && p[0] === 'expo-speech-recognition'),
  );

  it('has one plugin entry, with options', () => {
    expect(entries).toHaveLength(1);
    expect(Array.isArray(entries[0])).toBe(true);
  });

  it('uses the same permission strings as the iOS usage descriptions', () => {
    const options = (entries[0] as [string, SpeechPluginOptions])[1];
    const info = appJson.expo.ios.infoPlist;
    expect(options.microphonePermission).toBe(info.NSMicrophoneUsageDescription);
    expect(options.speechRecognitionPermission).toBe(info.NSSpeechRecognitionUsageDescription);
    expect(options.microphonePermission).toMatch(/microphone button/);
  });

  it('declares the microphone on Android and the Google recognition services', () => {
    const options = (entries[0] as [string, SpeechPluginOptions])[1];
    expect(appJson.expo.android.permissions).toContain('RECORD_AUDIO');
    expect(options.androidSpeechServicePackages).toEqual(['com.google.android.googlequicksearchbox', 'com.google.android.as']);
  });
});
