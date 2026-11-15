/**
 * Prompting a small instruct model for the next story sentence, and cleaning what it
 * writes back.
 *
 * The prompt is written in the language being learned (Spanish by default) with short,
 * one-line instructions, then the last few story sentences, then a label for the model
 * to continue after. All wording lives in a PromptText table so other languages supply
 * their own.
 *
 * Small models decorate their answers: labels ("Oración:"), quotes, markdown, a
 * translation in brackets, a second sentence, an English gloss. extractSentence undoes
 * all of that and returns one clean sentence.
 */
import {
  DEFAULT_ABBREVIATIONS,
  SENTENCE_END_CHARS,
  capitalizeFirst,
  isCapitalized,
  foldForMatch,
  hasLetter,
  splitSentences,
  wholeAtLeast,
} from './text';
import type { Register } from '../lang/types';

/** Neutral or street register (shared contract type; street lets clipped forms like 'tá and pa' through). */
export type { Register } from '../lang/types';

/**
 * Prompt wording. Placeholders: {max} (maximum words), {words} (target words),
 * {region} (region name).
 */
export interface PromptText {
  /** Task line when the story has sentences. */
  task: string;
  /** Task line when the story is empty. */
  taskFirst: string;
  /** Task line of the simpler retry prompt. */
  taskSimple: string;
  length: string;
  oneTarget: string;
  manyTargets: string;
  simpleWords: string;
  veryEasyWords: string;
  neutral: string;
  street: string;
  /** Inserted into `street` as {region} when a region is given, e.g. " de Puerto Rico". */
  streetRegion: string;
  answerOnly: string;
  storyLabel: string;
  nextLabel: string;
  firstLabel: string;
  /** Separator between target words, and before the last one. */
  listSeparator: string;
  listLastSeparator: string;
}

