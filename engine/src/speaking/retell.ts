/**
 * Timed retell: the learner retells a scene aloud in three shrinking lanes (60, 45 and
 * 30 seconds). Each round reports words per minute and the pauses, drawn as holes
 * between word tiles; progress compares the first and the latest round ("71 -> 84 words
 * a minute", "5 -> 1 pauses"). Optional content coverage says which story words the
 * retell used. No accent or pronunciation score.
 *
 * Input is speech-recognition word timings (TimedWord), relative to the lane start by
 * default. Nothing here reads the clock.
 */
import type { LanguagePack, Pos } from '../lang/types';
import { chooseAnalysesInText } from '../lang/choose';
import { sentenceStartFlags } from '../story/text';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import type { UiText } from './text';
import { looseKey } from './text';

/** One recognized word with its timing (ms; relative to the lane start unless laneStartMs says otherwise). */
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** The three retell lanes of the design (B3-Voice-Retell): 60, 45 and 30 seconds. */
export const RETELL_LANES: readonly number[] = [60000, 45000, 30000];

/** Tunable numbers of retell metrics. */
export interface RetellOptions {
  /** Length of this round's lane (ms). Words starting after the lane ends are dropped. Infinity: no limit. */
  laneMs: number;
  /** A silence between two words at least this long (ms) is a pause. */
  pauseMs: number;
  /** When the lane started, on the same clock as the word timings (ms). */
  laneStartMs: number;
  /** Count the silence before the first word as a pause (afterIndex -1). */
  countLeadingSilence: boolean;
  /** Words per minute divide by at least this span (ms), so two quick words are not 200 a minute. */
  minSpanMs: number;
}

/**
 * Defaults.
 * - laneMs 60000: the first lane.
 * - pauseMs 700 (judgement): pauses at phrase boundaries and breaths in fluent speech
 *   are mostly shorter than this, and recognizer word timings jitter by around a tenth
 *   of a second, so 700 ms keeps the hesitations a listener notices: a handful per
 *   minute, as in the design (5 in round 1, 1 in round 2).
 * - countLeadingSilence false: time before the first word is thinking time, not a
 *   pause inside the retell.
 * - minSpanMs 1000: below a second, a rate is noise.
 */
export const DEFAULT_RETELL_OPTIONS: Readonly<RetellOptions> = {
  laneMs: 60000,
  pauseMs: 700,
  laneStartMs: 0,
  countLeadingSilence: false,
  minSpanMs: 1000,
};

