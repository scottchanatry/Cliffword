/**
 * Word timings and spoken time from what a recognizer reports, for the engine's speaking module:
 * retellMetrics / retellCoverage read TranscriptWord as TimedWord ({ text, startMs, endMs }, ms
 * from the session start) and addSpoken reads the spoken length (spokenMsOf).
 *
 * - segmentsToWords: recognizer segments (iOS: word, timestamp, duration; Android 14+: word and
 *   start only) to TranscriptWords on the session clock.
 * - fillWordEnds: ends for start-only words, from word length, never past the next start.
 * - voicedRuns: the voiced parts of the input level (a small voice activity detector).
 * - estimateHeardTimings: timings for words without segments, spread over the voiced runs (else
 *   over the recording) in proportion to word length, piece by piece where the recognizer split
 *   the speech at pauses, so pauses land where the learner paused.
 * - spokenMsOf: the time spent speaking for "minutes spoken".
 *
 * All pure: no clock, no platform.
 */
import { wordSpans } from '../speechOut/wordSpans';
import type { FinalTranscript, TranscriptWord } from './types';

/** A span of time in ms from the session start. */
export interface TimeSpan {
  startMs: number;
  endMs: number;
}

/** An input level sample: `t` ms from the session start, `db` in dBFS. */
export interface LevelSample {
  t: number;
  db: number;
}

/** A recognizer segment as expo-speech-recognition reports it (ms from the audio start). */
export interface RecognizerSegment {
  segment: string;
  startTimeMillis: number;
  endTimeMillis: number;
  /** 0..1, or -1 when unavailable. */
  confidence: number;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Relative spoken length of a word: its letters and digits (at least 1). Script-neutral. */
export function wordWeight(text: string): number {
  let n = 0;
  for (const ch of text) if (LETTER_OR_DIGIT.test(ch)) n++;
  return Math.max(1, n);
}

/** About how long a learner takes to say a word, in ms (for ends the recognizer leaves out). */
export function estimatedWordMs(text: string): number {
  return Math.min(1200, Math.max(150, 100 + 60 * wordWeight(text)));
}

/** True when segments carry starts only (Android: each end is the next start, the last end equals its start). */
export function isStartsOnly(segments: readonly RecognizerSegment[]): boolean {
  const last = segments[segments.length - 1];
  return last !== undefined && last.endTimeMillis <= last.startTimeMillis;
}

/**
 * Recognizer segments as words on the session clock (`offsetMs`: when the audio started, from
 * the session start). A segment holding several words is split by word length; empty segments
 * are dropped. Confidence is kept when the recognizer gave one (0..1).
 */
export function segmentsToWords(segments: readonly RecognizerSegment[], offsetMs: number): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const seg of segments) {
    const startMs = Math.round(offsetMs + seg.startTimeMillis);
    const endMs = Math.round(offsetMs + Math.max(seg.startTimeMillis, seg.endTimeMillis));
    const confidence = seg.confidence >= 0 && seg.confidence <= 1 ? seg.confidence : undefined;
    const parts = splitWords(seg.segment);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      out.push(withConfidence({ text: parts[0] as string, startMs, endMs }, confidence));
      continue;
    }
    for (const w of spreadByWeight(parts, { startMs, endMs })) out.push(withConfidence(w, confidence));
  }
  return out;
}

/** Ends for start-only words: start + estimatedWordMs, but never past the next word's start or `endLimitMs`. */
export function fillWordEnds(words: readonly TranscriptWord[], endLimitMs: number): TranscriptWord[] {
  return words.map((w, i) => {
    const next = words[i + 1];
    const limit = next ? next.startMs : Number.isFinite(endLimitMs) && endLimitMs > w.startMs ? endLimitMs : Infinity;
    return { ...w, endMs: Math.round(Math.max(w.startMs, Math.min(w.startMs + estimatedWordMs(w.text), limit))) };
  });
}

/**
 * The words of a recognized transcript, for timing estimates. Recognizers put spaces between
 * words in languages written with spaces; for scripts without them a run of text counts as one
 * word, which only coarsens the estimate.
 */
export function splitWords(text: string): string[] {
  return wordSpans(text).map((s) => s.text);
}

