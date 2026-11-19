/**
 * Shared checks for authored Spanish series (English speakers learning Spanish): what the
 * language-neutral validator of the engine (engine/src/content/validate.ts) cannot know.
 *
 * Every writer of an en-es series runs these on their episodes (the series' data test
 * engine/src/pair/en-es/stories/<track>.test.ts calls checkSeries, and
 * proof/stories/report.ts prints the same report). Pure: no file or network access, so
 * engine tests can import it.
 *
 * What is checked, per episode, in every variant combination ({you:...} both ways, every
 * option of every track choice):
 * - Structure and the language-neutral layer: validateStory of the engine (ids, intents,
 *   cliff concepts, beats, syllabus ids, cliffs located after the first word, braces).
 *   On top of it here: a `function` on every line and turn, 1-3 turns, speakers that are
 *   cast ids or characters, beginner tier only at levels 0-1.
 * - Vocabulary by level: at least `minCoverage` (95%) of the content words of the lines
 *   are within the episode's level. Content words are words with no function-word
 *   analysis (determiner, pronoun, preposition, conjunction, auxiliary, numeral). Names
 *   (story characters, cast names, `names`), local dialect words (`local`) and English
 *   words the characters mix in (`english`) are not counted. Within the level:
 *     level 0: LEVEL0_LEMMAS (the beginner core below), the pair's cognates and the
 *              series' extra cognates, the series' food and place words, and the chunks
 *              taught so far in the series;
 *     level 1: level 0 plus the 150 most frequent lemmas;
 *     level 2: plus the 500 most frequent; level 3: plus 1000; levels 4-5: the whole
 *              frequency list.
 * - Line length in words: level 0 2-7, level 1 3-9 (LINE_WORDS).
 * - Unknown words: a word the analyzer does not know and no list names.
 * - Cliffs: the answer is within the level (a local answer needs a standard form in
 *   accept); `hint` is set and is a whole word or phrase of the translation (it is bold
 *   there at the hint level); distractors are known Spanish words of similar length.
 * - Address: an adjective after "estás"/"eres", and "bienvenido/a", "tranquilo/a",
 *   written outside a '{you:...}' variant (the learner chooses masculine or feminine
 *   address, so nothing said to "you" may be left unmarked).
 */
import { validateStory } from '../../engine/src/content/validate';
import type { LibraryIssue } from '../../engine/src/content/validate';
import { hintSpan } from '../../engine/src/content/library';
import { allVariantContexts, resolveStory } from '../../engine/src/content/variants';
import type { Analysis, LanguagePack, Pos } from '../../engine/src/lang/types';
import { COGNATES } from '../../engine/src/pair/en-es/cognates';
import type { LibraryStory, LibraryTrack } from '../../engine/src/pair/types';

export type { LibraryIssue };

/** Word lists a series supplies (exported next to its stories). */
export interface SeriesWords {
  /** Proper names other than characters and cast (cities, neighborhoods, brands). Not counted. */
  names?: readonly string[];
  /** Local dialect words and phrases, as listed in the episode comments. Not counted. */
  local: readonly string[];
  /** English words the characters mix in (code-switching). Not counted. */
  english?: readonly string[];
  /** Food and drink names of the series: within the level from level 0. */
  food: readonly string[];
  /** Place words of the series (the bakery, the corner store): within the level from level 0. */
  places: readonly string[];
  /**
   * Cognates the pair's list lacks (sandalia, dominó): words an English speaker
   * recognizes on sight. Within the level from level 0, like the pair's cognates.
   */
  cognates?: readonly string[];
  /**
   * Real Spanish words (any form) the pack's lexicon lacks, used in lines, accept or
   * distractors (siesta, atasco). Checked by hand; they stop the "unknown word" issue but
   * still count as outside the level unless another list has them.
   */
  known?: readonly string[];
  /**
   * Chunks taught per episode, index 0 = episode 1, as listed in the episode comments.
   * Their words count as within the level from that episode on.
   */
  chunks: readonly (readonly string[])[];
}

/** Tunable numbers of the checks. */
export interface SeriesCheckOptions {
  /** Share of content words within the level, per episode. */
  minCoverage: number;
  /** Words per line by story level. */
  lineWords: Readonly<Record<number, readonly [number, number]>>;
  /** Learner turns per episode. */
  minTurns: number;
  maxTurns: number;
  /** A distractor's length over the answer's length must lie in this range. */
  distractorLengthRatio: readonly [number, number];
}

