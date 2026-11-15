export type {
  AvailabilityQuery,
  FinalTranscript,
  LanguageDownload,
  ListenOptions,
  SpeechAvailability,
  SpeechIn,
  SpeechInCapabilities,
  SpeechInError,
  SpeechInErrorCode,
  SpeechInKind,
  SpeechInStatus,
  SpeechPermission,
  TranscriptWord,
  WordTimingSource,
} from './types';
export { SpeechInBase, statusForPermission } from './SpeechInBase';
export { LevelMeter, SILENCE_DB, levelToUnit, moduleLevelToDb } from './levels';
export { RECOGNITION_LOCALES, matchLocale, planRecognition, recognitionLocales } from './locales';
export type { RecognitionPlan, RecognizerFacts } from './locales';
export { spokenMsOf, wordsSpanMs } from './timings';
export { SPEECH_IN_DOWNLOAD_ACTION, languageDownloadKey, speechInErrorKey, speechInStatusKey } from './messages';
export { FakeSpeechIn } from './FakeSpeechIn';
export type { FakeFinalExtra, FakeSpeechInOptions, ScriptedUtterance } from './FakeSpeechIn';
export { TypedSpeechIn } from './TypedSpeechIn';
export { BrowserSpeechIn, joinSegments, mapBrowserError } from './BrowserSpeechIn';
export { findRecognition } from './browserTypes';
export type { BrowserRecognition, BrowserRecognitionConstructor, BrowserSpeechEnv } from './browserTypes';
export { createBrowserSpeechIn } from './createBrowserSpeechIn';
// ExpoSpeechIn and createNativeSpeechIn are not in this barrel: services build the native adapter
// through createNativeSpeechIn.ts (with its .web.ts twin), and nothing else should import it.