export interface VadOptions {
  /** Length of time one sample stands for (ms); default: the median gap between samples, else 50. */
  frameMs?: number;
  /** A sample is voiced at the noise floor plus this (dB). */
  marginDb: number;
  /** The voiced threshold stays within these (dBFS). */
  minThresholdDb: number;
  maxThresholdDb: number;
  /** The noise floor is this quantile of the samples (there is almost always some silence in a hold). */
  floorQuantile: number;
  /** Voiced runs closer than this merge (ms): the gap inside a word or between quick words. */
  hangoverMs: number;
  /** Shorter runs are dropped (ms): clicks, the tap of the finger. */
  minRunMs: number;
}

/**
 * Defaults (judgement calls; check on devices, S8 in the device checklist):
 * - marginDb 9, threshold between -45 and -25 dBFS: phone microphones put quiet rooms around
 *   -50 to -45 dBFS and close speech around -30 to -15 dBFS.
 * - floorQuantile 0.1: the hold starts before the first word and ends after the last.
 * - hangoverMs 250, minRunMs 120: as in common energy-based detectors; pauses the engine counts
 *   are 700 ms or more (DEFAULT_RETELL_OPTIONS.pauseMs), so merging shorter gaps loses none.
 */
export const DEFAULT_VAD_OPTIONS: Readonly<VadOptions> = {
  marginDb: 9,
  minThresholdDb: -45,
  maxThresholdDb: -25,
  floorQuantile: 0.1,
  hangoverMs: 250,
  minRunMs: 120,
};

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i] as number;
}

/** Voiced runs of a level stream, in time order. Each sample covers the frame before it. */
export function voicedRuns(samples: readonly LevelSample[], opts: Partial<VadOptions> = {}): TimeSpan[] {
  const o: VadOptions = { ...DEFAULT_VAD_OPTIONS, ...opts };
  const clean = samples.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.db)).sort((a, b) => a.t - b.t);
  if (clean.length === 0) return [];
  const gaps = clean.slice(1).map((s, i) => s.t - (clean[i] as LevelSample).t).filter((g) => g > 0).sort((a, b) => a - b);
  const frameMs = o.frameMs ?? Math.min(250, Math.max(10, gaps.length ? quantile(gaps, 0.5) : 50));
  const floor = quantile(clean.map((s) => s.db).sort((a, b) => a - b), o.floorQuantile);
  const threshold = Math.min(o.maxThresholdDb, Math.max(o.minThresholdDb, floor + o.marginDb));

  const runs: TimeSpan[] = [];
  for (const s of clean) {
    if (s.db < threshold) continue;
    const startMs = Math.max(0, s.t - frameMs);
    const last = runs[runs.length - 1];
    if (last && startMs - last.endMs < o.hangoverMs) last.endMs = Math.max(last.endMs, s.t);
    else runs.push({ startMs, endMs: s.t });
  }
  return runs.filter((r) => r.endMs - r.startMs >= o.minRunMs);
}

/** Total length of runs (ms). */
export function totalMs(runs: readonly TimeSpan[]): number {
  return runs.reduce((sum, r) => sum + Math.max(0, r.endMs - r.startMs), 0);
}

/** `runs` cut to `span`, empty pieces dropped. */
function clipRuns(runs: readonly TimeSpan[], span: TimeSpan): TimeSpan[] {
  return runs
    .map((r) => ({ startMs: Math.max(r.startMs, span.startMs), endMs: Math.min(r.endMs, span.endMs) }))
    .filter((r) => r.endMs > r.startMs);
}

/** Words laid end to end over `span`, each taking a share in proportion to its weight. */
function spreadByWeight(texts: readonly string[], span: TimeSpan): TranscriptWord[] {
  const weights = texts.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const length = Math.max(0, span.endMs - span.startMs);
  let acc = 0;
  return texts.map((text, i) => {
    const startMs = Math.round(span.startMs + (length * acc) / total);
    acc += weights[i] as number;
    const endMs = Math.round(span.startMs + (length * acc) / total);
    return { text, startMs, endMs };
  });
}

/**
 * Silences at least this long (ms) separate recognized pieces: Android 13+ and iOS 18+ end a
 * continuous piece at a pause, and the engine counts retell pauses from 700 ms
 * (DEFAULT_RETELL_OPTIONS.pauseMs).
 */
export const PIECE_GAP_MS = 700;

/** Runs grouped where the silence between them is shorter than `gapMs`. */
function clusterRuns(runs: readonly TimeSpan[], gapMs: number): TimeSpan[][] {
  const clusters: TimeSpan[][] = [];
  for (const run of runs) {
    const current = clusters[clusters.length - 1];
    const last = current?.[current.length - 1];
    if (current && last && run.startMs - last.endMs < gapMs) current.push(run);
    else clusters.push([run]);
  }
  return clusters;
}