export const SPANISH_PROMPT_TEXT: Readonly<PromptText> = {
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

/** Region codes (as used in SlangEntry.regions) to names used in prompts. */
export const REGION_NAMES: Readonly<Record<string, string>> = {
  PR: 'Puerto Rico',
  DO: 'República Dominicana',
  CU: 'Cuba',
  CO: 'Colombia',
  CARIB: 'el Caribe',
};

export interface PromptOptions {
  /** Target words as surface forms, e.g. ["compró"]. */
  targets: readonly string[];
  maxWords: number;
  register: Register;
  /** Region code ("PR") or name; used in street register. */
  region?: string;
  /** Simpler retry prompt: easier wording, only the first target. */
  simple?: boolean;
  /** Number of story sentences included (the last ones). Default 4. */
  contextSentences?: number;
  /** Wording overrides (another language, or tuning). */
  text?: Partial<PromptText>;
  /** Region code to name table. Default REGION_NAMES. */
  regionNames?: Readonly<Record<string, string>>;
}

/** Default number of story sentences shown to the model. */
export const DEFAULT_CONTEXT_SENTENCES = 4;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Join words as a natural list: "a", "a y b", "a, b y c". */
export function joinList(words: readonly string[], sep: string, lastSep: string): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(sep)}${lastSep}${words[words.length - 1]}`;
}

/** Story sentences as a list: a string is split into sentences; array entries are split too. */
export function storySentences(story: string | readonly string[]): string[] {
  const entries = typeof story === 'string' ? [story] : story;
  return entries.flatMap((e) => splitSentences(e.replace(/\s+/gu, ' ')));
}

/**
 * The instruction lines of a continuation prompt, in order. Exposed so the selector can
 * detect candidates that echo them.
 *
 * Method: a task line (first sentence, next sentence, or the simpler retry wording), a
 * length limit, a line naming the target words (only the first one in the simple
 * prompt), a word-difficulty line, a register line (street names the region when
 * given) and a line asking for the bare sentence.
 */
export function promptInstructionLines(opts: PromptOptions, storyIsEmpty = false): string[] {
  const t: PromptText = { ...SPANISH_PROMPT_TEXT, ...opts.text };
  const names = opts.regionNames ?? REGION_NAMES;
  const targets = (opts.simple ? opts.targets.slice(0, 1) : opts.targets).map((w) => w.trim()).filter(Boolean);
  const lines: string[] = [];
  lines.push(opts.simple ? t.taskSimple : storyIsEmpty ? t.taskFirst : t.task);
  lines.push(fill(t.length, { max: String(wholeAtLeast(opts.maxWords)) }));
  if (targets.length === 1) lines.push(fill(t.oneTarget, { words: targets[0] as string }));
  else if (targets.length > 1) lines.push(fill(t.manyTargets, { words: joinList(targets, t.listSeparator, t.listLastSeparator) }));
  lines.push(opts.simple ? t.veryEasyWords : t.simpleWords);
  if (opts.register === 'street') {
    const region = opts.region ? names[opts.region] ?? opts.region : '';
    lines.push(fill(t.street, { region: region ? fill(t.streetRegion, { region }) : '' }));
  } else {
    lines.push(t.neutral);
  }
  lines.push(t.answerOnly);
  return lines;
}

/**
 * Build a continuation prompt for a small instruct model.
 *
 * Layout: instruction lines (see promptInstructionLines), a blank line, the story label
 * and the last `contextSentences` sentences on one line, a blank line, then the "next
 * sentence" label. The prompt ends right after the label's colon, with no trailing
 * space or newline, so a stop sequence of "\n" ends the model's answer after one line.
 * An empty story omits the story block and asks for a first sentence.
 */
export function buildContinuationPrompt(storySoFar: string | readonly string[], opts: PromptOptions): string {
  const t: PromptText = { ...SPANISH_PROMPT_TEXT, ...opts.text };
  const keep = Math.max(0, Math.floor(opts.contextSentences ?? DEFAULT_CONTEXT_SENTENCES));
  const sentences = storySentences(storySoFar);
  const recent = keep === 0 ? [] : sentences.slice(-keep);
  const lines = promptInstructionLines(opts, recent.length === 0);
  const parts = [lines.join('\n')];
  if (recent.length) parts.push(`${t.storyLabel}\n${recent.join(' ')}`);
  parts.push(recent.length ? t.nextLabel : t.firstLabel);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Cleaning model output
// ---------------------------------------------------------------------------

/** Options for extractSentence. */
export interface ExtractOptions {
  /**
   * Native-language lexicon (normalized, lowercase). When given, a trailing run of at
   * least minTrailingNative native words is cut ("Marta compró pan Marta bought bread").
   */
  nativeLexicon?: ReadonlySet<string>;
  /**
   * Recognizes target-language words (e.g. via LanguagePack.analyze). A word it accepts
   * stops the trailing native run, so words in both languages ("pan") are kept.
   */
  isTargetWord?: (word: string) => boolean;
  minTrailingNative: number;
  abbreviations: readonly string[];
  /** Uppercase the first letter. */
  capitalize: boolean;
  /** Add end punctuation when missing ("." or "?" / "!" after ¿ / ¡). */
  addFinalPunctuation: boolean;
  /** Label words (accent-folded, lowercase) removed when they start a line followed by ":". */
  labels: readonly string[];
  /** Words (accent-folded) that mark a preamble before a colon ("Aquí está la oración: ..."). */
  preambleWords: readonly string[];
}

export const DEFAULT_EXTRACT_OPTIONS: Readonly<ExtractOptions> = {
  minTrailingNative: 2,
  abbreviations: DEFAULT_ABBREVIATIONS,
  capitalize: true,
  addFinalPunctuation: true,
  labels: [
    'oracion', 'siguiente oracion', 'primera oracion', 'nueva oracion', 'frase', 'respuesta', 'continuacion',
    'historia', 'texto', 'salida', 'espanol', 'sentence', 'next sentence', 'answer', 'response', 'output',
    'spanish', 'story', 'assistant', 'asistente', 'modelo', 'model',
  ],
  // Only words that rarely appear in a story sentence before a colon ("frase" and
  // "respuesta" do, as in "Marta leyó la frase: hola", so they are labels only).
  preambleWords: ['oracion', 'aqui', 'claro', 'siguiente', 'continuacion', 'sentence', 'here', "here's", 'sure', 'next'],
};

const DOUBLE_QUOTES = `"“”„«»`;
const TRANSLATION_CUT_RE = /\s+(?:=|\/|\||->|→|-|–)\s+|\b(?:translation|traducci[oó]n|english|in english|en ingl[eé]s)\s*:/iu;

