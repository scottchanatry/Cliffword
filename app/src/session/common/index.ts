/**
 * Plumbing shared by the session controllers (src/session/story and src/session/lyric) and
 * onboarding's hold practice: the serial queue into an engine session, hold to speak, the
 * voice, the one-transaction step write, the utterance-to-speaking-time rule and the listen
 * options. Both controllers use these, so they act the same way.
 */
export { SerialQueue } from './queue';
export type { SerialQueueOptions } from './queue';
export { HoldToSpeak, LISTEN_IDLE } from './hold';
export type { HoldToSpeakDeps } from './hold';
export { Speaker, VOICE_LIST_TIMEOUT_MS, installedVoices, wordSpansOf } from './speaker';
export type { SayOutcome, SpeakerDeps, VoiceChoice } from './speaker';
export { dayKey, deviceTzOffset, persistStep, storageClockOf, transactionDatabase } from './persist';
export type { StepWrite } from './persist';
export { typedTranscript, utteranceOf } from './utterance';
export type { SessionUtterance } from './utterance';
export { MAX_HINTS, listenOptionsFor, withCommandHints } from './listen';