/** Words per line by level: the writing guide's 2-7 (level 0) and 3-9 (level 1). */
export const LINE_WORDS: Readonly<Record<number, readonly [number, number]>> = {
  0: [2, 7],
  1: [3, 9],
  2: [3, 12],
  3: [3, 14],
  4: [3, 18],
  5: [3, 20],
};

export const DEFAULT_SERIES_CHECK_OPTIONS: Readonly<SeriesCheckOptions> = {
  minCoverage: 0.95,
  lineWords: LINE_WORDS,
  minTurns: 1,
  maxTurns: 3,
  distractorLengthRatio: [0.4, 2.5],
};

/**
 * The level-0 core (lemmas, as the Spanish pack analyzes them): what a brand-new learner
 * meets in the first lessons. The verbs the writing guide names (soy, estoy, tengo,
 * quiero, hay, me llamo, me gusta, necesito, vamos); the words of greeting, courtesy and
 * survival chunks (no entiendo, ¿puedes repetir?, no sé, otra vez, más despacio: the
 * last three are the app's own spoken commands); yes/no and basic adverbs; question
 * words; days and times of day; common everyday nouns; basic adjectives, colors, sizes
 * and how-are-you answers. Function words never count, so they are not listed.
 */
export const LEVEL0_LEMMAS: readonly string[] = [
  // Verbs named by the guide, and the verbs of survival chunks
  'ser', 'estar', 'tener', 'querer', 'haber', 'llamar', 'gustar', 'necesitar', 'ir',
  'entender', 'poder', 'repetir', 'saber', 'hablar', 'perdonar', 'disculpar', 'sentir', 'encantar',
  // Greetings and courtesy
  'hola', 'adiós', 'chao', 'gracias', 'favor', 'perdón', 'permiso', 'gusto', 'bienvenido',
  'encantado', 'igualmente', 'luego', 'pronto', 'señor', 'señora', 'don', 'doña',
  // Yes, no and basic adverbs
  'sí', 'no', 'bien', 'mal', 'muy', 'más', 'menos', 'también', 'tampoco', 'aquí', 'allí',
  'ahí', 'ahora', 'hoy', 'mañana', 'ayer', 'ya', 'claro', 'mucho', 'poco', 'despacio', 'tarde',
  'vez', 'okay', 'vale',
  // Question words
  'qué', 'cómo', 'dónde', 'cuándo', 'cuánto', 'quién', 'cuál',
  // Days and times
  'día', 'noche', 'hora', 'semana', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes',
  'sábado', 'domingo', 'fin',
  // People
  'amigo', 'vecino', 'abuelo', 'abuela', 'mamá', 'papá', 'madre', 'padre', 'hijo', 'hermano',
  'niño', 'chico', 'hombre', 'mujer', 'familia', 'nombre', 'bebé', 'amor',
  // Animals
  'perro', 'gato', 'gallo', 'gallina', 'pájaro', 'pez',
  // Home, town and everyday things
  'casa', 'calle', 'tienda', 'playa', 'mar', 'carro', 'coche', 'autobús', 'taxi', 'baño',
  'cocina', 'cama', 'mesa', 'silla', 'puerta', 'ventana', 'ropa', 'camisa', 'pantalón',
  'vestido', 'zapato', 'sombrero', 'bolsa', 'libro', 'teléfono', 'dinero', 'cosa',
  'problema', 'fiesta', 'cumpleaños', 'regalo', 'música', 'trabajo', 'escuela', 'ciudad',
  'país', 'sol', 'lluvia', 'agua', 'comida', 'talla',
  // States you can be in (tener hambre, tener calor...)
  'hambre', 'sed', 'calor', 'frío', 'sueño', 'miedo', 'prisa',
  // Basic adjectives, how-are-you answers, colors and sizes
  'bueno', 'malo', 'grande', 'pequeño', 'mediano', 'nuevo', 'viejo', 'bonito', 'lindo', 'feo',
  'caliente', 'rico', 'cansado', 'contento', 'feliz', 'triste', 'enfermo', 'listo', 'todo',
  'rojo', 'azul', 'verde', 'amarillo', 'negro', 'blanco', 'gris', 'rosado', 'rosa', 'morado',
  'anaranjado', 'marrón',
];

