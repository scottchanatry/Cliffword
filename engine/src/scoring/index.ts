/** Scoring module: word surprise, whole-word next-word distributions, cliffs and credit. */
export * from './types';
export * from './wordScores';
export * from './nextWord';
export * from './cliff';
export * from './context';
export {
  DEFAULT_ACCENT_MARKS,
  atSentenceStart,
  foldAccents,
  needsLeadingSpace,
  trimAnswer,
} from './text';
