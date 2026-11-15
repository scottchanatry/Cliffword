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
  /**
   * Candidate target lemmas for a native word or short phrase ("hardware store"), best
   * first. [] if unknown. A candidate may be a dictionary form that is not the pack's
   * lemma (a feminine person noun such as "chica"); run LanguagePack.analyze on it to get
   * the lemma for a learner key.
   */
  toTarget(nativeWord: string): string[];
  /**
   * Optional false-friend warnings, keyed by target lemma: shown when the learner meets
   * a target word that looks like a native word but means something else
   * (es "embarazada" is not en "embarrassed").
   */
  readonly falseFriends?: Readonly<Record<string, string>>;
  /** Explanations shown with corrections, keyed by CorrectionRule.explainKey. */
  readonly explanations: Readonly<Record<string, string>>;
  /** Interface strings in the native language, keyed by id. */
  readonly ui: Readonly<Record<string, string>>;
  /**
   * Optional canned first story for a zero-knowledge start and for canned mode (before
   * the model is downloaded and loaded): cognate-heavy sentences with option cliffs and
   * listed answers, a placement ladder, and questions a story character asks. The
   * session module (engine/src/session) reads it; it never needs a model.
   */
  readonly starter?: StarterStory;
}

/**
 * One canned sentence with its cliff. All text is in the target language except
 * `translation`. The session locates `answer` in `text` with LanguagePack.segment (never
 * by spaces): the last run of word segments whose normalized forms equal the answer's,
 * never the first word of the sentence.
 */
export interface StarterSentence {
  /** The sentence, with its final punctuation. */
  readonly text: string;
  /** The hidden words exactly as they appear in `text` (the cliff's actual answer). */
  readonly answer: string;
  /**
   * One or two answers that are not natural continuations, for the options rung (two
   * or three spoken options). Without a model they cannot be checked, so they are data.
   */
  readonly distractors: readonly string[];
  /** Other natural answers, credited in full by string and form match without a model. */
  readonly accept?: readonly string[];
  /** The sentence in the learner's native language (the "what does it mean" command). */
  readonly translation?: string;
}

/** A question a story character asks the learner (a learner turn). */
export interface StarterPrompt {
  /** The question in the target language. */
  readonly line: string;
  /** Who asks; StarterStory.character when omitted. */
  readonly speaker?: string;
}

/** The canned first story of a pair (PairPack.starter). */
export interface StarterStory {
  /** Stable id, stored in session snapshots. */
  readonly id: string;
  /** Title in the target language. */
  readonly title: string;
  /** The main character's name: the default speaker of prompts. */
  readonly character: string;
  /**
   * Function-word lemmas the first story teaches explicitly (shown as new words with a
   * gloss). With the pair's cognates they are all a zero-knowledge learner needs.
   */
  readonly taught: readonly string[];
  /** The zero-knowledge story, in order. */
  readonly sentences: readonly StarterSentence[];
  /**
   * Placement ladder: sentences whose cliff words come from increasingly rare frequency
   * bands, used by placement when there is no model, or when a generated sentence does
   * not carry the probe word.
   */
  readonly probes?: readonly StarterSentence[];
  /** Questions for learner turns ("Marta asks you"). */
  readonly prompts?: readonly StarterPrompt[];
}
