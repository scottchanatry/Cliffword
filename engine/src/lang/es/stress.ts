/**
 * Spanish stress and written-accent helpers.
 *
 * Spanish spelling marks stress only when it departs from the default rule: words that
 * end in a vowel, n or s are stressed on the next-to-last syllable, other words on the
 * last one. Adding an ending (plural, feminine, prefix) can move the default, so the
 * accent must be added or removed. These helpers find syllable nuclei, locate the
 * stressed vowel, and respell a word so the written accent matches a given stress.
 */

const ACUTE: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
const PLAIN: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };

/** True for any Spanish vowel letter (accented or not, ü included). */
export function isVowel(ch: string | undefined): boolean {
  return ch !== undefined && 'aeiouáéíóúü'.includes(ch);
}

/** Strong vowels (a e o) and accented weak vowels each form their own nucleus. */
function isStrong(ch: string): boolean {
  return 'aeoáéóíú'.includes(ch);
}

/** Remove acute accents only (keeps ü and ñ). */
export function removeAcute(s: string): string {
  let out = '';
  for (const ch of s) out += PLAIN[ch] ?? ch;
  return out;
}

/** Put an acute accent on the vowel at `index` (no-op if it is not a plain vowel). */
export function addAcute(s: string, index: number): string {
  const ch = s[index];
  if (ch === undefined) return s;
  const acc = ACUTE[ch];
  return acc ? s.slice(0, index) + acc + s.slice(index + 1) : s;
}

/** True if the word contains an acute accent. */
export function hasAcute(s: string): boolean {
  return /[áéíóú]/.test(s);
}

export interface Nucleus {
  start: number;
  /** Exclusive. */
  end: number;
  /** Index of the vowel that carries stress when this syllable is stressed. */
  stress: number;
}

/**
 * Syllable nuclei of a lowercase word.
 *
 * Method: scan vowel runs; the silent u of que/qui/gue/gui is not a vowel. Inside a
 * run, two strong vowels (a, e, o or an accented vowel) belong to different nuclei,
 * while unaccented i/u join their neighbour (diphthongs and triphthongs). The stressed
 * vowel of a nucleus is its accented vowel, else its strong vowel, else its last vowel.
 */
export function nuclei(word: string): Nucleus[] {
  const out: Nucleus[] = [];
  let i = 0;
  while (i < word.length) {
    const ch = word[i] as string;
    const silentU = ch === 'u' && (word[i - 1] === 'q' || word[i - 1] === 'g') && 'eéií'.includes(word[i + 1] ?? '');
    if (!isVowel(ch) || silentU) {
      i++;
      continue;
    }
    let j = i;
    while (j < word.length && isVowel(word[j])) j++;
    // Split the run [i, j) into nuclei.
    let segStart = i;
    let strongSeen = -1;
    for (let k = i; k < j; k++) {
      const c = word[k] as string;
      if (isStrong(c)) {
        if (strongSeen >= 0) {
          out.push(makeNucleus(word, segStart, k));
          segStart = k;
        }
        strongSeen = k;
      }
    }
    out.push(makeNucleus(word, segStart, j));
    i = j;
  }
  return out;
}

function makeNucleus(word: string, start: number, end: number): Nucleus {
  let stress = end - 1;
  for (let k = start; k < end; k++) if (/[áéíóú]/.test(word[k] as string)) return { start, end, stress: k };
  for (let k = start; k < end; k++) if ('aeo'.includes(word[k] as string)) return { start, end, stress: k };
  return { start, end, stress };
}

/** Index of the nucleus that the default (unaccented) stress rule picks. */
function defaultNucleus(word: string, ns: readonly Nucleus[]): number {
  if (ns.length <= 1) return 0;
  const last = word[word.length - 1] ?? '';
  return isVowel(last) || last === 'n' || last === 's' ? ns.length - 2 : ns.length - 1;
}

/** Character index of the stressed vowel of a lowercase word, or -1 if it has no vowel. */
export function stressedVowelIndex(word: string): number {
  for (let k = word.length - 1; k >= 0; k--) if (/[áéíóú]/.test(word[k] as string)) return k;
  const ns = nuclei(word);
  if (ns.length === 0) return -1;
  return (ns[defaultNucleus(word, ns)] as Nucleus).stress;
}

/** Number of syllables (nuclei) of a lowercase word. */
export function syllableCount(word: string): number {
  return nuclei(word).length;
}

/** True if the stressed syllable of the word is its last one. */
export function isFinalStress(word: string): boolean {
  const idx = stressedVowelIndex(word);
  const ns = nuclei(word);
  const last = ns[ns.length - 1];
  return last !== undefined && idx >= last.start && idx < last.end;
}

/**
 * Respell `plain` (a word written without acute accents) so that its stress falls on
 * the vowel at `stressIndex`.
 *
 * Method: compute where the default rule puts the stress; if that is a different vowel
 * (including the weak vowel of a hiatus, as in "países"), write an acute on the intended
 * vowel. Monosyllables never get an accent here.
 */
export function respell(plain: string, stressIndex: number): string {
  if (stressIndex < 0) return plain;
  const ns = nuclei(plain);
  if (ns.length <= 1) return plain;
  const d = (ns[defaultNucleus(plain, ns)] as Nucleus).stress;
  return d === stressIndex ? plain : addAcute(plain, stressIndex);
}

/**
 * Attach a suffix to a word while keeping its original stress: removes the accent from
 * the base, appends the suffix (optionally replacing the last `drop` characters), and
 * respells. "joven"+"es" -> "jóvenes", "canción"+"es" -> "canciones",
 * "alemán"+"a" -> "alemana", "país"+"es" -> "países".
 */
export function suffixKeepingStress(word: string, suffix: string, drop = 0): string {
  const idx = stressedVowelIndex(word);
  const plain = removeAcute(word).slice(0, word.length - drop) + suffix;
  return respell(plain, idx);
}

/**
 * Prefix a word while keeping its stress: "ten" -> "mantén", "vio" -> "previó",
 * "tienes" -> "mantienes". A prefix without vowels (as f+reír) does not change spelling.
 * An h between the prefix's last vowel and a stressed i or u does not break the hiatus
 * in spelling, so that vowel takes an accent: "hice" -> "rehíce", "hizo" -> "rehízo"
 * (like prohíbe, rehúso).
 */
export function prefixKeepingStress(prefix: string, word: string): string {
  if (!/[aeiouáéíóú]/.test(prefix)) return prefix + word;
  const idx = stressedVowelIndex(word);
  const out = respell(prefix + removeAcute(word), idx < 0 ? -1 : prefix.length + idx);
  if (idx === 1 && /^h[iu]/.test(removeAcute(word)) && /[aeiouáéíóú]$/.test(prefix) && !hasAcute(out)) {
    return addAcute(out, prefix.length + 1);
  }
  return out;
}

/** Put an acute accent on the last vowel of a word ("tuvie" -> "tuvié"). */
export function accentLastVowel(word: string): string {
  for (let k = word.length - 1; k >= 0; k--) {
    const ch = word[k] as string;
    if (PLAIN[ch]) return word;
    if (ACUTE[ch]) return addAcute(word, k);
  }
  return word;
}
