/** Test helper: subscribes to every SpeechIn event and records them in order (for adapter and screen tests). */
import type { FinalTranscript, SpeechIn, SpeechInError } from '../adapters/speechIn/types';

export type RecordedEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; transcript: FinalTranscript }
  | { type: 'level'; db: number }
  | { type: 'error'; error: SpeechInError }
  | { type: 'end' };

export function recordEvents(speechIn: SpeechIn): { events: RecordedEvent[]; types: () => string[]; stop: () => void } {
  const events: RecordedEvent[] = [];
  const offs = [
    speechIn.onPartial((text) => events.push({ type: 'partial', text })),
    speechIn.onFinal((transcript) => events.push({ type: 'final', transcript })),
    speechIn.onLevel((db) => events.push({ type: 'level', db })),
    speechIn.onError((error) => events.push({ type: 'error', error })),
    speechIn.onEnd(() => events.push({ type: 'end' })),
  ];
  return {
    events,
    types: () => events.map((e) => e.type),
    stop: () => offs.forEach((off) => off()),
  };
}
