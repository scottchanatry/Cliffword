/**
 * Lyrics and brought text: the Music tab's lyric cliffs, sing-back and slang notes, and
 * cliff and surprise scoring on any text the learner brings (lyrics, articles,
 * transcripts). Pure, deterministic and language-neutral: words come from
 * LanguagePack.segment(), slang from the register packs, display text from PairPack.ui
 * keys. Nothing models a singer's pitch (it cannot be read from Apple Music audio).
 *
 * PairPack.ui keys referenced by results: echo.landed ({n}, {m});
 * lyrics.answer.spelling, lyrics.answer.neutralForStreet, lyrics.answer.streetForNeutral,
 * lyrics.answer.streetVariant, lyrics.answer.judgedNeutral ({answer}, {lyric}, {street},
 * {neutral}); slang.formality.*, slang.explicit, region.* (with slang.region).
 */
export {
  DEFAULT_LRC_TAGS,
  DEFAULT_PARSE_LYRICS_OPTIONS,
  SHAPE_JUNK_PATTERNS,
  SITE_JUNK_PATTERNS,
  SITE_JUNK_SUFFIXES,
  lyricLine,
  parseLyrics,
} from './parse';
export type { LyricLine, LyricSection, LyricStanza, Lyrics, ParseLyricsOptions, RemovedLine, RemovedReason, WordMark } from './parse';

export {
  DEFAULT_REGISTER_PAIR_OPTIONS,
  DEFAULT_SLANG_MATCH_OPTIONS,
  DEFAULT_SLANG_NOTE_OPTIONS,
  findSlangMatches,
  noteFor,
  registerEquivalents,
  registerPairs,
  slangNotes,
  songSlangNotes,
} from './slang';
export type {
  RegisterEquivalent,
  RegisterPair,
  RegisterSubstitution,
  SlangMatch,
  SlangMatchOptions,
  SlangNote,
  SlangNoteOptions,
  SongSlangNote,
} from './slang';

export {
  DEFAULT_BROUGHT_TEXT_CLIFF_OPTIONS,
  DEFAULT_LYRIC_ANSWER_OPTIONS,
  DEFAULT_LYRIC_CLIFF_OPTIONS,
  DEFAULT_TEXT_CLIFF_WEIGHTS,
  broughtTextCliffs,
  lyricCliffs,
  scoreLyricAnswer,
} from './cliffs';
export type {
  BroughtTextCliffOptions,
  CliffBoundary,
  LyricAnswerOptions,
  LyricAnswerResult,
  LyricAnswerTarget,
  LyricCliffOptions,
  LyricEquivalence,
  LyricEquivalenceKind,
  TextCliff,
  TextCliffOptions,
  TextCliffWeights,
  UnitCliffs,
} from './cliffs';

export { DEFAULT_SURPRISE_MAP_OPTIONS, surpriseMap } from './surprise';
export type { SurpriseMapOptions, SurpriseUnit } from './surprise';

export { DEFAULT_ALIGN_OPTIONS, alignWords, alignmentCost } from './align';
export type { AlignOp, AlignOptions, AlignStep, WordEquivalent } from './align';

export { DEFAULT_ECHO_OPTIONS, echoLine } from './echo';
export type { EchoExtra, EchoOptions, EchoResult, EchoStatus, EchoVia, EchoWord } from './echo';

export { DEFAULT_SPLIT_TEXT_OPTIONS, lyricUnits, splitTextUnits, unitsBefore, wordsKey } from './units';
export type { SplitTextOptions, TextUnit } from './units';

export { charDistance, looseKey, normalizeQuotes, stripApostrophes } from './text';
export type { UiText } from './text';
