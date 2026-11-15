/**
 * Pure helpers for word positions and timings in spoken text.
 *
 * wordSpans is a fallback for callers without a language pack: it treats runs of letters,
 * marks and digits (with inner apostrophes, and clipped forms such as 'tá and pa') as words.
 * Scripts written without spaces need the pack's segmenter instead (SpeakOptions.words).
 */
import type { WordSpan } from './types';

const WORD_RE = /['’]?[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*['’]?/gu;

export function wordSpans(text: string): WordSpan[] {
  return [...text.matchAll(WORD_RE)].map((m) => {
    const start = m.index ?? 0;
    return { text: m[0], start, end: start + m[0].length };
  });
}

/**
 * The index of the word a platform boundary at `charIndex` refers to: the span containing it,
 * else the first span after it (engines often report the space before a word). -1 when the
 * offset is past the last word.
 */
export function spanIndexAt(spans: readonly WordSpan[], charIndex: number): number {
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i] as WordSpan;
    if (charIndex < span.end) return i;
  }
  return -1;
}

export interface TimingOptions {
  /** Speech rate, 1 = normal. */
  rate: number;
  /** Fixed time per word at rate 1, in ms. */
  baseMs: number;
  /** Time per character at rate 1, in ms. */
  perCharMs: number;
  /** Pause between words at rate 1, in ms. */
  gapMs: number;
}

export const DEFAULT_TIMING: TimingOptions = { rate: 1, baseMs: 90, perCharMs: 55, gapMs: 60 };

export interface WordTiming extends WordSpan {
  index: number;
  startMs: number;
  endMs: number;
}

/**
 * Estimated start and end of each word, from its length and the rate. FakeSpeechOut reports
 * these; the app can also size blank tiles by them before real timings exist.
 */
export function estimateWordTimings(spans: readonly WordSpan[], opts: Partial<TimingOptions> = {}): WordTiming[] {
  const o = { ...DEFAULT_TIMING, ...opts };
  const rate = o.rate > 0 ? o.rate : 1;
  let t = 0;
  return spans.map((span, index) => {
    const letters = [...span.text.replace(/['’]/g, '')].length;
    const startMs = Math.round(t);
    const endMs = Math.round(t + (o.baseMs + o.perCharMs * letters) / rate);
    t = endMs + o.gapMs / rate;
    return { ...span, index, startMs, endMs };
  });
}
