import { locateAnswer, type LanguagePack, type SentenceView } from '@cliffword/engine';

/** A run of words in a sentence (ViewWord indices). */
export interface WordSpan {
  wordIndex: number;
  length: number;
}

/**
 * Where the cliff's actual words sit in a sentence, for the answer highlight on a landing or
 * a no-sé screen (the landing screen names the words, not their position). Located with the
 * language pack's segmenter (engine locateAnswer), never by splitting on spaces.
 */
export function answerSpan(pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>, sentence: SentenceView, expected: string): WordSpan | null {
  const span = locateAnswer(pack, sentence.text, expected);
  return span ? { wordIndex: span.wordIndex, length: span.length } : null;
}

export function inSpan(span: WordSpan | null | undefined, index: number): boolean {
  return !!span && index >= span.wordIndex && index < span.wordIndex + span.length;
}