/** Parts of speech that never count as content words. */
const FUNCTION_POS: ReadonlySet<Pos> = new Set<Pos>(['DET', 'PRON', 'ADP', 'CONJ', 'AUX', 'NUM']);

/** How many of the most frequent lemmas each level adds (level 4-5: all). */
const TOP_BY_LEVEL: readonly number[] = [0, 150, 500, 1000, Infinity, Infinity];

/** Per-episode result of checkSeries. */
export interface EpisodeReport {
  id: string;
  episode: number;
  level: number;
  /** Counted content words (names, local and English words excluded). */
  contentWords: number;
  /** Of those, within the level. */
  inLevel: number;
  /** inLevel / contentWords (1 when there are none). */
  coverage: number;
  /** Content words outside the level, as written (lowercase), with how often. */
  outOfLevel: Record<string, number>;
  /** Words nothing knows: not analyzable, in no list. */
  unknown: string[];
  issues: LibraryIssue[];
}

type SpanishPack = Pick<LanguagePack, 'segment' | 'normalize' | 'analyze' | 'frequencyList' | 'foldAccents'>;

/** Every word of a list of words and phrases, normalized. */
function wordsOf(pack: SpanishPack, items: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) for (const s of pack.segment(it)) if (s.kind === 'word' && s.norm) out.add(s.norm);
  return out;
}

/** Normalized words of a text. */
function textWords(pack: SpanishPack, text: string): string[] {
  return pack
    .segment(text)
    .filter((s) => s.kind === 'word')
    .map((s) => s.norm)
    .filter(Boolean);
}

/** The lemmas a story level allows (before series lists and chunks). */
export function levelLemmas(pack: SpanishPack, level: number): Set<string> {
  const out = new Set<string>(LEVEL0_LEMMAS);
  for (const c of COGNATES) out.add(c);
  const top = TOP_BY_LEVEL[Math.max(0, Math.min(5, Math.round(level)))] ?? 0;
  const list = pack.frequencyList ?? [];
  const n = Math.min(list.length, top);
  for (let i = 0; i < n; i++) out.add(list[i] as string);
  return out;
}

/** Function word: some analysis is a determiner, pronoun, preposition, conjunction, auxiliary or numeral. */
function isFunctionWord(analyses: readonly Analysis[]): boolean {
  return analyses.some((a) => FUNCTION_POS.has(a.pos));
}

/** How a word stands for one episode. */
type WordClass = 'function' | 'excepted' | 'in' | 'out' | 'unknown';

interface Lexicon {
  pack: SpanishPack;
  allowed: Set<string>;
  excepted: Set<string>;
  listed: Set<string>;
}

/**
 * Dictionary-form guesses for a word the analyzer does not know (bienvenidas ->
 * bienvenido, sandalias -> sandalia): plural and feminine endings removed. Only used to
 * match the series' own lists, never to accept a word as Spanish on its own.
 */
function formGuesses(norm: string): string[] {
  const out = [norm];
  if (/[aeiouáéíóú]s$/.test(norm)) out.push(norm.slice(0, -1));
  if (/es$/.test(norm)) out.push(norm.slice(0, -2));
  for (const f of [...out]) if (f.endsWith('a')) out.push(`${f.slice(0, -1)}o`);
  return out;
}

function classify(lx: Lexicon, norm: string): WordClass {
  if (!norm || /^\d/.test(norm)) return 'function';
  const guesses = formGuesses(norm);
  if (guesses.some((g) => lx.excepted.has(g))) return 'excepted';
  const analyses = lx.pack.analyze(norm);
  if (isFunctionWord(analyses)) return 'function';
  if (guesses.some((g) => lx.allowed.has(g)) || analyses.some((a) => lx.allowed.has(a.lemma))) return 'in';
  if (analyses.length === 0 && !guesses.some((g) => lx.listed.has(g))) return 'unknown';
  return 'out';
}

/** Known as Spanish: analyzable, or named by a list. */
function knownWord(lx: Lexicon, norm: string): boolean {
  if (lx.pack.analyze(norm).length > 0) return true;
  return formGuesses(norm).some((g) => lx.allowed.has(g) || lx.excepted.has(g) || lx.listed.has(g));
}

