/**
 * Prompting the model for the next story sentence, and cleaning what it writes back.
 *
 * The continuation prompt (buildStoryPrompt) is plain text the model continues, with no
 * chat template, the way model_server.py /generate and llama.rn completion work. Layout:
 *
 *   header line           what the text is, its level and a length hint (pack wording)
 *   characters line       the story's names
 *   scene line            where it happens (when known)
 *   vocabulary line       words the reader knows (only for small vocabularies)
 *   street line           street register only
 *   (blank line)
 *   [tag] sentence        the last story sentences, one per line, each after its key word
 *   [tag] sentence
 *   [next tag]            the word the next sentence should use
 *
 * The model writes " sentence" after the last tag; generation stops at the first
 * sentence end. Measured on Qwen3-1.7B (proof/ENGINE_REAL_MODEL.md, "Story generation at
 * every level"): the tagged lines made the next sentence use a content-word target in 12
 * of 12 early-learner candidates where a "new word" header line alone gave 2 of 12, and
 * the instruction prompt this replaces gave fill-in templates and empty lines.
 *
 * All wording comes from LanguagePack.story (lang/storyData.ts); a pack without it gets
 * the tagged lines alone. The brackets and line breaks are the only fixed text
 * (DEFAULT_STORY_PROMPT_OPTIONS). The prompt is returned as a shared prefix plus a
 * suffix (the next tag), so rounds with another tag reuse the prefix (and the model's
 * KV cache of it).
 *
 * The older instruction prompt (buildContinuationPrompt) is kept for callers that still
 * build it; its wording comes from the pack too (StoryLanguageData.instructions).
 *
 * Small models decorate their answers: labels ("Oración:"), quotes, markdown, a
 * translation in brackets, a second sentence, an English gloss. extractSentence undoes
 * all of that and returns one clean sentence.
 */
import {
  NO_ABBREVIATIONS,
  SENTENCE_END_CHARS,
  capitalizeFirst,
  isCapitalized,
  foldForMatch,
  hasLetter,
  splitSentences,
  wholeAtLeast,
} from './text';
import type { LanguagePack, Register, StoryInstructionText, StoryLanguageData } from '../lang/types';

/** Neutral or street register (shared contract type; street lets clipped forms like 'tá and pa' through). */
export type { Register } from '../lang/types';

/**
 * Wording of the older instruction prompt (buildContinuationPrompt). Placeholders: {max}
 * (maximum words), {words} (target words), {region} (region name). Languages supply it as
 * StoryLanguageData.instructions (Spanish: SPANISH_PROMPT_TEXT in lang/es).
 */
export type PromptText = StoryInstructionText;

