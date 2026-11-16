/**
 * Story-generation data of a language pack (LanguagePack.story): every word the story
 * module writes into a generation prompt or looks for in model output, in the language
 * being learned. The story module itself holds no words of any language: a pack without
 * this data gets a bare continuation prompt (the tagged story lines only, see
 * story/prompt.ts) and no language-specific cleaning or leak checks.
 *
 * Templates use {name} placeholders. Everything is plain data (strings and numbers), so
 * a pack can be loaded from JSON.
 */

/** Wording of the continuation prompt (story/prompt.ts buildStoryPrompt). */
export interface StoryPromptText {
  /**
   * First line: what the text is. Placeholders {level} (`level` filled in, or '' when
   * the pack has no level for the learner) and {lengthHint} (`lengthHint` filled in, or
   * ''). Spanish: "Cuento en español{level}.{lengthHint}".
   */
  readonly header: string;
  /** The level inside the header: {name} (a StoryLanguageData.levels name). Spanish: " (nivel {name})". */
  readonly level: string;
  /** The length hint inside the header: {text} (a lengthHints text). Spanish: " {text}". */
  readonly lengthHint: string;
  /** The story's characters: {names}. Spanish: "Personajes: {names}." */
  readonly characters: string;
  /** The scene: {scene}. Spanish: "Lugar: {scene}." */
  readonly scene: string;
  /** Words the reader knows (only for small vocabularies): {words}. Spanish: "Palabras: {words}." */
  readonly vocabulary: string;
  /** Separator between listed words and names. Spanish ", ". */
  readonly listSeparator: string;
  /** Street register line: {region} is streetRegion filled in, or ''. */
  readonly street: string;
  /** Inserted into `street` when a region is given: {region} (a region name). */
  readonly streetRegion: string;
}

/**
 * Wording of the older instruction prompt (story/prompt.ts buildContinuationPrompt,
 * kept for callers that still use it). Placeholders: {max} (maximum words), {words}
 * (target words), {region} (region name).
 */
export interface StoryInstructionText {
  /** Task line when the story has sentences. */
  readonly task: string;
  /** Task line when the story is empty. */
  readonly taskFirst: string;
  /** Task line of the simpler retry prompt. */
  readonly taskSimple: string;
  readonly length: string;
  readonly oneTarget: string;
  readonly manyTargets: string;
  readonly simpleWords: string;
  readonly veryEasyWords: string;
  readonly neutral: string;
  readonly street: string;
  /** Inserted into `street` as {region} when a region is given. */
  readonly streetRegion: string;
  readonly answerOnly: string;
  readonly storyLabel: string;
  readonly nextLabel: string;
  readonly firstLabel: string;
  /** Separator between target words, and before the last one. */
  readonly listSeparator: string;
  readonly listLastSeparator: string;
}

/** One example story line: the sentence and the word its tag names. */
export interface StoryExample {
  readonly tag: string;
  readonly text: string;
}

export interface StoryLanguageData {
  /** Continuation prompt wording. */
  readonly prompt: StoryPromptText;
  /**
   * Level names by estimated vocabulary (lexemes known for meaning), lowest first: the
   * first entry whose upTo is at least the learner's vocabulary names the level in the
   * header. None: the header gets no level.
   */
  readonly levels?: readonly { readonly upTo: number; readonly name: string }[];
  /**
   * Length hints by the longest sentence allowed (DifficultyParams.sentenceWords.max),
   * shortest first: the first entry whose maxWords is at least that length is added to
   * the header ("Frases cortas."). None for longer sentences.
   */
  readonly lengthHints?: readonly { readonly maxWords: number; readonly text: string }[];
  /**
   * In-style example lines put before the story when it has fewer sentences than the
   * prompt shows, so the model sees the tagged-line format from the first sentence on.
   */
  readonly examples?: readonly StoryExample[];
  /** Region code (SlangEntry.regions) to the name used in the street line. */
  readonly regionNames?: Readonly<Record<string, string>>;
  /** Wording of the older instruction prompt. */
  readonly instructions?: StoryInstructionText;
  /**
   * Regular-expression sources, tested with the "u" flag on accent-folded lowercase
   * text (story/text.ts foldForMatch), that reveal echoed instructions or meta talk in
   * this language ("oración:", "escribe una frase").
   */
  readonly leakPatterns?: readonly string[];
  /**
   * Words about language (accent-folded lowercase: grammar terms, "word", "sentence"). A
   * candidate that uses one talks about the language instead of telling the story
   * ("Que es un tipo de pronombre."): rejected as meta.
   */
  readonly metaWords?: readonly string[];
  /** Labels a model puts before its answer ("Oración:"), accent-folded lowercase. */
  readonly labels?: readonly string[];
  /** Words (accent-folded) that mark a preamble before a colon ("Aquí está la oración: ..."). */
  readonly preambleWords?: readonly string[];
  /**
   * A story sentence needs a verb (a VERB or AUX analysis). Default true; a language
   * whose ordinary sentences often have none (or whose pack does not tag verbs) sets it
   * to false.
   */
  readonly requireVerb?: boolean;
}
