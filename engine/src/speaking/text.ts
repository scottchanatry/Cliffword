/**
 * Small, language-neutral helpers shared by the speaking module.
 *
 * Words always come from LanguagePack.segment(); nothing here assumes that spaces
 * separate words. Folding (looseKey: case, accents, apostrophes), character distance and
 * the choice of register packs come from lyrics/text.ts, so the Story tab (speaking) and
 * the Music tab (lyrics) compare words the same way, and applicableRegisters follows
 * scoring/context.ts: a word street scoring treats as slang is also the word alignment
 * treats as slang.
 */
import type { LanguagePack } from '../lang/types';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import { looseKey, normOf } from '../lyrics/text';

export { accentFolder, applicableRegisters, charDistance, looseKey, normOf } from '../lyrics/text';
/** Display text as a PairPack.ui key and its {placeholder} values (shared with lyrics). */
export type { UiText } from '../lyrics/text';

/** A word or number of a text, as the speaking module compares it. */
export interface SpokenWord {
  /** Index among the word and number segments of its text. */
  index: number;
  /** Exact text of the segment. */
  text: string;
  /** Normalized form (the segment's norm, else pack.normalize of its text). */
  norm: string;
  /** Loose comparison key: lowercase, accents folded, apostrophes removed (looseKey). */
  key: string;
  start: number;
  end: number;
  kind: 'word' | 'number';
}

/**
 * The words and numbers of a text in order, with their loose keys: what a listener
 * hears as words. Punctuation and spaces are dropped; a segment whose loose key is
 * empty (a lone apostrophe) is dropped too.
 */
export function spokenWords(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  text: string,
  marks: string = DEFAULT_ACCENT_MARKS,
): SpokenWord[] {
  const out: SpokenWord[] = [];
  for (const seg of pack.segment(text)) {
    if (seg.kind !== 'word' && seg.kind !== 'number') continue;
    const norm = normOf(pack, seg);
    const key = looseKey(pack, norm, marks);
    if (!key) continue;
    out.push({ index: out.length, text: seg.text, norm, key, start: seg.start, end: seg.end, kind: seg.kind });
  }
  return out;
}

/**
 * Loose keys of the words of a short phrase (a command phrase, a filler, a register
 * form), through the pack's segmenter.
 */
export function phraseKeys(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  phrase: string,
  marks: string = DEFAULT_ACCENT_MARKS,
): string[] {
  return spokenWords(pack, phrase, marks).map((w) => w.key);
}

/** True if every character of `short` occurs in `long` in the same order. */
export function isSubsequence(short: string, long: string): boolean {
  const s = Array.from(short);
  let i = 0;
  for (const ch of long) {
    if (i < s.length && ch === s[i]) i++;
  }
  return i === s.length;
}

/** Number of code points in a string. */
export function codeLength(s: string): number {
  return Array.from(s).length;
}