/**
 * Words over voiced runs: each word goes to the run where the middle of its share of the voiced
 * time falls, and each run's words share that run by length.
 */
function assignToRuns(texts: readonly string[], runs: readonly TimeSpan[]): TranscriptWord[] {
  const weights = texts.map(wordWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const voicedTotal = totalMs(runs);
  const runEnds: number[] = [];
  let accRun = 0;
  for (const r of runs) {
    accRun += r.endMs - r.startMs;
    runEnds.push(accRun / voicedTotal);
  }
  const groups: string[][] = runs.map(() => []);
  let accWeight = 0;
  texts.forEach((text, i) => {
    const w = weights[i] as number;
    const mid = (accWeight + w / 2) / totalWeight;
    accWeight += w;
    let run = runEnds.findIndex((end) => mid <= end);
    if (run < 0) run = runs.length - 1;
    (groups[run] as string[]).push(text);
  });
  return groups.flatMap((group, i) => (group.length ? spreadByWeight(group, runs[i] as TimeSpan) : []));
}

/**
 * Estimated timings for words heard within `span` (the recording, on the session clock).
 * `pieces` are the words of each recognized piece, in order (one piece when unknown).
 * - No voiced runs: the words share the whole span by length.
 * - As many clusters of runs (split at silences of PIECE_GAP_MS or more) as pieces: each piece
 *   goes to its cluster, so a long pause stays exactly where the recognizer split the speech.
 * - Otherwise: every word goes to the run where the middle of its share of the voiced time falls.
 * Within a run, words share it by length. Silences between runs stay between words, so retell
 * pauses show where the learner paused.
 */
export function estimateHeardTimings(
  pieces: readonly (readonly string[])[],
  span: TimeSpan,
  runs: readonly TimeSpan[] = [],
): TranscriptWord[] {
  const groups = pieces.filter((g) => g.length > 0);
  const all = groups.flat();
  if (all.length === 0) return [];
  const safeSpan = { startMs: span.startMs, endMs: Math.max(span.startMs, span.endMs) };
  const voiced = clipRuns(runs, safeSpan);
  if (voiced.length === 0) return spreadByWeight(all, safeSpan);
  if (groups.length > 1) {
    const clusters = clusterRuns(voiced, PIECE_GAP_MS);
    if (clusters.length === groups.length) {
      return groups.flatMap((g, i) => assignToRuns(g, clusters[i] as TimeSpan[]));
    }
  }
  return assignToRuns(all, voiced);
}

/** First word start to last word end (ms); 0 without words. */
export function wordsSpanMs(words: readonly TranscriptWord[] | undefined): number {
  if (!words || words.length === 0) return 0;
  let start = Infinity;
  let end = -Infinity;
  for (const w of words) {
    if (!Number.isFinite(w.startMs) || !Number.isFinite(w.endMs)) continue;
    start = Math.min(start, w.startMs);
    end = Math.max(end, w.endMs);
  }
  return end > start ? end - start : 0;
}

/**
 * Time spent speaking in a transcript (ms), for minutes spoken (the engine's addSpoken):
 * spokenMs when the recognizer measured it, else the span of the words, else durationMs.
 * Typed answers count 0.
 */
export function spokenMsOf(t: FinalTranscript): number {
  if (t.source === 'typed') return 0;
  if (t.spokenMs !== undefined && Number.isFinite(t.spokenMs) && t.spokenMs > 0) return t.spokenMs;
  const span = wordsSpanMs(t.words);
  if (span > 0) return span;
  return Number.isFinite(t.durationMs) ? Math.max(0, t.durationMs) : 0;
}

/**
 * True when measured word timings are usable: finite, starts in order (with jitter), inside the
 * session (with slack). Anything else is estimated instead.
 */
export function timingsLookValid(words: readonly TranscriptWord[], durationMs: number, slackMs = 1000): boolean {
  let prevStart = -Infinity;
  for (const w of words) {
    if (!Number.isFinite(w.startMs) || !Number.isFinite(w.endMs)) return false;
    if (w.startMs < -slackMs || w.endMs > durationMs + slackMs) return false;
    if (w.startMs < prevStart - 100) return false;
    prevStart = Math.max(prevStart, w.startMs);
  }
  return true;
}

function withConfidence(w: TranscriptWord, confidence: number | undefined): TranscriptWord {
  return confidence === undefined ? w : { ...w, confidence };
}
