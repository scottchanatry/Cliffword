/**
 * A final transcript (spoken or typed) as a session utterance: the engine's UtteranceInfo and
 * the speaking time it earns. Typed answers carry no duration, so the engine credits no
 * speaking time and the controller writes none (minutes spoken count only the voice).
 */
import { creditedMs, type UtteranceInfo } from '@cliffword/engine';
import { spokenMsOf } from '../../adapters/speechIn/timings';
import type { FinalTranscript } from '../../adapters/speechIn/types';

export interface SessionUtterance {
  text: string;
  info: UtteranceInfo;
  /** Speaking time to credit (engine creditedMs of the voiced time); 0 for typed answers. */
  credited: number;
  typed: boolean;
}

export function utteranceOf(t: FinalTranscript): SessionUtterance {
  const typed = t.source === 'typed';
  if (typed) return { text: t.text, info: {}, credited: 0, typed };
  const durationMs = spokenMsOf(t);
  const info: UtteranceInfo = {
    durationMs,
    ...(t.words && t.words.length > 0 ? { words: t.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })) } : {}),
  };
  return { text: t.text, info, credited: creditedMs(durationMs), typed };
}

/** A typed answer as a transcript ("Type instead"): the same path as a spoken final. */
export function typedTranscript(text: string): FinalTranscript {
  return { text, durationMs: 0, source: 'typed' };
}
