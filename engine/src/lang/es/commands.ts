/**
 * Spanish spoken commands (data): what a learner can say instead of an answer while
 * listening or speaking. The speaking module matches a recognized utterance against
 * these phrases (LanguagePack.commands); this file only lists them.
 *
 * Phrases are written lowercase with their accents, without punctuation ("qué
 * significa", not "¿Qué significa?"), words separated by single spaces. Each phrase
 * belongs to one command, and no phrase of one command occurs inside a phrase of
 * another, so a matcher never has to choose between two commands for the same words.
 * Polite tails ("por favor") are listed where learners commonly add them; a matcher may
 * also strip them itself.
 */
import type { SpokenCommandEntry } from '../types';

export const SPANISH_COMMANDS: readonly SpokenCommandEntry[] = [
  { command: 'again', phrases: ['otra vez', 'de nuevo', 'repite', 'repítelo', 'otra vez por favor'] },
  { command: 'slower', phrases: ['más despacio', 'despacio', 'más lento', 'más lento por favor'] },
  { command: 'dont_know', phrases: ['no sé', 'no lo sé', 'ni idea', 'no me acuerdo'] },
  { command: 'next', phrases: ['siguiente', 'sigue', 'adelante', 'la próxima'] },
  { command: 'done', phrases: ['listo', 'ya', 'terminé', 'ya terminé'] },
  { command: 'meaning', phrases: ['qué significa', 'qué quiere decir', 'qué es eso'] },
];

/**
 * Spanish fillers (LanguagePack.fillers): said around a spoken command without changing
 * it. matchCommand drops them ("eh, no sé" is "no sé"; "más despacio, por favor" is "más
 * despacio"). Deliberately left out: "ya" (a command of its own), "sí"/"si" ("no sé si
 * ..." must not become "no sé") and "no" (it changes meaning).
 */
export const SPANISH_FILLERS: readonly string[] = [
  'eh', 'em', 'ehm', 'mm', 'mmm', 'hm', 'hmm', 'um', 'uh', 'ah',
  'este', 'pues', 'bueno', 'vale', 'o sea', 'a ver', 'mira', 'oye',
  'por favor', 'perdón', 'perdona', 'disculpa',
];

/**
 * Spanish regular street endings (LanguagePack.streetEndings): -ado/-ao and the plural,
 * so "cansao" and "cansa'o" land for "cansado" in street register. Left out on purpose:
 * -ido/-ío, whose loose key "-io" collides with the preterite ("comió"), and the dropped
 * final s ("má'", "ve'"), which would match almost any word ending in s.
 */
export const SPANISH_STREET_ENDINGS: readonly (readonly [string, string])[] = [
  ['ado', 'ao'],
  ['ados', 'aos'],
];
