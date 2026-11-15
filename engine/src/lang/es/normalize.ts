/**
 * Normalization for Spanish word forms.
 *
 * normalize() is the single lookup key used by the whole pack: it lowercases, composes
 * accents (NFC), maps typographic apostrophes to "'", and trims edge punctuation while
 * keeping accents and the apostrophes of clipped street forms ('tá, pa', pa'lante).
 */

/** Characters accepted as an apostrophe. All are mapped to "'" by normalize(). */
export const APOSTROPHE_CHARS = "'’‘ʼ";

const APOSTROPHE_RE = /[’‘ʼ]/g;
const WORDISH_RE = /[\p{L}\p{M}\p{N}']/u;

/** Replace typographic apostrophes (’ ‘ ʼ) with the ASCII apostrophe. */
export function canonicalApostrophes(s: string): string {
  return s.replace(APOSTROPHE_RE, "'");
}

/** True if `ch` is one of the accepted apostrophe characters. */
export function isApostrophe(ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && APOSTROPHE_CHARS.includes(ch);
}

/**
 * Normalize one word for lookups.
 *
 * Method: NFC-compose, canonicalize apostrophes, lowercase, then drop leading and
 * trailing characters that are not letters, digits, combining marks or apostrophes
 * ("¡Hola!" -> "hola", "¿'tá?" -> "'tá"). Apostrophes at the edges are kept because
 * they mark clipped forms ("pa'", "'tá"), except when a word is wrapped in a pair of
 * them as quote marks ("'hola'" -> "hola"). A string with no letters or digits
 * normalizes to "". Inner punctuation is kept, so numbers like "3,5" survive.
 */
export function normalize(word: string): string {
  const s = canonicalApostrophes(word.normalize('NFC')).toLowerCase();
  let start = 0;
  let end = s.length;
  while (start < end && !WORDISH_RE.test(s[start] as string)) start++;
  while (end > start && !WORDISH_RE.test(s[end - 1] as string)) end--;
  let core = s.slice(start, end);
  if (!/[\p{L}\p{N}]/u.test(core)) return '';
  // A word wrapped in a pair of apostrophes is quoted, not clipped.
  if (core.length >= 3 && core.startsWith("'") && core.endsWith("'") && !core.slice(1, -1).includes("'")) {
    core = core.slice(1, -1);
  }
  return core;
}

/**
 * Remove accent marks but keep ñ distinct from n.
 *
 * Method: decompose (NFD), drop every combining mark except the tilde (U+0303) when it
 * sits on an n/N, then recompose. "está" -> "esta", "pingüino" -> "pinguino",
 * "niño" -> "niño", "ÁRBOL" -> "ARBOL".
 */
export function stripAccents(s: string): string {
  const d = s.normalize('NFD');
  let out = '';
  for (let i = 0; i < d.length; i++) {
    const ch = d[i] as string;
    if (/\p{M}/u.test(ch)) {
      const prev = out[out.length - 1];
      if (ch === '̃' && (prev === 'n' || prev === 'N')) out += ch;
      continue;
    }
    out += ch;
  }
  return out.normalize('NFC');
}
