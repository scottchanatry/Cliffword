/**
 * Pair pack contract: everything that depends on the learner's native language
 * together with the language being learned (e.g. English speakers learning Spanish).
 */
export interface PairPack {
  /** Learner's native language, e.g. "en". */
  readonly native: string;
  /** Language being learned, e.g. "es". */
  readonly target: string;
  /** Short gloss of a target lemma in the native language. */
  gloss(lemma: string): string | undefined;
  /** Target lemmas a native speaker probably understands on sight or sound (cognates). */
  readonly cognates: ReadonlySet<string>;
  /**
   * Common native-language words, normalized, used to spot native words inside a
   * target-language reply. Excludes words that are also common target words.
   */
  readonly nativeLexicon: ReadonlySet<string>;
  /** Candidate target lemmas for a native word, best first. [] if unknown. */
  toTarget(nativeWord: string): string[];
  /** Explanations shown with corrections, keyed by CorrectionRule.explainKey. */
  readonly explanations: Readonly<Record<string, string>>;
  /** Interface strings in the native language, keyed by id. */
  readonly ui: Readonly<Record<string, string>>;
}
