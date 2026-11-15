/** Shared result types for scoring. Used by scoring, corrections, story and the app. */
import type { Segment } from '../lang/types';

/** 0 = expected, 3 = very surprising. Drives the amber shading. */
export type Heat = 0 | 1 | 2 | 3;

export interface WordScore {
  segment: Segment;
  /** Index of this word among the word segments of the scored text. */
  wordIndex: number;
  /** log P(word | everything before it), summed over its tokens. */
  logprob: number;
  /** -logprob. */
  surprisal: number;
  heat: Heat;
}

export interface NextWord {
  /** Surface form as the model produced it, without leading space. */
  word: string;
  /** Normalized form (LanguagePack.normalize). */
  norm: string;
  logprob: number;
  prob: number;
}

/** How well a word position works as a cliff. */
export interface CliffPosition {
  wordIndex: number;
  segment: Segment;
  /**
   * log P(actual word | context up to it), as a whole word: the sum of its tokens plus,
   * by default, the log of the end-of-word (boundary) mass, so it is on the same scale as
   * the alternatives (see CliffOptions.actualBoundary in scoring/cliff.ts).
   */
  actualLogprob: number;
  /** Most likely next words at this position, most likely first. */
  alternatives: NextWord[];
  /** Number of alternatives with probability above the plausibility floor. */
  plausibleCount: number;
}

export type Credit = 'full' | 'partial' | 'none';

export type CreditReason =
  /** The answer is the story's actual word(s). */
  | 'actual'
  /** Probable enough to count as natural. */
  | 'likely'
  /** Possible but unusual. */
  | 'plausible'
  /** Right word, wrong form (e.g. wrong tense or gender). */
  | 'form'
  /** Not a natural continuation. */
  | 'unlikely';

export interface CliffResult {
  /** The answer exactly as given. */
  answer: string;
  /**
   * The text that was actually scored or matched, after trimming, case adjustment and
   * accent restoration ("reir" -> "reír"). Optional for producers other than
   * scoreCliffAnswer; '' when the answer had no words.
   */
  scored?: string;
  logprob: number;
  prob: number;
  /** 1-based rank among alternatives, or null if not among them. */
  rank: number | null;
  credit: Credit;
  reason: CreditReason;
  alternatives: NextWord[];
}
