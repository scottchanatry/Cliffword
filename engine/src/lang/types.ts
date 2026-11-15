/**
 * Language pack contract: everything language-specific about the language being learned.
 * The core engine never assumes that spaces separate words; it always goes through segment().
 */

/**
 * Kinds of segment. There is no separate symbol kind: emoji and other symbols are
 * 'punct'.
 */
export type SegmentKind = 'word' | 'punct' | 'space' | 'number';

export interface Segment {
  /** Exact text of the segment. Segments of a text concatenate back to the text. */
  text: string;
  /**
   * Normalized form used for lookups (see LanguagePack.normalize). Empty for spaces.
   * For punct and number segments it is the text itself in canonical form (Unicode NFC,
   * typographic apostrophes unified), not normalize() of it, which would be ''.
   */
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
 *
 * Conventions every pack and rule follows:
 * - finite verb forms may carry form 'fin', so learner form keys must be built from
 *   analyze() output, never from hand-written features;
 * - an imperative has mood 'imp' and no tense, so a rule that switches mood ind|sub
 *   never produces or re-inflects an imperative.
 */
export type Features = Partial<Record<FeatureName, string>>;

export interface Analysis {
  lemma: string;
  pos: Pos;
  features: Features;
}

/** Where a word stands, for LanguagePack.chooseAnalysis. */
export interface AnalysisContext {
  /**
   * The chosen analysis of the previous word, when only spaces separate the two words
   * (undefined at a sentence start or after punctuation). A capitalized word the pack
   * does not know, away from a sentence start, is passed as a PROPN analysis.
   */
  prev?: Analysis;
  /** True when the word opens its sentence. */
  sentenceStart: boolean;
}

/** A rule that proposes variants of a learner sentence. Rules are data, not code. */
export type CorrectionRule =
  | SwapRule
  | InflectRule
  | InsertRule
  | DeleteRule
  | MoveRule;

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
  /**
   * Optional context condition: the word is swapped only when the next word (only
   * spaces in between) has one of these normalized forms. Spanish: le and les become se
   * before lo, la, los, las ("Le lo di" -> "Se lo di").
   */
  beforeWords?: string[];
  /**
   * Optional context condition: the word is swapped only when the previous word (only
   * spaces in between) has one of these normalized forms.
   */
  afterWords?: string[];
  /**
   * Optional: only words with these normalized forms are replaced; the other members of
   * their groups are targets only (a one-way swap). Spanish "se lo" is never "le lo", so
   * le/les -> se must not also propose se -> le.
   */
  fromWords?: string[];
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
  /**
   * Optional context condition: a word whose current value is in cueFor (every value when
   * cueFor is omitted) is re-inflected only when one of these words (normalized) occurs
   * earlier in its sentence. Spanish mood: an indicative verb gets a subjunctive variant
   * only after que, ojalá, cuando...; a subjunctive verb always gets the indicative.
   */
  cueWords?: string[];
  cueFor?: string[];
}

/**
 * Insert a word. Applies before any word whose analysis has one of beforePos (any word
 * when beforePos is not given).
 *
 * Left neighbour: when afterPos or afterWords (or both) is given, the previous word must
 * be adjacent (only spaces in between; punctuation breaks adjacency) and must have an
 * analysis in afterPos OR a normalized form in afterWords. When neither is given, the
 * word may also be inserted at the start of a sentence. A rule inserts one word; a
 * language with several candidate words (articles) lists one rule per word under the
 * same explainKey. Contractions (Spanish a + el = al) are not produced.
 * Example: personal "a" before a person noun or proper noun after a verb.
 *
 * Parts of speech and lemmas are those of the analysis chosen for each word in context
 * (lang/choose.ts). The optional fields below refine where the word goes.
 */
export interface InsertRule extends RuleBase {
  kind: 'insert';
  word: string;
  beforePos?: Pos[];
  /** Lemmas that also qualify a word to insert before (person nouns for the personal a). */
  beforeLemmas?: string[];
  /**
   * Parts of speech that may stand between the insert and the word matched by beforePos
   * or beforeLemmas; the word goes in front of the first of them ("Veo [a] mi madre").
   */
  throughPos?: Pos[];
  afterPos?: Pos[];
  afterWords?: string[];
  /** Never insert directly after these words (normalized): "al" and "del" hold an article. */
  notAfterWords?: string[];
  /** Never insert directly before these words (normalized): "a" + "el" must be "al". */
  notBeforeWords?: string[];
  /**
   * Words (normalized) before which the gender and number agreement check is skipped:
   * "el agua", "un hacha" (feminine nouns that start with a stressed a).
   */
  agreementExceptions?: string[];
}

/** Delete any of these words. Example: an unneeded article or personal "a". */
export interface DeleteRule extends RuleBase {
  kind: 'delete';
  words: string[];
}

/**
 * Where moved words stand relative to their anchor: as separate words before it, as
 * separate words after it, or attached to it (LanguagePack.attachClitic).
 */
export type MovePosition = 'before' | 'after' | 'attach';

