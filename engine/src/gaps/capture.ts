/**
 * Native-language gap capture.
 *
 * When a learner answers in the target language but falls back on native words ("Fui al
 * hardware store"), each run of native words is a gap: evidence that the learner needed a
 * target word they did not have. Gaps become `native_gap` learner events for the target
 * lexeme the pair pack proposes, and the app can offer the target phrase to repeat.
 *
 * Method
 * ------
 * 1. Segment the reply with the target pack (never assume spaces split words).
 * 2. A word is native when its normalized form is in `pair.nativeLexicon` and the target
 *    pack cannot analyze it, nor a variant of it with one accent added ("cafe" -> "café"),
 *    a clipping apostrophe added ("pa" -> "pa'"), or both ("ta" -> "'tá"). Words that
 *    are also target words ("no", "red", "pan") are therefore never gaps.
 * 3. Capitalized words in the middle of a sentence are treated as names ("Home Depot")
 *    and skipped, except for words listed in `alwaysNative` (English "I").
 * 4. Consecutive native words separated only by spaces or joiners (hyphens) form one gap;
 *    any other punctuation, a number or a target word ends the gap.
 * 5. Candidates: the pair's translation of the whole phrase first (for multi-word gaps),
 *    then each word's translations. Content words come before function words (a word
 *    whose best candidate is among the most frequent target lemmas), and content words
 *    are ordered head-first: last word first by default, since English and Chinese
 *    compounds put the head last ("hardware store" -> store).
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { LearnerEvent } from '../learner/types';
import { lexemeKey } from '../learner/types';
import { isCapitalized, isContent, sentenceStartFlags } from '../story/text';

/** Tunable numbers and data of gap capture. */
export interface GapOptions {
  /** Skip capitalized words that do not start a sentence (they are probably names). */
  skipCapitalized: boolean;
  /** Normalized native words that are native even when capitalized mid-sentence. */
  alwaysNative: readonly string[];
  /**
   * Accent variants tried before calling a word native: each listed base letter is
   * replaced, one position at a time, by each of its variants and looked up again.
   * Spanish defaults; pass {} for scripts without accents.
   */
  accentVariants: Readonly<Record<string, readonly string[]>>;
  /** Also try the word with a leading or trailing apostrophe ("ta" -> "'ta", "pa" -> "pa'"). */
  apostropheVariants: boolean;
  /** Punctuation that may join native words inside one gap when there is no space ("e-mail"). */
  joiners: readonly string[];
  /**
   * A native word is a function word when its best target candidate has a frequency rank
   * at or below this (1 = most frequent). Function-word candidates go last.
   */
  functionWordRank: number;
  /** Order of content words when building candidates: head-final languages use 'last-first'. */
  contentOrder: 'last-first' | 'first-last';
}

/** Defaults for English speakers learning Spanish. */
export const DEFAULT_GAP_OPTIONS: Readonly<GapOptions> = {
  skipCapitalized: true,
  alwaysNative: ['i'],
  accentVariants: { a: ['á'], e: ['é'], i: ['í'], o: ['ó'], u: ['ú', 'ü'], n: ['ñ'] },
  apostropheVariants: true,
  joiners: ['-', '‐'],
  functionWordRank: 50,
  contentOrder: 'last-first',
};

/** One native word inside a gap. */
export interface NativeGapWord {
  text: string;
  norm: string;
  start: number;
  end: number;
  /** pair.toTarget(norm): candidate target lemmas, best first. */
  candidates: string[];
  /** True when the word's best candidate is a very frequent target lemma (an article, a preposition). */
  functionWord: boolean;
}

/** A run of native words inside a target-language reply. */
export interface NativeGap {
  /** Character span of the gap in the reply (start inclusive, end exclusive). */
  start: number;
  end: number;
  /** The native text exactly as written, e.g. "hardware store". */
  text: string;
  words: NativeGapWord[];
  /** Candidate target lemmas for the whole gap, best first, without duplicates. */
  candidates: string[];
}

function resolve(options?: Partial<GapOptions>): GapOptions {
  return { ...DEFAULT_GAP_OPTIONS, ...options };
}

/**
 * Variants of a normalized word with one accent added at one position, per
 * `accentVariants` ("cafe" -> "cáfe", "café"; "manana" -> "mañana", ...).
 */
export function accentVariantsOf(norm: string, variants: Readonly<Record<string, readonly string[]>>): string[] {
  const out: string[] = [];
  const chars = [...norm];
  chars.forEach((ch, i) => {
    for (const v of variants[ch] ?? []) {
      out.push([...chars.slice(0, i), v, ...chars.slice(i + 1)].join(''));
    }
  });
  return out;
}

/**
 * True when the target pack recognizes the normalized word, directly or through an
 * accent variant, an apostrophe variant, or both at once ("ta" -> "'tá"): learners and
 * speech recognizers drop accents and clipping apostrophes.
 */
export function isTargetWord(norm: string, pack: LanguagePack, options?: Partial<GapOptions>): boolean {
  if (!norm) return false;
  if (pack.analyze(norm).length > 0) return true;
  const o = resolve(options);
  const bases = [norm, ...accentVariantsOf(norm, o.accentVariants)];
  const clip = o.apostropheVariants && !norm.includes("'");
  for (const b of bases) {
    if (b !== norm && pack.analyze(b).length > 0) return true;
    if (clip && (pack.analyze(`${b}'`).length > 0 || pack.analyze(`'${b}`).length > 0)) return true;
  }
  return false;
}

