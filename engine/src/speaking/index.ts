/**
 * Speaking module: the engine side of speaking first. Pure, deterministic and
 * language-neutral; language data comes from the packs (LanguagePack.commands, register
 * packs) and from the per-language option defaults in langDefaults.ts.
 *
 * - matchCommand: spoken commands (otra vez, más despacio, no sé, siguiente, listo, qué
 *   significa) in a recognized utterance, only when it is essentially the command.
 * - alignTranscript: expected vs heard words (landed, missed, substituted) and
 *   "Understood N of M words"; street register accepts clipped forms.
 * - retellMetrics, retellProgress, retellCoverage, RETELL_LANES: timed retell.
 * - addSpoken, spokenStats: minutes spoken per local day, today, total, streak.
 * - repairFlow, judgeAttempt, attemptRepair, repairEvents: prompt to self-repair before
 *   showing a fix.
 * - startNoSe, advanceNoSe: "no sé" (hear the answer, then repeat it).
 * - nativeReply: native-language answers get the target phrase to repeat.
 * - estimateDurationMs, estimateDurations: tile sizes before TTS timings exist.
 */
export {
  DEFAULT_COMMAND_OPTIONS,
  matchCommand,
} from './commands';
export type { CommandMatch, CommandOptions } from './commands';

export {
  DEFAULT_ALIGN_TRANSCRIPT_OPTIONS,
  alignTranscript,
  clippedEquivalences,
} from './align';
export type { AlignTranscriptOptions, AlignedWord, Alignment, ExtraWord, HeardWord, MatchKind, WordOutcome } from './align';

export {
  DEFAULT_COVERAGE_OPTIONS,
  DEFAULT_RETELL_OPTIONS,
  RETELL_LANES,
  contentLemmas,
  laneRemainingMs,
  retellCoverage,
  retellMetrics,
  retellProgress,
  retellRoundUi,
} from './retell';
export type { CoverageOptions, RetellChange, RetellCoverage, RetellMetrics, RetellOptions, RetellPause, RetellProgress, TimedWord } from './retell';

export {
  DEFAULT_SPOKEN_TIME_OPTIONS,
  addSpoken,
  creditedMs,
  dayKeyOf,
  emptySpokenLog,
  localDay,
  localDayNumber,
  minutesAndSeconds,
  restoreSpokenLog,
  spokenStats,
  spokenTodayUi,
} from './spokenTime';
export type { SpokenDay, SpokenStats, SpokenTimeLog, SpokenTimeOptions } from './spokenTime';

export {
  DEFAULT_JUDGE_ATTEMPT_OPTIONS,
  DEFAULT_REPAIR_OPTIONS,
  FINAL_REPAIR_PHASES,
  attemptRepair,
  blamedKey,
  isRepairFinal,
  judgeAttempt,
  repairEvents,
  repairFlow,
  repairOverlap,
  startRepair,
} from './repair';
export type { JudgeAttemptOptions, RepairAttempt, RepairHighlight, RepairInput, RepairOptions, RepairPhase, RepairState } from './repair';

export { DEFAULT_NO_SE_OPTIONS, NO_SE_STEPS, advanceNoSe, startNoSe } from './noSe';
export type { NoSeInput, NoSeOptions, NoSeState, NoSeStep } from './noSe';

export { nativeReply } from './native';
export type { NativePhrase, NativeReply, NativeReplyOptions } from './native';

export { DEFAULT_DURATION_OPTIONS, estimateDurationMs, estimateDurations, fallbackSyllables } from './duration';
export type { DurationOptions, WordDuration } from './duration';

export { DEFAULT_FILLERS, DEFAULT_STREET_SUFFIXES, defaultFillers, defaultStreetSuffixes } from './langDefaults';

// text.ts holds internal helpers. Its UiText is structurally identical to lyrics' UiText
// (which the engine exports), so it is not re-exported here, to keep one name per type.
