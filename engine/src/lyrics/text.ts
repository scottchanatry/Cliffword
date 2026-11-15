/**
 * Small, language-neutral helpers shared by the lyrics module.
 *
 * Words always come from LanguagePack.segment(); the helpers here only classify
 * characters (apostrophes, quotes, spaces) and fold words for tolerant comparison.
 */
import type { LanguagePack, RegisterPack, Segment } from '../lang/types';
import { DEFAULT_ACCENT_MARKS, foldAccents } from '../scoring/text';

/**
 * Display text the app looks up in PairPack.ui: an interface-string key and the values
 * for its {placeholders}. The engine never returns display text in a language.
 */
export interface UiText {
  key: string;
  params?: Readonly<Record<string, string | number>>;
}

/** Apostrophe-like characters normalized to "'" (typographic, modifier letter, backtick, acute). */
const APOSTROPHE_LIKE_RE = /[’‘‚‛ʼʹ′`´]/gu;
/** Double-quote-like characters normalized to '"'. Guillemets are kept: they are real punctuation. */
const DOUBLE_QUOTE_LIKE_RE = /[“”„‟″]/gu;
/** Any apostrophe after normalization ("'" plus the forms above, for text that was not normalized). */
const ANY_APOSTROPHE_RE = /['’‘‚‛ʼʹ′`´]/gu;
/** Unicode spaces other than the line break: no-break, thin, ideographic... become " ". */
const ODD_SPACE_RE = /[\t\v\f\u00a0\u1680\u2000-\u200A\u202F\u205F\u3000]/gu;
/** Invisible characters dropped from pasted text: zero-width space, BOM, direction marks. */
const INVISIBLE_RE = /[\u200B\u200E\u200F\u2060\uFEFF]/gu;

/**
 * Normalize pasted text: Unicode NFC, curly and other apostrophe-like marks to "'",
 * curly double quotes to '"', odd spaces (no-break, thin, tabs) to a plain space, and
 * invisible characters (zero-width space, BOM, direction marks) removed. Line breaks and
 * every other character are kept, so the result can still be split into lines.
 */
export function normalizeQuotes(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE_RE, '')
    .replace(APOSTROPHE_LIKE_RE, "'")
    .replace(DOUBLE_QUOTE_LIKE_RE, '"')
    .replace(ODD_SPACE_RE, ' ');
}

/** Remove every apostrophe from a word ("pa'" -> "pa", "'tá" -> "tá"). */
export function stripApostrophes(word: string): string {
  return word.replace(ANY_APOSTROPHE_RE, '');
}

/** Accent folding with the pack's own notion of accents, else the given combining marks. */
export function accentFolder(pack: Pick<LanguagePack, 'foldAccents'>, marks: string = DEFAULT_ACCENT_MARKS): (s: string) => string {
  return (s: string) => (pack.foldAccents ? pack.foldAccents(s) : foldAccents(s, marks));
}

/**
 * Tolerant comparison key for a normalized word: accents folded (pack.foldAccents, else
 * `marks`), apostrophes removed, lowercased. "'tá", "ta" and "TÁ" share the key "ta";
 * "pa'" and "pa" share "pa". Speech recognition and pasted lyrics drop these marks.
 */
export function looseKey(pack: Pick<LanguagePack, 'foldAccents'>, norm: string, marks: string = DEFAULT_ACCENT_MARKS): string {
  return stripApostrophes(accentFolder(pack, marks)(norm.toLowerCase())).toLowerCase();
}

/** Normalized form of a segment (its norm, else pack.normalize of its text). */
export function normOf(pack: Pick<LanguagePack, 'normalize'>, seg: Segment): string {
  return seg.norm || pack.normalize(seg.text);
}

/** Word segments of a text, in order (the indexing CliffPosition and WordScore use). */
export function wordSegmentsOf(pack: Pick<LanguagePack, 'segment'>, text: string): Segment[] {
  return pack.segment(text).filter((s) => s.kind === 'word');
}

/** Word and number segments of a text, in order (what a listener hears as words). */
export function contentSegmentsOf(pack: Pick<LanguagePack, 'segment'>, text: string): Segment[] {
  return pack.segment(text).filter((s) => s.kind === 'word' || s.kind === 'number');
}

/**
 * The register packs that apply for a region selection, exactly as scoring/context.ts
 * chooses them (scoringPrefix, slangIn, slangExemption): packs whose region is listed,
 * in the order of `regions`; every pack of the language pack when `regions` is empty.
 * Keeping the same rule means a word noted as slang here is also the word street
 * scoring exempts from shading.
 */
export function applicableRegisters(pack: Pick<LanguagePack, 'registers'>, regions: readonly string[]): RegisterPack[] {
  if (regions.length === 0) return [...pack.registers];
  const out: RegisterPack[] = [];
  for (const r of regions) for (const reg of pack.registers) if (reg.region === r && !out.includes(reg)) out.push(reg);
  return out;
}

/** Character-level Levenshtein distance between two strings (by code point). */
export function charDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      const sub = (prev[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1);
      cur.push(Math.min(sub, (prev[j] as number) + 1, (cur[j - 1] as number) + 1));
    }
    prev = cur;
  }
  return prev[y.length] as number;
}
