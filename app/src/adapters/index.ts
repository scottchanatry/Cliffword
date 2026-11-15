/**
 * Device adapters: every native capability behind an interface, with a fake for tests and a
 * web fallback. The service container (../services) picks implementations per platform.
 *
 * | Capability | Interface | Now (native) | Web | Tests | Later stage |
 * |---|---|---|---|---|---|
 * | Language model | ModelAdapter | MockModelAdapter | MockModelAdapter | MockModelAdapter | llama.rn adapter |
 * | Model file | ModelManager | FakeModelManager (ready) | FakeModelManager (ready) | FakeModelManager | expo-file-system download + SHA-256 |
 * | Text to speech | SpeechOut | ExpoSpeechOut | ExpoSpeechOut (speechSynthesis) | FakeSpeechOut | — |
 * | Recognition | SpeechIn | TypedSpeechIn | BrowserSpeechIn or TypedSpeechIn | FakeSpeechIn | expo-speech-recognition adapter |
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
