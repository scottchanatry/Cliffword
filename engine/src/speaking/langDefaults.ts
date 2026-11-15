/**
 * Per-language option defaults of the speaking module, keyed by LanguagePack.code.
 *
 * These are data, not code, and they are only defaults: every function that reads them
 * takes the same data through its options, and a pack whose code is not listed gets
 * none. They live here because the language-pack contract has no fields for them yet;
 * the natural home is the language pack (proposed: LanguagePack.fillers and a
 * RegisterPack field for regular street endings), at which point these maps go away.
 * Nothing else in the speaking module contains words of any language.
 */

/**
 * Words and short phrases a learner says around a spoken command without changing it:
 * hesitation sounds as recognizers spell them, discourse markers, polite tails.
 * matchCommand drops them ("eh, no sé" is "no sé"; "más despacio, por favor" is "más
 * despacio"). Written lowercase as the pack spells them; compared accent-insensitively.
 *
 * Spanish: deliberately left out are "ya" (a command of its own), "sí"/"si" ("no sé si
 * ..." must not become "no sé") and "no" (it changes meaning).
 */
export const DEFAULT_FILLERS: Readonly<Record<string, readonly string[]>> = {
  es: [
    'eh', 'em', 'ehm', 'mm', 'mmm', 'hm', 'hmm', 'um', 'uh', 'ah',
    'este', 'pues', 'bueno', 'vale', 'o sea', 'a ver', 'mira', 'oye',
    'por favor', 'perdón', 'perdona', 'disculpa',
  ],
};

/**
 * Regular street-register endings: pairs [full, street] of word endings, compared on
 * loose keys (lowercase, accents and apostrophes removed), so "cansao" and "cansa'o"
 * both match "cansado". Alignment in street register counts a word with one ending as
 * landed for the same word with the other.
 *
 * Spanish: -ado/-ao (and plural). Left out on purpose: -ido/-ío, whose loose key
 * "-io" collides with the preterite ("comió"), and the dropped final s ("má'", "ve'"),
 * which would match almost any word ending in s.
 */
export const DEFAULT_STREET_SUFFIXES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  es: [
    ['ado', 'ao'],
    ['ados', 'aos'],
  ],
};

/** Fillers for a pack: DEFAULT_FILLERS[pack.code], else none. */
export function defaultFillers(code: string): readonly string[] {
  return DEFAULT_FILLERS[code] ?? [];
}

/** Street endings for a pack: DEFAULT_STREET_SUFFIXES[pack.code], else none. */
export function defaultStreetSuffixes(code: string): readonly (readonly [string, string])[] {
  return DEFAULT_STREET_SUFFIXES[code] ?? [];
}