/**
 * True when a normalized word is a native-language word: it is in the pair's native
 * lexicon and the target pack does not recognize it (see isTargetWord).
 */
export function isNativeWord(
  norm: string,
  pack: LanguagePack,
  pair: PairPack,
  options?: Partial<GapOptions>,
): boolean {
  const n = norm.toLowerCase();
  if (!n || !pair.nativeLexicon.has(n)) return false;
  return !isTargetWord(n, pack, options);
}

/** Normalized form of a segment, falling back to pack.normalize when the segmenter left it empty. */
function segNorm(seg: Segment, pack: LanguagePack): string {
  return (seg.norm || pack.normalize(seg.text)).toLowerCase();
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * Merge candidates for a gap: phrase translation first (multi-word gaps), then content
 * words in head order, then function words, without duplicates.
 */
export function mergeCandidates(
  phraseCandidates: readonly string[],
  words: readonly NativeGapWord[],
  contentOrder: GapOptions['contentOrder'],
): string[] {
  const content = words.filter((w) => !w.functionWord);
  const ordered = contentOrder === 'last-first' ? [...content].reverse() : content;
  const fn = words.filter((w) => w.functionWord);
  return dedupe([...phraseCandidates, ...ordered.flatMap((w) => w.candidates), ...fn.flatMap((w) => w.candidates)]);
}

function makeWord(seg: Segment, norm: string, pack: LanguagePack, pair: PairPack, o: GapOptions): NativeGapWord {
  const candidates = pair.toTarget(norm);
  const best = candidates[0];
  const rank = best === undefined ? undefined : pack.frequencyRank(best);
  return {
    text: seg.text,
    norm,
    start: seg.start,
    end: seg.end,
    candidates: [...candidates],
    functionWord: rank !== undefined && rank <= o.functionWordRank,
  };
}

function finishGap(text: string, words: NativeGapWord[], pair: PairPack, o: GapOptions): NativeGap {
  const first = words[0] as NativeGapWord;
  const last = words[words.length - 1] as NativeGapWord;
  const phrase = words.length > 1 ? pair.toTarget(words.map((w) => w.norm).join(' ')) : [];
  return {
    start: first.start,
    end: last.end,
    text: text.slice(first.start, last.end),
    words,
    candidates: mergeCandidates(phrase, words, o.contentOrder),
  };
}

/**
 * Find runs of native-language words in a target-language text.
 *
 * Returns gaps in text order, each with its exact span, its native text and candidate
 * target lemmas (see the module comment for the method). Empty, punctuation-only and
 * all-target texts give [].
 */
export function findNativeGaps(
  text: string,
  pack: LanguagePack,
  pair: PairPack,
  options?: Partial<GapOptions>,
): NativeGap[] {
  const o = resolve(options);
  const always = new Set(o.alwaysNative);
  const segments = pack.segment(text);
  const starts = sentenceStartFlags(segments);
  const gaps: NativeGap[] = [];
  let current: NativeGapWord[] = [];
  /** Whether the separators seen since the last native word still allow joining. */
  let joinable = true;

  const close = () => {
    if (current.length) gaps.push(finishGap(text, current, pair, o));
    current = [];
  };

  segments.forEach((seg, i) => {
    if (seg.kind === 'space') return;
    if (seg.kind === 'punct') {
      if (!o.joiners.includes(seg.text)) joinable = false;
      return;
    }
    if (!isContent(seg) || seg.kind === 'number') {
      close();
      return;
    }
    const norm = segNorm(seg, pack);
    const name = o.skipCapitalized && !starts[i] && isCapitalized(seg.text) && !always.has(norm);
    if (name || !isNativeWord(norm, pack, pair, o)) {
      close();
      joinable = true;
      return;
    }
    if (!joinable) close();
    current.push(makeWord(seg, norm, pack, pair, o));
    joinable = true;
  });
  close();
  return gaps;
}

/**
 * The pack's lemma for a pair-pack candidate. Pair packs may return a dictionary form
 * that is not the pack's lemma (a feminine person noun such as "chica", whose lemma is
 * "chico"), so the candidate is analyzed: an analysis whose lemma is the candidate itself
 * wins, else the first analysis; an unknown candidate is its own lemma.
 */
export function candidateLemma(candidate: string, pack: LanguagePack): string {
  const analyses = pack.analyze(pack.normalize(candidate) || candidate);
  return analyses.find((a) => a.lemma === candidate)?.lemma ?? analyses[0]?.lemma ?? candidate;
}

/**
 * Learner events for captured gaps: one `native_gap` event per gap that has a candidate,
 * keyed by the lexeme of its best candidate (lexemeKey(pack.code, candidateLemma)), at
 * time `now`, so the key matches the keys story selection builds from pack.analyze.
 * Gaps without candidates give no event (there is no target word to credit).
 */
export function gapEvents(gaps: readonly NativeGap[], pack: LanguagePack, now: number): LearnerEvent[] {
  const events: LearnerEvent[] = [];
  for (const g of gaps) {
    const best = g.candidates[0];
    if (best === undefined || best === '') continue;
    events.push({ type: 'native_gap', key: lexemeKey(pack.code, candidateLemma(best, pack)), at: now });
  }
  return events;
}
