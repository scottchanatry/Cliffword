/**
 * Placeholder story content for the scaffold, in the target language (content, not
 * interface text, so it does not go through i18n). The engine replaces it in the Story
 * stage: generateNextSentence picks sentences and pickCliff picks the gap.
 */
import type { LanguagePack } from '@cliffword/engine';

export interface SamplePassage {
  chapter: number;
  title: string;
  /** Text before the new word. */
  before: string;
  /** A word new for the learner, glossed below the passage. */
  newWord: string;
  /** Text after the new word, up to the cliff. */
  after: string;
}

export const SAMPLE_PASSAGE: SamplePassage = {
  chapter: 3,
  title: 'El mercado',
  before: 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su ',
  newWord: 'puesto',
  after: ' estaba cerrado. Entonces vio una nota en la puerta y empezó a',
};

/**
 * The passage's words, for tiles when text is hidden, split by the language pack (never by
 * spaces: a language without spaces between words needs its own segmenter). Punctuation and
 * spaces are not words.
 */
export function passageWords(p: SamplePassage, lang: Pick<LanguagePack, 'segment'>): string[] {
  return lang
    .segment(`${p.before}${p.newWord}${p.after}`)
    .filter((segment) => segment.kind === 'word' || segment.kind === 'number')
    .map((segment) => segment.text);
}
