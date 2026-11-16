/**
 * Spanish story-generation data (LanguagePack.story, see lang/storyData.ts): the wording
 * of the continuation prompt, level names, length hints, example lines, region names,
 * the older instruction prompt, and what to look for in model output (leak patterns,
 * meta words, answer labels, preamble words). Data only.
 *
 * The continuation prompt was chosen on Qwen3-1.7B (proof/ENGINE_REAL_MODEL.md, "Story
 * generation at every level"): a short header naming the text and its level, the
 * characters, a vocabulary line for small vocabularies, and the story one sentence per
 * line after its key word in brackets; the prompt ends with the next key word.
 */
import type { StoryExample, StoryInstructionText, StoryLanguageData, StoryPromptText } from '../types';

export const SPANISH_STORY_PROMPT_TEXT: StoryPromptText = {
  header: 'Cuento en español{level}.{lengthHint}',
  level: ' (nivel {name})',
  lengthHint: ' {text}',
  characters: 'Personajes: {names}.',
  scene: 'Lugar: {scene}.',
  vocabulary: 'Palabras: {words}.',
  listSeparator: ', ',
  street: "Hablan como en la calle{region}, con 'tá y pa'.",
  streetRegion: ' de {region}',
};

/**
 * The older instruction prompt (story/prompt.ts buildContinuationPrompt). Measured on
 * Qwen3-1.7B: fill-in templates, numbered lists and empty answers for beginners; kept
 * only for callers that still build it.
 */
export const SPANISH_PROMPT_TEXT: StoryInstructionText = {
  task: 'Escribe la siguiente oración de esta historia.',
  taskFirst: 'Escribe la primera oración de una historia corta.',
  taskSimple: 'Escribe una oración muy corta y fácil que siga la historia.',
  length: 'Una sola oración, de {max} palabras como máximo.',
  oneTarget: 'Usa la palabra {words}.',
  manyTargets: 'Usa estas palabras: {words}.',
  simpleWords: 'Usa palabras sencillas.',
  veryEasyWords: 'Usa solo palabras muy comunes.',
  neutral: 'Habla en español neutro.',
  street: "Usa español de la calle{region}, como 'tá y pa'.",
  streetRegion: ' de {region}',
  answerOnly: 'Responde solo con la oración, sin comillas ni traducción.',
  storyLabel: 'Historia:',
  nextLabel: 'Siguiente oración:',
  firstLabel: 'Primera oración:',
  listSeparator: ', ',
  listLastSeparator: ' y ',
};

/** Region codes (SlangEntry.regions) to the names used in prompts. */
export const SPANISH_REGION_NAMES: Readonly<Record<string, string>> = {
  PR: 'Puerto Rico',
  DO: 'República Dominicana',
  CU: 'Cuba',
  CO: 'Colombia',
  CARIB: 'el Caribe',
};

/**
 * Abbreviations (normalized, without the dot) after which a period does not end a
 * sentence (LanguagePack.abbreviations).
 */
export const SPANISH_ABBREVIATIONS: readonly string[] = [
  'sr', 'sra', 'srta', 'sres', 'sras', 'dr', 'dra', 'ud', 'uds', 'vd', 'vds',
  'prof', 'profa', 'av', 'avda', 'dña', 'núm', 'pág',
];

/**
 * In-style example lines for a story that has just started (fewer sentences than the
 * prompt shows). Common words only (frequency ranks below 300, or cognates), one clause
 * each, as an early learner's story would read.
 */
export const SPANISH_STORY_EXAMPLES: readonly StoryExample[] = [
  { tag: 'casa', text: 'La niña vive en una casa pequeña.' },
  { tag: 'mañana', text: 'Por la mañana, toma un café con su padre.' },
  { tag: 'calle', text: 'Después sale a la calle con su hermano.' },
];

/**
 * Echoed instructions and labels (regex sources on accent-folded lowercase text): the
 * vocabulary of both Spanish prompts.
 */
export const SPANISH_LEAK_PATTERNS: readonly string[] = [
  '\\boracion(es)?\\b',
  '\\binstrucci(on|ones)\\b',
  '\\b(historia|frase|respuesta|registro|palabras?|traduccion|continuacion|personajes|lugar|cuento|nivel)\\s*:',
  '\\bmaximo\\s+\\d+\\s+palabras\\b',
  '\\b\\d+\\s+palabras\\s+como\\s+maximo\\b',
  '\\b(continua|escribe|usa|responde)\\s+(la|una|solo|estas|esta|las|con)\\s+(historia|oracion|palabras?|frase)\\b',
  '\\bregistro\\s+(neutro|callejero|de\\s+la\\s+calle)\\b',
  '\\bcuento\\s+en\\s+espanol\\b',
  '\\bfrases?\\s+(muy\\s+)?cortas?\\b',
  '\\bnivel\\s+[abc][12]\\b',
];

/** Grammar terms: a candidate that uses one talks about the language ("Que es un tipo de pronombre."). */
export const SPANISH_META_WORDS: readonly string[] = [
  'pronombre', 'pronombres', 'sustantivo', 'sustantivos', 'adjetivo', 'adjetivos', 'adverbio', 'adverbios',
  'preposicion', 'preposiciones', 'conjuncion', 'conjunciones', 'verbo', 'verbos', 'gramatica', 'vocabulario',
  'sinonimo', 'sinonimos', 'conjugacion', 'oracion', 'oraciones',
];

/** Labels a model puts before its answer (accent-folded lowercase). */
export const SPANISH_STORY_LABELS: readonly string[] = [
  'oracion', 'siguiente oracion', 'primera oracion', 'nueva oracion', 'frase', 'respuesta', 'continuacion',
  'historia', 'texto', 'salida', 'espanol', 'spanish', 'asistente', 'modelo', 'personajes', 'palabras', 'cuento',
];

/**
 * Words that mark a preamble before a colon ("Aquí está la oración: ..."). Only words
 * that rarely appear in a story sentence before a colon ("frase" and "respuesta" do, as
 * in "Marta leyó la frase: hola", so they are labels only).
 */
export const SPANISH_PREAMBLE_WORDS: readonly string[] = ['oracion', 'aqui', 'claro', 'siguiente', 'continuacion'];

export const SPANISH_STORY_DATA: StoryLanguageData = {
  prompt: SPANISH_STORY_PROMPT_TEXT,
  // Estimated vocabulary (lexemes known for meaning) to CEFR-like level names: rough
  // equivalences, judgement calls (A1 about 500 words, A2 1000, B1 2000, B2 4000).
  levels: [
    { upTo: 600, name: 'A1' },
    { upTo: 1200, name: 'A2' },
    { upTo: 2500, name: 'B1' },
    { upTo: 5000, name: 'B2' },
    { upTo: 1e9, name: 'C1' },
  ],
  // Measured on Qwen3-1.7B: with "Frases cortas." the early learner's candidates stayed in
  // the length range (12 of 12) where the header without it gave 10 of 12.
  lengthHints: [
    { maxWords: 8, text: 'Frases muy cortas.' },
    { maxWords: 12, text: 'Frases cortas.' },
  ],
  examples: SPANISH_STORY_EXAMPLES,
  regionNames: SPANISH_REGION_NAMES,
  instructions: SPANISH_PROMPT_TEXT,
  leakPatterns: SPANISH_LEAK_PATTERNS,
  metaWords: SPANISH_META_WORDS,
  labels: SPANISH_STORY_LABELS,
  preambleWords: SPANISH_PREAMBLE_WORDS,
  requireVerb: true,
};