/** Instruction wording with every line empty: a pack without instructions gets no lines. */
const BLANK_PROMPT_TEXT: Readonly<PromptText> = {
  task: '', taskFirst: '', taskSimple: '', length: '', oneTarget: '', manyTargets: '', simpleWords: '',
  veryEasyWords: '', neutral: '', street: '', streetRegion: '', answerOnly: '', storyLabel: '', nextLabel: '',
  firstLabel: '', listSeparator: ', ', listLastSeparator: ', ',
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
  /**
   * Wording, merged over blank lines (pass the pack's StoryLanguageData.instructions,
   * e.g. SPANISH_PROMPT_TEXT). Empty lines are left out.
   */
  text?: Partial<PromptText>;
  /** Region code to name table (StoryLanguageData.regionNames). Default none: the code is used. */
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
export function storySentences(story: string | readonly string[], abbreviations: readonly string[] = NO_ABBREVIATIONS): string[] {
  const entries = typeof story === 'string' ? [story] : story;
  return entries.flatMap((e) => splitSentences(e.replace(/\s+/gu, ' '), abbreviations));
}

/**
 * The instruction lines of the older prompt, in order. Exposed so the selector can
 * detect candidates that echo them.
 *
 * Method: a task line (first sentence, next sentence, or the simpler retry wording), a
 * length limit, a line naming the target words (only the first one in the simple
 * prompt), a word-difficulty line, a register line (street names the region when
 * given) and a line asking for the bare sentence. Lines whose wording is empty are left out.
 */
export function promptInstructionLines(opts: PromptOptions, storyIsEmpty = false): string[] {
  const t: PromptText = { ...BLANK_PROMPT_TEXT, ...opts.text };
  const names = opts.regionNames ?? {};
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
  return lines.filter((l) => l.trim() !== '');
}

/**
 * Build the older instruction prompt.
 *
 * Layout: instruction lines (see promptInstructionLines), a blank line, the story label
 * and the last `contextSentences` sentences on one line, a blank line, then the "next
 * sentence" label. The prompt ends right after the label, with no trailing space or
 * newline, so a stop sequence of "\n" ends the model's answer after one line. An empty
 * story omits the story block and asks for a first sentence.
 */
export function buildContinuationPrompt(storySoFar: string | readonly string[], opts: PromptOptions): string {
  const t: PromptText = { ...BLANK_PROMPT_TEXT, ...opts.text };
  const keep = Math.max(0, Math.floor(opts.contextSentences ?? DEFAULT_CONTEXT_SENTENCES));
  const sentences = storySentences(storySoFar);
  const recent = keep === 0 ? [] : sentences.slice(-keep);
  const lines = promptInstructionLines(opts, recent.length === 0);
  const parts = [lines.join('\n')];
  if (recent.length) parts.push(t.storyLabel ? `${t.storyLabel}\n${recent.join(' ')}` : recent.join(' '));
  parts.push(recent.length ? t.nextLabel : t.firstLabel);
  return parts.filter((p) => p !== '').join('\n\n');
}

// ---------------------------------------------------------------------------
// The continuation prompt
// ---------------------------------------------------------------------------

/** A story sentence with the key word its prompt line is tagged with. */
export interface StoryLine {
  text: string;
  /** The tag word; computed with tagFor when absent. */
  tag?: string;
}

/** Fixed structure of the continuation prompt (no words of any language). */
export interface StoryPromptOptions {
  /** Opening and closing marks of a line tag. */
  tagOpen: string;
  tagClose: string;
  /** Between the tag and the sentence. */
  tagSeparator: string;
  /** Between several tag words. */
  tagJoiner: string;
  /** Story sentences shown (the last ones). */
  contextSentences: number;
  /** Example lines (StoryLanguageData.examples) fill the story block up to this many lines. */
  minLines: number;
}

/**
 * Defaults. Brackets: Qwen3-1.7B keeps the "[word] sentence" pattern and starts its
 * answer with a space after the final tag; it rarely writes brackets inside a sentence,
 * and a candidate that does is rejected as a placeholder. contextSentences 4: the story
 * module's earlier default. minLines 3: with fewer tagged lines the model did not pick up
 * the pattern (one line gave tag-only answers such as "¿Qué?").
 */
export const DEFAULT_STORY_PROMPT_OPTIONS: Readonly<StoryPromptOptions> = Object.freeze({
  tagOpen: '[',
  tagClose: ']',
  tagSeparator: ' ',
  tagJoiner: ', ',
  contextSentences: DEFAULT_CONTEXT_SENTENCES,
  minLines: 3,
});

export interface StoryPromptInput {
  /** Story so far (oldest first); plain strings are tagged with tagFor. */
  story: readonly (string | StoryLine)[];
  /** The next line's tag: the target words, or a familiar word for a safe round. */
  tag: string | readonly string[];
  /** Level name for the header (StoryLanguageData.levels); see levelName. */
  level?: string;
  /** Length hint for the header; see lengthHintFor. */
  lengthHint?: string;
  /** Characters to name. */
  names?: readonly string[];
  scene?: string;
  /** Words the reader knows (left out when empty). */
  vocabulary?: readonly string[];
  register?: Register;
  /** Region code; named through StoryLanguageData.regionNames. */
  region?: string;
  options?: Partial<StoryPromptOptions>;
}

export interface StoryPrompt {
  /** The whole prompt: prefix + suffix. */
  prompt: string;
  /** Everything up to the last line break: the same for every tag. */
  prefix: string;
  /** The final tag. */
  suffix: string;
  /** Header lines, for leak detection. */
  headerLines: string[];
  /** The vocabulary line among them, or null. */
  vocabularyLine: string | null;
}

/** Parts of speech preferred as a tag (content words); a word the pack does not know counts as one. */
const TAG_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

/**
 * The tag word of a sentence: its rarest content word by pack.frequencyRank (a word
 * outside the frequency list counts as rarest; a function word only when the sentence
 * has no content word), skipping names (PROPN, a capitalized word the pack does not
 * know, and `names`). Lowercase surface form as
 * written; '' when the sentence has no such word. Language-neutral: words come from
 * pack.segment.
 */
export function tagFor(pack: LanguagePack, sentence: string, names: readonly string[] = []): string {
  const skip = new Set(names.map((n) => pack.normalize(n)));
  let best = '';
  let bestRank = -1;
  let bestContent = false;
  for (const seg of pack.segment(sentence)) {
    if (seg.kind !== 'word') continue;
    const norm = seg.norm || pack.normalize(seg.text);
    if (!norm || skip.has(norm)) continue;
    const a = pack.analyze(norm)[0];
    // A capitalized word the pack does not know is most likely a name, at a sentence start too.
    if (a?.pos === 'PROPN' || (!a && isCapitalized(seg.text))) continue;
    const rank = a ? pack.frequencyRank(a.lemma) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const content = !a || TAG_POS.has(a.pos);
    if ((content && !bestContent) || (content === bestContent && rank > bestRank)) {
      bestRank = rank;
      bestContent = content;
      best = seg.text.toLocaleLowerCase(pack.code);
    }
  }
  return best;
}

/** Level name for an estimated vocabulary: the first StoryLanguageData.levels entry whose upTo is at least vocab. */
export function levelName(data: StoryLanguageData | undefined, vocab: number): string | undefined {
  return data?.levels?.find((l) => vocab <= l.upTo)?.name;
}

/** Length hint for the longest sentence allowed: the first lengthHints entry whose maxWords is at least it. */
export function lengthHintFor(data: StoryLanguageData | undefined, maxWords: number): string | undefined {
  return data?.lengthHints?.find((h) => maxWords <= h.maxWords)?.text;
}

/**
 * Build the continuation prompt (see the module comment for the layout). Header lines
 * whose wording or value is missing are left out; with no header line at all the
 * prompt starts with the story lines. Story lines are the last `contextSentences`
 * sentences; when there are fewer than minLines, the pack's example lines come first.
 * Line breaks inside a sentence become spaces.
 */
export function buildStoryPrompt(pack: LanguagePack, input: StoryPromptInput): StoryPrompt {
  const o: StoryPromptOptions = { ...DEFAULT_STORY_PROMPT_OPTIONS, ...input.options };
  const data = pack.story;
  const t = data?.prompt;
  const names = [...new Set((input.names ?? []).map((n) => n.trim()).filter(Boolean))];
  const headerLines: string[] = [];
  let vocabularyLine: string | null = null;
  if (t) {
    const sep = t.listSeparator;
    const level = input.level ? fill(t.level, { name: input.level }) : '';
    const hint = input.lengthHint ? fill(t.lengthHint, { text: input.lengthHint }) : '';
    if (t.header) headerLines.push(fill(t.header, { level, lengthHint: hint }));
    if (t.characters && names.length) headerLines.push(fill(t.characters, { names: names.join(sep) }));
    if (t.scene && input.scene?.trim()) headerLines.push(fill(t.scene, { scene: input.scene.trim() }));
    const vocab = [...new Set((input.vocabulary ?? []).map((w) => w.trim()).filter(Boolean))];
    if (t.vocabulary && vocab.length) {
      vocabularyLine = fill(t.vocabulary, { words: vocab.join(sep) });
      headerLines.push(vocabularyLine);
    }
    if (input.register === 'street' && t.street) {
      const region = input.region ? data?.regionNames?.[input.region] ?? input.region : '';
      headerLines.push(fill(t.street, { region: region ? fill(t.streetRegion, { region }) : '' }));
    }
  }
  const keep = Math.max(0, Math.floor(o.contextSentences));
  const lines: StoryLine[] = input.story
    .map((x) => (typeof x === 'string' ? { text: x } : x))
    .map((x) => ({ ...x, text: x.text.replace(/\s+/gu, ' ').trim() }))
    .filter((x) => x.text !== '')
    .slice(keep === 0 ? input.story.length : -keep);
  const examples = (data?.examples ?? []).slice(0, Math.max(0, o.minLines - lines.length));
  const tagged = [...examples.map((e) => ({ text: e.text, tag: e.tag })), ...lines].map((l) => {
    const tag = l.tag?.trim() || tagFor(pack, l.text, names);
    return tag ? `${o.tagOpen}${tag}${o.tagClose}${o.tagSeparator}${l.text}` : l.text;
  });
  const tagWords = (typeof input.tag === 'string' ? [input.tag] : [...input.tag]).map((w) => w.trim()).filter(Boolean);
  const blocks: string[] = [];
  if (headerLines.length) blocks.push(headerLines.join('\n'));
  if (tagged.length) blocks.push(tagged.join('\n'));
  const prefix = blocks.length ? `${blocks.join('\n\n')}\n` : '';
  const suffix = tagWords.length ? `${o.tagOpen}${tagWords.join(o.tagJoiner)}${o.tagClose}` : '';
  return { prompt: prefix + suffix, prefix, suffix, headerLines, vocabularyLine };
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

/**
 * Answer labels and preamble words of the model itself. Qwen3 and similar instruct
 * models fall back to English meta talk whatever the language of the prompt ("Sentence:",
 * "Here is the next sentence:"), so these belong to the model, not to a language; each
 * pack adds its own (StoryLanguageData.labels, preambleWords).
 */
export const MODEL_META_LABELS: readonly string[] = [
  'sentence', 'next sentence', 'answer', 'response', 'output', 'story', 'assistant', 'model', 'translation',
];
export const MODEL_META_PREAMBLE_WORDS: readonly string[] = ['sentence', 'here', "here's", 'sure', 'next'];

export const DEFAULT_EXTRACT_OPTIONS: Readonly<ExtractOptions> = {
  minTrailingNative: 2,
  abbreviations: NO_ABBREVIATIONS,
  capitalize: true,
  addFinalPunctuation: true,
  labels: MODEL_META_LABELS,
  preambleWords: MODEL_META_PREAMBLE_WORDS,
};

/**
 * Extract options for a pack: the model's own labels and preamble words plus the pack's
 * (StoryLanguageData.labels, preambleWords) and the pack's abbreviations.
 */
export function extractOptionsFor(pack: Pick<LanguagePack, 'story' | 'abbreviations'>, base: Partial<ExtractOptions> = {}): Partial<ExtractOptions> {
  const d = pack.story;
  return {
    ...base,
    labels: [...(base.labels ?? MODEL_META_LABELS), ...(d?.labels ?? [])],
    preambleWords: [...(base.preambleWords ?? MODEL_META_PREAMBLE_WORDS), ...(d?.preambleWords ?? [])],
    abbreviations: base.abbreviations ?? pack.abbreviations ?? NO_ABBREVIATIONS,
  };
}

const DOUBLE_QUOTES = `"“”„«»`;
/**
 * Where a translation starts: a separator between spaces (" = ", " / ", " - "...) or the
 * model's own English label ("Translation:", "English:"). A label in the target language
 * ("Traducción:") is a pack leak pattern, so such a candidate is rejected instead.
 */
const TRANSLATION_CUT_RE = /\s+(?:=|\/|\||->|→|-|–)\s+|\b(?:translation|english|in english)\s*:/iu;

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