/** A silence at least pauseMs long. */
export interface RetellPause {
  /** Index (in RetellMetrics.words) of the word before the pause; -1 for the leading silence. */
  afterIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface RetellMetrics {
  /** The words kept: sorted by start, inside the lane, empty texts dropped, ends clipped to the lane. */
  words: TimedWord[];
  wordCount: number;
  /** wordCount per minute of spokenMs (at least minSpanMs); 0 with no words. Not rounded. */
  wordsPerMinute: number;
  pauses: RetellPause[];
  pauseCount: number;
  /** From the first word's start to the last word's end, inside the lane (ms): the time spent speaking. */
  spokenMs: number;
  /** The lane length used (ms). */
  laneMs: number;
  /** Words dropped because they started after the lane ended. */
  overrun: number;
  /** Silence from the lane start to the first word (ms); 0 with no words. */
  leadingSilenceMs: number;
}

/** Words of a round with clean timings: finite numbers, end not before start, non-empty text, sorted by start (stable). */
function cleanWords(words: readonly TimedWord[]): TimedWord[] {
  return words
    .filter((w) => w.text.trim() !== '' && Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
    .map((w) => ({ text: w.text, startMs: w.startMs, endMs: Math.max(w.startMs, w.endMs) }))
    .map((w, i) => ({ w, i }))
    .sort((x, y) => x.w.startMs - y.w.startMs || x.i - y.i)
    .map((x) => x.w);
}

/**
 * Metrics of one retell round: words per minute over the time spent speaking (first
 * word start to last word end, so pauses lower the rate), the pauses (silences of at
 * least pauseMs between words, with the index of the word before each, for drawing
 * holes between tiles) and their count. Words that start after the lane ends are
 * dropped and counted as overrun; a word running past the end is clipped to it.
 */
export function retellMetrics(words: readonly TimedWord[], opts: Partial<RetellOptions> = {}): RetellMetrics {
  const o: RetellOptions = { ...DEFAULT_RETELL_OPTIONS, ...opts };
  const limited = Number.isFinite(o.laneMs) && o.laneMs > 0;
  const laneEnd = limited ? o.laneStartMs + o.laneMs : Infinity;
  const all = cleanWords(words);
  const kept: TimedWord[] = [];
  let overrun = 0;
  for (const w of all) {
    if (w.startMs >= laneEnd) {
      overrun++;
      continue;
    }
    const startMs = Math.max(w.startMs, o.laneStartMs);
    kept.push({ text: w.text, startMs, endMs: Math.max(startMs, Math.min(w.endMs, laneEnd)) });
  }
  const first = kept[0];
  const last = kept[kept.length - 1];
  const pauses: RetellPause[] = [];
  let leadingSilenceMs = 0;
  let spokenMs = 0;
  if (first && last) {
    leadingSilenceMs = first.startMs - o.laneStartMs;
    if (o.countLeadingSilence && leadingSilenceMs >= o.pauseMs) {
      pauses.push({ afterIndex: -1, startMs: o.laneStartMs, endMs: first.startMs, durationMs: leadingSilenceMs });
    }
    // Overlapping timings: a gap is measured from the latest end so far.
    let reach = first.endMs;
    for (let i = 1; i < kept.length; i++) {
      const w = kept[i] as TimedWord;
      const gap = w.startMs - reach;
      if (gap >= o.pauseMs) pauses.push({ afterIndex: i - 1, startMs: reach, endMs: w.startMs, durationMs: gap });
      reach = Math.max(reach, w.endMs);
    }
    spokenMs = reach - first.startMs;
  }
  const wordCount = kept.length;
  const wordsPerMinute = wordCount > 0 ? (wordCount * 60000) / Math.max(spokenMs, o.minSpanMs) : 0;
  return {
    words: kept,
    wordCount,
    wordsPerMinute,
    pauses,
    pauseCount: pauses.length,
    spokenMs,
    laneMs: limited ? o.laneMs : Infinity,
    overrun,
    leadingSilenceMs,
  };
}

/** Time left in a lane (ms), never negative. */
export function laneRemainingMs(laneMs: number, elapsedMs: number): number {
  return Math.max(0, laneMs - Math.max(0, elapsedMs));
}

/**
 * "Round {round} of {rounds}: {seconds} seconds" for a 0-based round index, as a
 * PairPack.ui lookup ('retell.round' by default). Out-of-range rounds are clamped.
 */
export function retellRoundUi(round: number, lanes: readonly number[] = RETELL_LANES, key = 'retell.round'): UiText {
  const r = Math.min(Math.max(0, Math.floor(round)), Math.max(0, lanes.length - 1));
  return { key, params: { round: r + 1, rounds: lanes.length, seconds: Math.round((lanes[r] ?? 0) / 1000) } };
}

/** A change between the first and the latest round, in whole units for display. */
export interface RetellChange {
  from: number;
  to: number;
  /** to - from. */
  change: number;
}

export interface RetellProgress {
  /** Rounds compared. */
  rounds: number;
  /** Words per minute, first round -> latest, rounded to whole words. */
  wordsPerMinute: RetellChange;
  /** Pauses, first round -> latest. */
  pauses: RetellChange;
  /** The latest round is faster than the first. */
  faster: boolean;
  /** The latest round has fewer pauses than the first. */
  fewerPauses: boolean;
}

/**
 * Progress across rounds: first round against the latest (the design's "71 -> 84 words
 * a minute" and "5 -> 1 pauses"). null with no rounds; with one round, from equals to.
 */
export function retellProgress(rounds: readonly Pick<RetellMetrics, 'wordsPerMinute' | 'pauseCount'>[]): RetellProgress | null {
  const first = rounds[0];
  const last = rounds[rounds.length - 1];
  if (!first || !last) return null;
  const wFrom = Math.round(first.wordsPerMinute);
  const wTo = Math.round(last.wordsPerMinute);
  return {
    rounds: rounds.length,
    wordsPerMinute: { from: wFrom, to: wTo, change: wTo - wFrom },
    pauses: { from: first.pauseCount, to: last.pauseCount, change: last.pauseCount - first.pauseCount },
    faster: last.wordsPerMinute > first.wordsPerMinute,
    fewerPauses: last.pauseCount < first.pauseCount,
  };
}

/** Tunable data of content coverage. */
export interface CoverageOptions {
  /** Parts of speech that carry the content of a story (its lemmas are what a retell should reuse). */
  contentPos: readonly Pos[];
  /**
   * Count words the pack does not know as content, by their normalized form: function
   * words are all in a pack's lexicon, so an unknown word is almost always a name or a
   * rare noun ("Marta" opening a sentence).
   */
  unknownAsContent: boolean;
  /** Combining marks folded when the pack has no foldAccents. */
  marks: string;
}

/**
 * Defaults: nouns, verbs, adjectives and names carry a scene; function words, adverbs
 * ("muy", "no") and auxiliaries say little about whether the retell covered it.
 */
export const DEFAULT_COVERAGE_OPTIONS: Readonly<CoverageOptions> = {
  contentPos: ['NOUN', 'VERB', 'ADJ', 'PROPN'],
  unknownAsContent: true,
  marks: DEFAULT_ACCENT_MARKS,
};

/**
 * Content lemmas of a text, unique, in text order: the lemma of the analysis chosen in
 * context (lang/choose.ts) for each word whose part of speech is in contentPos, and the
 * normalized form of each word the pack does not know (unknownAsContent).
 */
export function contentLemmas(
  text: string,
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'analyze' | 'chooseAnalysis' | 'abbreviations'>,
  opts: Partial<CoverageOptions> = {},
): string[] {
  const o: CoverageOptions = { ...DEFAULT_COVERAGE_OPTIONS, ...opts };
  const segments = pack.segment(text);
  const chosen = chooseAnalysesInText(pack, segments, sentenceStartFlags(segments, pack.abbreviations ?? []));
  const out: string[] = [];
  for (const c of chosen) {
    let lemma: string | undefined;
    if (c.chosen) {
      if (o.contentPos.includes(c.chosen.pos)) lemma = c.chosen.lemma;
    } else if (o.unknownAsContent) {
      lemma = c.norm;
    }
    if (lemma && !out.includes(lemma)) out.push(lemma);
  }
  return out;
}

export interface RetellCoverage {
  /** Story lemmas the retell used, in story order. */
  covered: string[];
  /** Story lemmas it did not use, in story order. */
  missing: string[];
  total: number;
  /** covered / total; 0 when the story has no content lemma. */
  share: number;
}

/**
 * Which content lemmas of the story the retell used. `story` is the story text (its
 * content lemmas are taken with contentLemmas) or the lemmas themselves. The retell is a
 * transcript or its timed words; each word is analyzed through the pack (any part of
 * speech, so a story noun retold counts), unknown words by their normalized form.
 * Lemmas compare loosely (case and accents ignored).
 */
export function retellCoverage(
  said: string | readonly TimedWord[],
  story: string | Iterable<string>,
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'analyze' | 'chooseAnalysis' | 'foldAccents' | 'abbreviations'>,
  opts: Partial<CoverageOptions> = {},
): RetellCoverage {
  const o: CoverageOptions = { ...DEFAULT_COVERAGE_OPTIONS, ...opts };
  const storyLemmas = typeof story === 'string' ? contentLemmas(story, pack, o) : [...new Set(story)];
  const saidKeys = new Set<string>();
  const texts = typeof said === 'string' ? [said] : said.map((w) => w.text);
  for (const text of texts) {
    const segments = pack.segment(text);
    for (const c of chooseAnalysesInText(pack, segments, sentenceStartFlags(segments, pack.abbreviations ?? []))) {
      saidKeys.add(looseKey(pack, c.chosen?.lemma ?? c.norm, o.marks));
      // Any reading of the word counts: a retold "comida" covers the story's noun even
      // when the retell's context picks another analysis.
      for (const a of c.analyses) saidKeys.add(looseKey(pack, a.lemma, o.marks));
    }
  }
  const covered: string[] = [];
  const missing: string[] = [];
  for (const lemma of storyLemmas) (saidKeys.has(looseKey(pack, lemma, o.marks)) ? covered : missing).push(lemma);
  return { covered, missing, total: storyLemmas.length, share: storyLemmas.length ? covered.length / storyLemmas.length : 0 };
}