const ADDRESS_WORDS = /(?:^|[^\p{L}{|])((?:bienvenid|tranquil)[oa])(?![\p{L}])/giu;
const SECOND_PERSON = /(?:^|[^\p{L}])(estás|eres)\s+(?:muy\s+|tan\s+|más\s+)?([\p{L}]+)/giu;

/**
 * Unmarked address in a raw (unresolved) string: an adjective after "estás"/"eres", or
 * singular "bienvenido/a", "tranquilo/a" outside a variant, unless a capitalized name
 * follows the comma (said to a character: "Tranquilo, Rafa.") or "yo" comes right before
 * (the speaker about themselves: "Y yo, tranquilo").
 */
export function unmarkedAddress(pack: SpanishPack, raw: string): string[] {
  const out: string[] = [];
  const outside = raw.replace(/\{[^{}]*\}/g, (m) => ' '.repeat(m.length));
  for (const m of outside.matchAll(SECOND_PERSON)) {
    const w = pack.normalize(m[2] ?? '');
    const analyses = pack.analyze(w);
    const adj = analyses.some((a) => a.pos === 'ADJ' || (a.pos === 'VERB' && a.features.form === 'part'));
    if (adj && /[oa]s?$/.test(w)) out.push(`${m[1]} ${m[2]}`);
  }
  for (const m of outside.matchAll(ADDRESS_WORDS)) {
    const after = outside.slice((m.index ?? 0) + m[0].length);
    const before = outside.slice(0, (m.index ?? 0) + m[0].length - (m[1] ?? '').length);
    // Said to a character ("Tranquilo, Rafa.") or by the speaker about themselves ("Y yo, tranquilo").
    if (/^\s*,\s*\p{Lu}/u.test(after) || /(?:^|[^\p{L}])yo[\s,.]*$/iu.test(before)) continue;
    out.push(m[1] ?? '');
  }
  return out;
}

/**
 * Check every episode of one series. Stories are checked in episode order; chunks of
 * earlier episodes count for later ones.
 */
export function checkSeries(
  pack: SpanishPack,
  track: LibraryTrack,
  stories: readonly LibraryStory[],
  words: SeriesWords,
  opts: Partial<SeriesCheckOptions> = {},
): EpisodeReport[] {
  const o: SeriesCheckOptions = { ...DEFAULT_SERIES_CHECK_OPTIONS, ...opts };
  const sorted = [...stories].sort((a, b) => a.episode - b.episode);
  const castNames = track.cast.flatMap((c) => [c.name]);
  const castIds = new Set(track.cast.map((c) => c.id));
  const series = wordsOf(pack, [...words.food, ...words.places, ...(words.cognates ?? [])]);
  const known = wordsOf(pack, words.known ?? []);
  const reports: EpisodeReport[] = [];

  for (const story of sorted) {
    const issues: LibraryIssue[] = [];
    const add = (where: string, message: string): void => {
      issues.push({ where: where ? `${story.id} ${where}` : story.id, message });
    };
    issues.push(...validateStory(pack, story, track));

    const chunks = wordsOf(pack, words.chunks.slice(0, story.episode).flat());
    const allowed = levelLemmas(pack, story.level);
    for (const w of series) allowed.add(w);
    for (const w of chunks) allowed.add(w);
    const excepted = wordsOf(pack, [...(words.names ?? []), ...words.local, ...(words.english ?? []), ...story.characters, ...castNames]);
    const lx: Lexicon = { pack, allowed, excepted, listed: new Set([...series, ...chunks, ...known]) };
    const local = wordsOf(pack, words.local);

    if (story.tier === 'beginner' && story.level > 1) add('', `beginner tier at level ${story.level} (want 0-1)`);
    const turns = story.turns ?? [];
    if (turns.length < o.minTurns || turns.length > o.maxTurns) add('', `${turns.length} turns (want ${o.minTurns}-${o.maxTurns})`);
    const speakers = new Set([...castIds, ...story.characters]);
    story.sentences.forEach((line, i) => {
      const where = line.id || `line ${i}`;
      if (line.function === undefined) add(where, 'no syllabus function');
      if (line.speaker !== undefined && !speakers.has(line.speaker)) add(where, `speaker "${line.speaker}" is neither a cast id nor a character`);
      for (const s of [line.text, ...(story.turns ?? []).filter((t) => t.after === i).map((t) => t.line)]) {
        for (const u of unmarkedAddress(pack, s)) add(where, `"${u}" is said to you without a {you:...} variant`);
      }
    });
    turns.forEach((t, i) => {
      const where = t.id || `turn ${i}`;
      if (t.function === undefined) add(where, 'no syllabus function');
      if (!speakers.has(t.speaker)) add(where, `speaker "${t.speaker}" is neither a cast id nor a character`);
    });

    // Vocabulary and lines, in every variant combination (counted on the first one).
    const [lo, hi] = o.lineWords[story.level] ?? [1, 99];
    const counts = { content: 0, in: 0 };
    const outOf: Record<string, number> = {};
    const unknown = new Set<string>();
    const reported = new Set<string>();
    const once = (where: string, message: string): void => {
      const k = `${where}|${message}`;
      if (!reported.has(k)) {
        reported.add(k);
        add(where, message);
      }
    };
    allVariantContexts(track).forEach((ctx, ci) => {
      const r = resolveStory(story, ctx);
      r.sentences.forEach((line, i) => {
        const where = line.id || `line ${i}`;
        const ws = textWords(pack, line.text);
        if (ws.length < lo || ws.length > hi) once(where, `${ws.length} words (level ${story.level}: ${lo}-${hi}): ${line.text}`);
        for (const w of ws) {
          const c = classify(lx, w);
          if (c === 'unknown') unknown.add(w);
          if (ci !== 0 || c === 'function' || c === 'excepted') continue;
          counts.content++;
          if (c === 'in') counts.in++;
          else outOf[w] = (outOf[w] ?? 0) + 1;
        }
        // The cliff.
        const cliff = line.cliff;
        const answer = textWords(pack, cliff.word);
        for (const w of answer) {
          const c = classify(lx, w);
          if (c === 'out' || c === 'unknown') once(where, `cliff word "${w}" is outside level ${story.level}`);
          if (local.has(w) && (cliff.accept ?? []).length === 0) once(where, `cliff word "${w}" is local: add the standard form to accept`);
        }
        if (!cliff.hint || !cliff.hint.trim()) once(where, 'cliff.hint is empty');
        else if (!wholeIn(line.translation, cliff.hint)) once(where, `hint "${cliff.hint}" is not a whole word of the translation: ${line.translation}`);
        for (const d of cliff.distractors) {
          for (const w of textWords(pack, d)) if (!knownWord(lx, w)) once(where, `distractor "${d}" is not a known Spanish word`);
          const ratio = d.length / Math.max(1, cliff.word.length);
          if (ratio < o.distractorLengthRatio[0] || ratio > o.distractorLengthRatio[1]) once(where, `distractor "${d}" is not of similar length to "${cliff.word}"`);
        }
        for (const a of cliff.accept ?? []) for (const w of textWords(pack, a)) if (!knownWord(lx, w)) once(where, `accept "${a}" has an unknown word "${w}"`);
      });
      for (const t of r.turns ?? []) {
        for (const s of [t.line, t.example]) for (const w of textWords(pack, s)) if (classify(lx, w) === 'unknown') unknown.add(w);
      }
    });
    for (const w of unknown) add('', `unknown word "${w}" (add it to a list of the series or fix the spelling)`);
    const coverage = counts.content ? counts.in / counts.content : 1;
    if (coverage < o.minCoverage) {
      add('', `${(coverage * 100).toFixed(1)}% of ${counts.content} content words within level ${story.level} (want ${o.minCoverage * 100}%); outside: ${Object.keys(outOf).join(', ')}`);
    }
    reports.push({
      id: story.id,
      episode: story.episode,
      level: story.level,
      contentWords: counts.content,
      inLevel: counts.in,
      coverage,
      outOfLevel: outOf,
      unknown: [...unknown],
      issues,
    });
  }
  return reports;
}

/** `hint` occurs in `text` as whole words (case-insensitive). */
function wholeIn(text: string, hint: string): boolean {
  const span = hintSpan(text, hint);
  if (!span) return false;
  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  return !isWordChar(text[span.start - 1]) && !isWordChar(text[span.end]);
}

/** Every issue of a series report. */
export function seriesIssues(reports: readonly EpisodeReport[]): LibraryIssue[] {
  return reports.flatMap((r) => r.issues);
}
