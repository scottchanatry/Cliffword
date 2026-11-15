/**
 * Device adapters: every native capability behind an interface, with a fake for tests and a
 * web fallback. The service container (../services) picks implementations per platform.
 *
 * | Capability | Interface | Now (native) | Web | Tests | Later stage |
 * |---|---|---|---|---|---|
 * | Language model | ModelAdapter | LlamaModelAdapter (llama.rn, via createDeviceModel) | MockModelAdapter | MockModelAdapter | — |
 * | Model file | ModelManager | ExpoModelManager (expo-file-system download + SHA-256, via createModelManager) | FakeModelManager (ready) | FakeModelManager | — |
 * | Text to speech | SpeechOut | ExpoSpeechOut | ExpoSpeechOut (speechSynthesis) | FakeSpeechOut | — |
 * | Recognition | SpeechIn | ExpoSpeechIn (expo-speech-recognition, on-device) | BrowserSpeechIn or TypedSpeechIn | FakeSpeechIn | — |
 * | Apple Music | MusicPlayer | UnsupportedMusicPlayer | UnsupportedMusicPlayer | FakeMusicPlayer | MusicKit adapter (iOS) |
 * | Share-in | ShareInbox | MemoryShareInbox | MemoryShareInbox | MemoryShareInbox | expo-share-intent inbox |
 * | Haptics | Haptics | ExpoHapticsAdapter | ExpoHapticsAdapter | FakeHaptics | — |
 * | Time | Clock | systemClock | systemClock | FakeClock | — |
 */
export * from './listeners';
export * from './clock';
export * from './model';
export * from './speechOut';
export * from './speechIn';
export * from './music';
export * from './share';
export * from './haptics';
