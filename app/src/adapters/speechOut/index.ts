export type {
  SpeakOptions,
  SpeakResult,
  SpeechOut,
  SpeechOutErrorCode,
  Voice,
  WordBoundary,
  WordSpan,
} from './types';
export { SpeechOutError } from './types';
export { DEFAULT_TIMING, estimateWordTimings, spanIndexAt, wordSpans } from './wordSpans';
export type { TimingOptions, WordTiming } from './wordSpans';
export { filterVoices, langMatches, normalizeLang } from './voices';
export { ExpoSpeechOut } from './ExpoSpeechOut';
export type { ExpoSpeechModule } from './ExpoSpeechOut';
export { FAKE_VOICES, FakeSpeechOut } from './FakeSpeechOut';
export type { FakeSpeechOutOptions, SpokenCall } from './FakeSpeechOut';