/**
 * Move words (object pronouns, clitics) to where they belong next to an anchor word (a
 * verb). Spanish: before a finite verb (lo compré), attached to an infinitive, gerund or
 * affirmative command (quiero verte, estoy leyéndolo, hazlo).
 *
 * The rule states where the words belong; the generator proposes moving words that are
 * out of place. Words of `words` that stand next to each other (only spaces between)
 * form a cluster and move together, in their order. A cluster next to an anchor is out
 * of place when no move rule whose context holds allows its position for any reading
 * of the anchor (any analysis, not only the chosen one: "lo ve" is fine because ve is
 * also a finite form of ver); a cluster between two anchors is out of place only when
 * neither allows it ("Al llegar me llamó" is fine). Clitics attached to an anchor
 * (found with LanguagePack.splitClitics) are in place when the pack analyzes the whole
 * word as a form of a verb (its analyzer knows which hosts take clitics) and no rule
 * with an afterWords context forbids attaching there, or when a rule allows 'attach'.
 * An out-of-place cluster gets one variant per position in `positions` of each rule that
 * matches the anchor: its chosen analysis, or another reading of the same lemma and part
 * of speech ("Mira la" gets "La mira" from the finite rule and "Mírala" from the command
 * rule). Each variant's edit span covers the moved cluster and the anchor.
 *
 * The chosen analysis is the one chosen for the anchor in context (lang/choose.ts); for
 * a word with attached clitics the pack does not analyze, the first analysis of its host.
 */
export interface MoveRule extends RuleBase {
  kind: 'move';
  /** The words that move, normalized. Spanish: me te se nos os lo la los las le les. */
  words: string[];
  /** Parts of speech of the anchor word the words belong to (VERB, AUX). */
  anchorPos: Pos[];
  /**
   * Forms the anchor may have: 'inf', 'ger', 'part' (its form feature), 'imp' (an
   * imperative, mood imp) or 'fin' (any other finite form: indicative or subjunctive).
   * Any form when omitted.
   */
  anchorForms?: string[];
  /**
   * Where the words belong for such an anchor. An empty list never moves anything; a
   * rule with `order` and no positions only reorders clusters.
   */
  positions: MovePosition[];
  /**
   * Optional context condition: the rule applies only when the word before the anchor
   * (skipping a cluster of `words` directly before it; only spaces in between) has one
   * of these normalized forms. Spanish negative commands: after no, nunca, jamás.
   */
  afterWords?: string[];
  /** Optional: the rule does not apply when the word before the anchor (as above) has one of these forms. */
  notAfterWords?: string[];
  /**
   * Optional: when this rule moves a cluster, the anchor is re-inflected with its chosen
   * analysis's features overridden by these (pack.inflect). Spanish: a negative command
   * is the present subjunctive, so "No hazlo" becomes "No lo hagas" with
   * { mood: 'sub', tense: 'pres' }. No variant when the pack cannot produce the form.
   */
  inflectAnchor?: Features;
  /**
   * Optional cluster order: groups of words, every word of an earlier group before every
   * word of a later group. A cluster next to an anchor (separate or attached) whose words
   * are out of this order gets one variant with the same words in order (Spanish
   * "Lo te digo" -> "Te lo digo"). Words in the same group are never reordered.
   */
  order?: string[][];
  /**
   * Optional: words of `words` that are also other words (Spanish lo, la, los, las are
   * also articles: "Veo la casa", "Es lo que quiero"). Such a word counts as a movable
   * word only when the next word is known to the pack, its chosen part of speech is not
   * in notBeforePos and its form is not in notBeforeWords; a number right after it, or
   * an unknown word (most likely a noun or adjective outside the lexicon), also keeps it
   * as the other word. Punctuation or the end of the text after it leaves it movable.
   */
  homographs?: string[];
  /** See homographs. Spanish: NOUN, ADJ, DET, NUM, PRON, PROPN. */
  notBeforePos?: Pos[];
  /** See homographs (normalized). Spanish: que, de, más... ("lo que", "la de", "lo más"). */
  notBeforeWords?: string[];
}

export type Formality = 'street' | 'casual' | 'vulgar';

export interface SlangEntry {
  /** Surface form as written in lyrics, e.g. "'tá", "pa'", "janguear". */
  form: string;
  /**
   * Part of speech of the slang word. Optional: when absent, packs take it from the
   * analysis of `neutral`. Give it when `neutral` is outside the pack's lexicon or has
   * another part of speech first, so the pack can still inflect the slang word.
   */
  pos?: Pos;
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
  /**
   * True when the form (every word of a phrase) is also a standard word of the language
   * (guapo, bajo, "de una"). Correction variants protect slang words in every register
   * except these, which neutral register corrects like any other word.
   */
  alsoStandard?: boolean;
}

export interface RegisterPack {
  /** e.g. "es-PR". */
  id: string;
  /** Region code used in SlangEntry.regions, e.g. "PR". */
  region: string;
  entries: SlangEntry[];
  /**
   * Optional context line put before street-register text when it is scored, with
   * "{words}" where the slang words to name go. Proof test: naming a word in this line
   * cut its surprisal sharply (janguear 27 to 3 nats) while unnamed slang stayed very
   * surprising, so scoringContext() names the slang found in the text. See
   * scoring/context.ts.
   */
  scoringPrefix?: string;
}

