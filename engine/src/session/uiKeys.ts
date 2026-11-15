/**
 * Every PairPack.ui key a session screen or step can carry, so a pair pack (or the app's
 * catalog) can check it covers them. Keys from the speaking and lyrics modules that pass
 * through sessions are listed too (repair.*, retell.round, stats.understood, echo.landed,
 * lyrics.answer.*).
 *
 * Placeholders: cliff.hint {sound}; landing.timesIn100 {n}; landing.justAsNatural {word};
 * story.asks {speaker}; retell.round {round} {rounds} {seconds}; stats.understood {n}
 * {m}; echo.landed {n} {m}; repair.expected {expected}; repair.fix {fix} {expected};
 * lyrics.answer.* {answer} {lyric} {street} {neutral}.
 */
export const SESSION_UI_KEYS: readonly string[] = [
  // Cliff prompts per rung, and the native-answer hint.
  'cliff.pickOne',
  'cliff.hint',
  'cliff.prompt',
  'cliff.answerInEnglish',
  'cliff.repeatAloud',
  // Landing: headline per credit reason, then the notes.
  'landing.actual',
  'landing.likely',
  'landing.plausible',
  'landing.form',
  'landing.unlikely',
  'landing.timesIn100',
  'landing.justAsNatural',
  // Learner turns and self-repair.
  'story.asks',
  'repair.prompt',
  'repair.expected',
  'repair.fix',
  // No sentence could be made.
  'story.noSentence',
  // Retell, repeats.
  'retell.round',
  'stats.understood',
  // Music.
  'music.singBack',
  'echo.landed',
  'lyrics.answer.spelling',
  'lyrics.answer.neutralForStreet',
  'lyrics.answer.streetForNeutral',
  'lyrics.answer.streetVariant',
  'lyrics.answer.judgedNeutral',
];
