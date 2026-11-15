/**
 * Language pack contract: everything language-specific about the language being learned.
 * The core engine never assumes that spaces separate words; it always goes through segment().
 */

export type SegmentKind = 'word' | 'punct' | 'space' | 'number';

export interface Segment {
  /** Exact text of the segment. Segments of a text concatenate back to the text. */
  text: string;
  /** Normalized form used for lookups (see LanguagePack.normalize). Empty for spaces. */
  norm: string;
  start: number;
  end: number;
  kind: SegmentKind;
}

export type Pos =
  | 'NOUN' | 'VERB' | 'AUX' | 'ADJ' | 'ADV' | 'DET' | 'PRON'
  | 'ADP' | 'CONJ' | 'PROPN' | 'NUM' | 'INTJ' | 'X';

export type FeatureName = 'gender' | 'number' | 'person' | 'tense' | 'mood' | 'form';

/**
 * Morphological features. Values are short codes:
 * gender m|f, number s|p, person 1|2|3,
 * tense pres|pret|impf|fut|cond, mood ind|sub|imp, form fin|inf|ger|part.
 */
export type Features = Partial<Record<FeatureName, string>>;

export interface Analysis {
  lemma: string;
  pos: Pos;
  features: Features;
}

/** A rule that proposes variants of a learner sentence. Rules are data, not code. */
export type CorrectionRule =
  | SwapRule
  | InflectRule
  | InsertRule
  | DeleteRule;

interface RuleBase {
  id: string;
  /** Key into PairPack.explanations; the explanation shown when this rule wins. */
  explainKey: string;
  /** If true, street register does not apply this rule (the variation is normal there). */
  streetTolerant?: boolean;
}

/**
 * Aligned replacement groups. Any word may be replaced by another word in the same group.
 * Example (ser/estar): [["soy","estoy"],["eres","estás"],["es","está"], ...].
 * Matching uses normalized forms.
 */
export interface SwapRule extends RuleBase {
  kind: 'swap';
  groups: string[][];
}

/**
 * Re-inflect a word with every other value of one feature, using LanguagePack.analyze
 * and LanguagePack.inflect. Example: gender on ADJ and DET, aspect via tense pret|impf
 * on VERB, mood ind|sub on VERB.
 */
export interface InflectRule extends RuleBase {
  kind: 'inflect';
  pos: Pos[];
  feature: FeatureName;
  values: string[];
}

/**
 * Insert a word. Applies before any word whose analysis has one of beforePos,
 * when the previous word is one of afterWords (if given).
 * Example: personal "a" before a person noun or proper noun after a verb.
 */
export interface InsertRule extends RuleBase {
  kind: 'insert';
  word: string;
  beforePos?: Pos[];
  afterPos?: Pos[];
  afterWords?: string[];
}

/** Delete any of these words. Example: an unneeded article or personal "a". */
export interface DeleteRule extends RuleBase {
  kind: 'delete';
  words: string[];
}

export type Formality = 'street' | 'casual' | 'vulgar';

export interface SlangEntry {
  /** Surface form as written in lyrics, e.g. "'tá", "pa'", "janguear". */
  form: string;
  /** Normalized form (LanguagePack.normalize applied to form). */
  norm: string;
  /** Neutral equivalent, e.g. "está", "para", "salir". */
  neutral: string;
  /** Lemma used by the learner model (a slang lexeme is its own lemma). */
  lemma: string;
  /** Glosses by native-language code, e.g. { en: "to hang out" }. */
  gloss: Record<string, string>;
  /** Region codes, e.g. ["PR"], ["PR","DO"], ["CARIB"]. */
  regions: string[];
  formality: Formality;
  explicit: boolean;
  kind: 'word' | 'clipped' | 'phrase';
}

export interface RegisterPack {
  /** e.g. "es-PR". */
  id: string;
  /** Region code used in SlangEntry.regions, e.g. "PR". */
  region: string;
  entries: SlangEntry[];
}

export interface LanguagePack {
  /** BCP 47 code of the language being learned, e.g. "es". */
  readonly code: string;
  /** Split text into segments that cover it completely, spaces included. */
  segment(text: string): Segment[];
  /** Lowercase and trim edge punctuation; keeps accents and in-word apostrophes. */
  normalize(word: string): string;
  /** Possible analyses of a normalized word, most likely first. [] if unknown. */
  analyze(norm: string): Analysis[];
  /** Surface form of lemma with the given features, or undefined if not producible. */
  inflect(lemma: string, features: Features): string | undefined;
  /** 1 = most frequent lemma. undefined if not in the frequency list. */
  frequencyRank(lemma: string): number | undefined;
  readonly rules: readonly CorrectionRule[];
  readonly registers: readonly RegisterPack[];
}
