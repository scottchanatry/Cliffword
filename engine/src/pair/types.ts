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
  /**
   * Optional authored story library: the content of the Story flow. Each story is one
   * episode of a series (LibraryStory.track, .episode, .tier), a short scene with one cliff
   * per line and questions characters ask the learner. Data only; the engine picks the
   * episode, its tier and the cliff mode by the learner's level. docs/STORY-FORMAT.md.
   */
  readonly library?: readonly LibraryStory[];
  /**
   * Optional series ("experiences") the library's stories belong to, in picker order. A
   * track with no story in `library` is shown as coming soon and cannot be started.
   */
  readonly tracks?: readonly LibraryTrack[];
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

/** Regional variety a series is written in (its slang, food and place names). */
export type LibraryDialect = 'mx' | 'ar' | 'pe' | 'cr' | 'pr' | 'co';

/** Version of an episode by learner level: 0-1 beginner, 2-3 intermediate, 4-5 advanced. */
export type LibraryTier = 'beginner' | 'intermediate' | 'advanced';

/** Grammatical gender of a learner's form of address or of a track choice. */
export type LibraryGender = 'm' | 'f';

/**
 * A choice the learner makes when starting a series ("Who do you match with?"). Stories
 * of the track write '{<key>:masculine|feminine}' (agrees with the chosen option's gender)
 * and '{<key>.name}' (the chosen option's label).
 */
export interface LibraryChoice {
  /** Variant key used in the stories, e.g. 'partner'. */
  key: string;
  /** The question in the learner's native language, e.g. 'Who do you match with?'. */
  prompt: string;
  options: { id: string; label: string; gender: LibraryGender }[];
}

/** A recurring character of a series. */
export interface LibraryCastMember {
  /** Stable id, language-neutral, e.g. 'landlady'. Story lines may name it as speaker. */
  id: string;
  /** What the character is in the plot, in plain English: 'the nosy landlady next door'. */
  role: string;
  /** The running gag, in plain English: 'knows everything before it happens'. */
  quirk: string;
  /** The local name in this pair's rendering, e.g. 'Doña Mari'. */
  name: string;
}

/**
 * A series ("experience") of the picker: 8 comedy episodes played in order. The English
 * fields are the card; cast and setting are the language-neutral layer another pair
 * keeps when it re-renders the series.
 */
export interface LibraryTrack {
  /** Stable id, e.g. 'en-es.track.dating'. */
  id: string;
  /** Card title in the learner's native language, e.g. 'Dating in Buenos Aires'. */
  title: string;
  /** One funny line in the learner's native language. */
  tagline: string;
  city: string;
  country: string;
  dialect: LibraryDialect;
  /** Choices asked before the first episode (none for most series). */
  choices?: LibraryChoice[];
  /** Recurring characters: roles and quirks in English, the local name separate. */
  cast: LibraryCastMember[];
  /** One English line on the kind of place, so another pair can pick its own city. */
  setting: string;
}

/**
 * One authored story of the library (PairPack.library): one episode of a series, in one
 * tier. Text is in the target language except the *Native and translation fields and the
 * language-neutral layer (beats, functions, intents, cliff concepts), which is plain
 * English so the episode can be re-rendered for another pair.
 *
 * Gender variants may appear in every text, translation, cliff and turn string:
 * '{you:a|b}' agrees with the learner's form of address (a masculine, b feminine),
 * '{<key>:a|b}' with the gender of a track choice, '{<key>.name}' is that choice's label.
 * The engine resolves them (resolveVariants) before anything is shown, spoken or scored.
 */
export interface LibraryStory {
  /** Stable id, e.g. 'en-es.lib.l0.01'. */
  id: string;
  /** LibraryTrack.id of the series. */
  track: string;
  /** 1-8: episodes play in this order. */
  episode: number;
  /** The same episode is written in up to three versions with the same plot. */
  tier: LibraryTier;
  /** Vocabulary level of the wording: 0 brand new (cognates and taught words) ... 5 intermediate. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  /** The plot in 4-8 plain-English beats, independent of wording (language-neutral). */
  beats: string[];
  /** Syllabus ids taught (engine/src/content/syllabus.ts), e.g. 'greet.hello'. */
  functions: string[];
  /** Title in the target language. */
  title: string;
  /** Title in the learner's native language. */
  titleNative: string;
  /** Names of the people (and animals) in the story; they count as names, not words. */
  characters: string[];
  sentences: LibrarySentence[];
  /** Questions a character asks the learner (learner turns). */
  turns?: LibraryTurn[];
}

/** One sentence of a library story with its cliff. */
export interface LibrarySentence {
  /** Stable id within the story: 'e1.l03' (episode 1, line 3). */
  id: string;
  /**
   * What the line does and means, in plain English, independent of wording and of local
   * color: 'Doña Mari greets you and nosily asks where you are from'.
   */
  intent: string;
  /** Syllabus id the line practises, when it practises one. */
  function?: string;
  /** The sentence in the target language, natural, with its final punctuation. */
  text: string;
  /** The sentence in the learner's native language. */
  translation: string;
  cliff: {
    /** The hidden word(s), an exact substring of text; may be 1-3 words at level 4-5. */
    word: string;
    /** Other natural answers. */
    accept?: string[];
    /** Two plausible-looking words that are wrong in this slot. */
    distractors: [string, string];
    /** Native-language gloss of the cliff word, e.g. 'piano' (bold in the translation at the hint level). */
    hint?: string;
    /** What the gap stands for, in plain English: 'your name', 'the price', 'a color', 'a food'. */
    concept: string;
  };
  /** Who says the line, for dialogue lines: a LibraryCastMember.id (preferred) or a name. */
  speaker?: string;
}

/** A question a story character asks the learner, after a sentence of the story. */
export interface LibraryTurn {
  /** Stable id within the story: 'e1.t01'. */
  id: string;
  /** What the question asks, in plain English: 'Doña Mari asks what you will cook tonight'. */
  intent: string;
  /** Syllabus id the reply practises. */
  function?: string;
  /** Index of the sentence the question follows. */
  after: number;
  /** A LibraryCastMember.id (preferred) or a name. */
  speaker: string;
  /** The question in the target language. */
  line: string;
  /** The question in the learner's native language. */
  translation: string;
  /** A natural answer in the target language. */
  example: string;
}