/**
 * Register the learner speaks or reads in. Street register tolerates the rules marked
 * streetTolerant and is the register of the slang packs; neutral is the standard
 * language. Shared by corrections (which rules apply) and story (prompt wording).
 */
export type Register = 'neutral' | 'street';

/**
 * Things a learner can say instead of an answer: hear it again, hear it slower, "I don't
 * know", go on, finish, ask what something means. The speaking module matches a
 * recognized utterance against LanguagePack.commands.
 */
export type SpokenCommand = 'again' | 'slower' | 'dont_know' | 'next' | 'done' | 'meaning';

/** The phrases that say one spoken command in the language being learned. */
export interface SpokenCommandEntry {
  command: SpokenCommand;
  /**
   * Whole phrases, lowercase, written as the pack spells them (accents included), words
   * separated by single spaces, without punctuation: "otra vez", "no lo sé".
   */
  phrases: string[];
}

/** Result of LanguagePack.splitClitics: a host word and the clitics attached to it, in order. */
export interface CliticSplit {
  /** The host as a word of its own (normalized, written accents restored or removed): "leyendo", "haz". */
  host: string;
  /** Attached clitics, normalized, in their order on the word: ["me", "lo"] for "dámelo". */
  clitics: string[];
}

export interface LanguagePack {
  /** BCP 47 code of the language being learned, e.g. "es". */
  readonly code: string;
  /** Split text into segments that cover it completely, spaces included. */
  segment(text: string): Segment[];
  /**
   * Lowercase and trim edge punctuation; keeps accents and in-word apostrophes. Edge
   * apostrophes that mark a clipped form ('tá, pa') are kept where the language uses
   * them; a pair of apostrophes used as quote marks is removed.
   */
  normalize(word: string): string;
  /**
   * Optional: remove the marks a learner may leave out ("reir" for "reír"), for
   * accent-insensitive comparison of answers. Only marks that are accents in this
   * language are removed (Spanish keeps ñ; Japanese never loses dakuten). When absent,
   * callers fall back to a configurable set of combining marks.
   */
  foldAccents?(word: string): string;
  /** Possible analyses of a normalized word, most likely first. [] if unknown. */
  analyze(norm: string): Analysis[];
  /**
   * Optional: pick one of `analyses` (from analyze) for a word in context, for example
   * the noun after a determiner (la comida) and the participle after an auxiliary (he
   * estado). Must return an element of `analyses`, or undefined when it is empty. When
   * absent, callers take the first analysis. See lang/choose.ts.
   */
  chooseAnalysis?(analyses: readonly Analysis[], context: AnalysisContext): Analysis | undefined;
  /** Surface form of lemma with the given features, or undefined if not producible. */
  inflect(lemma: string, features: Features): string | undefined;
  /** 1 = most frequent lemma. undefined if not in the frequency list. */
  frequencyRank(lemma: string): number | undefined;
  /**
   * Optional: the frequency list itself, most frequent lemma first, so that
   * frequencyList[i] has rank i + 1. Needed to enumerate words (vocabulary estimates,
   * choosing new target words, picking placement words in a rank band); frequencyRank
   * alone can only look words up.
   */
  readonly frequencyList?: readonly string[];
  readonly rules: readonly CorrectionRule[];
  readonly registers: readonly RegisterPack[];
  /**
   * Optional fixed context put before a learner's sentence when it is scored (Spanish:
   * "Frase en español:\n"). Proof test: without it, correct-vs-incorrect accuracy fell
   * from 97% to 85% and the flag threshold rose from 0 to 3.5-5.5 nats. Every score that
   * is compared with another must use the same prefix. See scoring/context.ts.
   */
  readonly scoringPrefix?: string;
  /**
   * Optional: attach a clitic to the end of a host word, respelling the host as the
   * language requires (normalized, lowercase in and out). Spanish keeps the host's
   * stress with a written accent: leyendo + lo -> leyéndolo, haz + lo -> hazlo, and
   * applied twice da + me -> dame, dame + lo -> dámelo. Move rules propose 'attach'
   * positions only when the pack has it.
   */
  attachClitic?(host: string, clitic: string): string;
  /**
   * Optional: split clitics attached to a word (normalized) off their host: dámelo ->
   * { host: "da", clitics: ["me", "lo"] }, compróla -> { host: "compró", clitics:
   * ["la"] }. undefined when the word is a form of its own (vale is not va + le) or no
   * split leaves a verb form. Move rules see attached clitics only when the pack has it.
   */
  splitClitics?(word: string): CliticSplit | undefined;
  /**
   * Optional: spoken commands in this language (again, slower, "I don't know"...), for
   * the speaking module. Each command appears at most once; a phrase belongs to one
   * command only.
   */
  readonly commands?: readonly SpokenCommandEntry[];
}