/** Remove markdown decoration from one line: fences, headings, quotes, bullets, emphasis, code ticks. */
export function stripMarkdown(line: string): string {
  let s = line;
  if (/^\s*```/u.test(s)) return '';
  s = s.replace(/^\s*#{1,6}\s+/u, '');
  s = s.replace(/^\s*>+\s?/u, '');
  s = s.replace(/^\s*(?:[-*•+]|\d+[.)])\s+/u, '');
  s = s.replace(/\*\*|__|\*|`/gu, '');
  return s;
}

const LOOSE_LETTERS: Readonly<Record<string, string>> = {
  a: '[aáàâä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôö]', u: '[uúùûü]', n: '[nñ]', c: '[cç]',
};

/**
 * Regex source matching `word` case- and accent-insensitively on NFC text: each plain
 * vowel, n and c also matches its accented forms, spaces match any whitespace, and
 * everything else is escaped. Used with the "iu" flags.
 */
export function looseSource(word: string): string {
  return [...word]
    .map((ch) => (/\s/u.test(ch) ? '\\s+' : LOOSE_LETTERS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\/-]/gu, '\\$&')))
    .join('');
}

/**
 * Remove leading labels ("Oración:", "Siguiente oración 2:", "Answer -") and preambles
 * ending in a colon that contain a meta word ("Aquí está la oración: ..."). Matching is
 * case- and accent-insensitive. Repeats until nothing changes.
 */
