/**
 * Units of text the lyrics module scores one at a time: the lines of parsed lyrics, or
 * the sentences of a text the learner brings (an article, a transcript, lyrics pasted as
 * prose). Each unit is scored after the units before it, the way a listener hears it.
 */
import type { LanguagePack } from '../lang/types';
import { splitSentences } from '../story/text';
import { needsLeadingSpace } from '../scoring/text';
import type { Lyrics } from './parse';
import { accentFolder, contentSegmentsOf, normOf } from './text';

export interface TextUnit {
  /** "l3" for a lyric line (its id), "s3" for a sentence. */
  id: string;
  index: number;
  text: string;
  /** Offset of the unit in the brought text (0 for lyric lines: offsets are within the line). */
  start: number;
  end: number;
  /** The same words occurred in an earlier unit (a chorus, a repeated phrase). */
  repeat: boolean;
  /** Left out of cliffs and context (an ad-lib line, when skipped). */
  skip: boolean;
  /** Lyric line start time, when the lyrics are timed. */
  startMs?: number;
  /** What joins this unit to the one before it when both are context: "\n" for lines, " " for sentences. */
  separator: string;
}

export interface SplitTextOptions {
  /**
   * Split at line breaks before splitting sentences. Transcripts and subtitles break
   * lines without punctuation, and an article's paragraphs are separate anyway.
   */
  splitLines: boolean;
  /** Abbreviations after which a period does not end a sentence (story/text.ts splitSentences). */
  abbreviations?: readonly string[];
}

export const DEFAULT_SPLIT_TEXT_OPTIONS: Readonly<SplitTextOptions> = {
  splitLines: true,
};

/** Key for "same words": content segments, normalized and accent-folded. */
export function wordsKey(pack: LanguagePack, text: string): string {
  const fold = accentFolder(pack);
  return contentSegmentsOf(pack, text)
    .map((s) => fold(normOf(pack, s)))
    .join(' ');
}

/**
 * Sentences of a brought text with their offsets: optional split at line breaks, then
 * story/text.ts splitSentences on each piece (trimmed; empty pieces dropped). A unit
 * whose words repeat an earlier unit's is marked repeat.
 */
export function splitTextUnits(pack: LanguagePack, text: string, opts: Partial<SplitTextOptions> = {}): TextUnit[] {
  const o: SplitTextOptions = { ...DEFAULT_SPLIT_TEXT_OPTIONS, ...opts };
  const blocks: { text: string; start: number }[] = [];
  if (o.splitLines) {
    const re = /[^\r\n]+/gu;
    for (let m = re.exec(text); m; m = re.exec(text)) blocks.push({ text: m[0], start: m.index });
  } else blocks.push({ text, start: 0 });
  const out: TextUnit[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    let cursor = 0;
    for (const piece of splitSentences(b.text, o.abbreviations)) {
      const at = b.text.indexOf(piece, cursor);
      const local = at >= 0 ? at : cursor;
      cursor = local + piece.length;
      const key = wordsKey(pack, piece);
      if (!key) continue;
      const index = out.length;
      out.push({
        id: `s${index}`,
        index,
        text: piece,
        start: b.start + local,
        end: b.start + local + piece.length,
        repeat: seen.has(key),
        skip: false,
        separator: ' ',
      });
      seen.add(key);
    }
  }
  return out;
}

/** The lines of parsed lyrics as units. Ad-lib lines are skipped when skipAdlibs. */
export function lyricUnits(lyrics: Lyrics, skipAdlibs: boolean): TextUnit[] {
  return lyrics.lines.map((line) => {
    const u: TextUnit = {
      id: line.id,
      index: line.index,
      text: line.text,
      start: 0,
      end: line.text.length,
      repeat: line.repeatOf !== undefined,
      skip: skipAdlibs && line.adlib,
      separator: '\n',
    };
    if (line.startMs !== undefined) u.startMs = line.startMs;
    return u;
  });
}

/**
 * The text before unit `u`: up to `count` earlier units that are not skipped, each
 * followed by its separator for lines ("a\nb\n") or joined by spaces for sentences
 * ("A. B."; no space in a script written without spaces), ready to follow a scoring
 * prefix.
 */
export function unitsBefore(units: readonly TextUnit[], u: number, count: number): string {
  const prev: TextUnit[] = [];
  for (let i = u - 1; i >= 0 && prev.length < count; i--) {
    const p = units[i] as TextUnit;
    if (!p.skip) prev.unshift(p);
  }
  if (prev.length === 0) return '';
  const sep = (units[u] as TextUnit).separator;
  if (sep === '\n') return prev.map((p) => p.text + '\n').join('');
  // A space only where the script uses one: Japanese or Chinese sentences follow each
  // other directly (needsLeadingSpace).
  if (sep === ' ') return prev.reduce((acc, p) => (acc === '' ? p.text : acc + (needsLeadingSpace(acc) ? ' ' : '') + p.text), '');
  return prev.map((p) => p.text).join(sep);
}
