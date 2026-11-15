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