export function stripLabels(line: string, o: Pick<ExtractOptions, 'labels' | 'preambleWords'> = DEFAULT_EXTRACT_OPTIONS): string {
  let s = line.normalize('NFC').trim();
  for (let guard = 0; guard < 5; guard++) {
    const before = s;
    for (const label of o.labels) {
      const m = new RegExp(`^${looseSource(label)}(?:\\s*\\d+)?\\s*[:：-]\\s*`, 'iu').exec(s);
      if (m) {
        s = s.slice(m[0].length).trim();
        break;
      }
    }
    const colon = s.search(/[:：]/u);
    if (colon >= 0) {
      const head = foldForMatch(s.slice(0, colon));
      const words = head.split(/[^a-z0-9']+/u).filter(Boolean);
      if (words.length <= 8 && words.some((w) => o.preambleWords.includes(w))) s = s.slice(colon + 1).trim();
    }
    if (s === before) break;
  }
  return s;
}

/** Remove bracketed and parenthesized asides ("(Marta bought bread)", "[translation]"). */
export function stripAsides(s: string): string {
  let out = s;
  for (let guard = 0; guard < 5; guard++) {
    const next = out.replace(/\s*\([^()]*\)/gu, '').replace(/\s*\[[^[\]]*\]/gu, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Strip quotes wrapping the whole text: any double-quote style always; a straight single
 * quote pair only when the closing one follows end punctuation ('Marta llegó.'), and a
 * curly ‘…’ pair, so clipped forms like 'tá and pa' survive. Repeats for nested quotes.
 */
export function stripWrappingQuotes(text: string): string {
  let s = text.trim();
  for (let guard = 0; guard < 5; guard++) {
    const first = s[0];
    const last = s[s.length - 1];
    if (s.length < 2 || first === undefined || last === undefined) break;
    if (DOUBLE_QUOTES.includes(first) && DOUBLE_QUOTES.includes(last)) s = s.slice(1, -1).trim();
    else if (first === '‘' && last === '’') s = s.slice(1, -1).trim();
    else if (first === "'" && last === "'" && SENTENCE_END_CHARS.includes(s[s.length - 2] ?? '')) s = s.slice(1, -1).trim();
    else break;
  }
  return s;
}

/**
 * Remove quotes left unpaired at either edge: an odd straight double quote at the start
 * or end ('"Marta compró pan.' -> 'Marta compró pan.'), and an opening “ « „ without a
 * closing one (or a closing ” » without an opening one).
 */
export function stripEdgeQuotes(text: string): string {
  let s = text.trim();
  const straight = [...s].filter((c) => c === '"').length;
  if (straight % 2 === 1) s = s.replace(/^"\s*/u, '').replace(/\s*"$/u, '');
  const opens = [...s].filter((c) => '“«„'.includes(c)).length;
  const closes = [...s].filter((c) => '”»'.includes(c)).length;
  if (opens > closes) s = s.replace(/^[“«„]\s*/u, '');
  if (closes > opens) s = s.replace(/\s*[”»]$/u, '');
  return s.trim();
}

/** Tidy spacing: collapse whitespace, no space after ¿ ¡ or before , . ; : ? ! …. */
export function tidySpacing(s: string): string {
  return s
    .replace(/\s+/gu, ' ')
    .replace(/([¿¡])\s+/gu, '$1')
    .replace(/\s+([,.;:?!…])/gu, '$1')
    .trim();
}

/**
 * Cut a trailing run of native-language words ("Marta compró pan Marta bought bread").
 *
 * Method: walk the words from the end; lexicon words that `isTarget` does not accept
 * extend the run and count, capitalized words (names repeated in a gloss) extend it
 * without counting, and any other word stops it. The run is cut, with the separator before it, when
 * it holds at least `min` lexicon words and does not cover the whole text (a text that
 * is all native is left for the selector to reject).
 */
export function cutTrailingNative(
  s: string,
  lexicon: ReadonlySet<string>,
  min: number,
  isTarget: (word: string) => boolean = () => false,
): string {
  const tokens = [...s.matchAll(/['’]?[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/gu)];
  let start = tokens.length;
  let native = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const w = tokens[i]?.[0] ?? '';
    if (lexicon.has(w.toLowerCase()) && !isTarget(w)) native++;
    else if (!isCapitalized(w)) break;
    start = i;
  }
  if (native < min || start === 0) return s;
  const cutAt = tokens[start]?.index ?? s.length;
  return s.slice(0, cutAt).replace(/[\s\-–—=/|:,(]+$/u, '');
}

function finalPunctuation(s: string): string {
  const core = s.replace(/["'”’»)\]]+$/u, '');
  if (core && SENTENCE_END_CHARS.includes(core[core.length - 1] as string)) return s;
  const open = /^[^\p{L}]*([¿¡])/u.exec(s)?.[1];
  const mark = open === '¿' ? '?' : open === '¡' ? '!' : '.';
  return s.replace(/[\s,;:\-–—]+$/u, '') + mark;
}

/**
 * Clean raw model output into one sentence.
 *
 * Method: split into lines and clean each (markdown, leading labels and preambles,
 * cut at a translation separator such as " = ", " / ", " - " or "Translation:", drop
 * bracketed asides, strip wrapping quotes); take the first line that still has a letter;
 * keep only its first sentence (abbreviation-aware); strip wrapping and unpaired quotes
 * again; optionally cut a trailing run of native words; tidy spacing; capitalize the
 * first letter and add end punctuation when missing. Returns '' when nothing usable is
 * left. Clipped forms with apostrophes ('tá, pa') are preserved.
 */
export function extractSentence(raw: string, options?: Partial<ExtractOptions>): string {
  const o: ExtractOptions = { ...DEFAULT_EXTRACT_OPTIONS, ...options };
  const lines = raw.normalize('NFC').replace(/\r\n?/gu, '\n').split('\n');
  for (const rawLine of lines) {
    let line = stripLabels(stripMarkdown(rawLine), o);
    const cut = TRANSLATION_CUT_RE.exec(line);
    if (cut && cut.index > 0) line = line.slice(0, cut.index);
    line = stripWrappingQuotes(stripAsides(line));
    if (!hasLetter(line)) continue;
    const sentence = splitSentences(line, o.abbreviations).find(hasLetter);
    if (!sentence) continue;
    let s = stripEdgeQuotes(stripWrappingQuotes(sentence));
    if (o.nativeLexicon) s = cutTrailingNative(s, o.nativeLexicon, o.minTrailingNative, o.isTargetWord);
    s = tidySpacing(s);
    if (!hasLetter(s)) continue;
    if (o.capitalize) s = capitalizeFirst(s);
    if (o.addFinalPunctuation) s = finalPunctuation(s);
    return s;
  }
  return '';
}
