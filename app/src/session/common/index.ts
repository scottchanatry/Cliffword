/**
 * Plumbing shared by the session controllers (src/session/lyric, and src/session/story once it
 * adopts it): the serial queue into an engine session, hold to speak, the voice, the
 * one-transaction step write and the utterance-to-speaking-time rule. Each piece is the
 * behaviour the story controller already had, lifted out so both controllers act the same way.
 */
export { SerialQueue } from './queue';
export type { SerialQueueOptions } from './queue';
export { HoldToSpeak, LISTEN_IDLE } from './hold';
export type { HoldToSpeakDeps } from './hold';
export { Speaker, wordSpansOf } from './speaker';
export type { SayOutcome, SpeakerDeps, VoiceChoice } from './speaker';
export { dayKey, deviceTzOffset, persistStep, storageClockOf, transactionDatabase } from './persist';
export type { StepWrite } from './persist';
export { typedTranscript, utteranceOf } from './utterance';
export type { SessionUtterance } from './utterance';
export { listenOptionsFor } from './listen';
