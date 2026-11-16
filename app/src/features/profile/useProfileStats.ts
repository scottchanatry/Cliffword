/**
 * The numbers on the profile. Minutes spoken (the headline metric) come from storage.spokenTime
 * as the engine's spoken-time log, read with spokenStats() and localDay (today, the total, the
 * streak) and weekBars() (the last seven days). Words come from the learner model: the engine's
 * estimateVocabulary over the frequency list (the expected count, so probable cognates already
 * count for a beginner) and the same sum per skill for the skill mix. Spoken time is read again
 * whenever the screen comes back into focus.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { estimateVocabulary, frequencyLexemeKeys, spokenStats } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import { useServices } from '../../services/ServicesProvider';
import { skillCounts, spokenLogOf, tzOffsetAt, weekBars, type SkillCounts, type SpokenDayRow, type WeekBar } from './stats';

export interface ProfileStats {
  /** Total time spoken, in ms (0 until storage has answered). */
  spokenMs: number;
  /** Spoken today (the learner's local day), in ms. */
  todayMs: number;
  /** The last seven local days, oldest first. */
  week: WeekBar[];
  /** Consecutive days with at least the engine's streak minimum. */
  streakDays: number;
  /** Rounded vocabulary estimate (words understood). */
  wordsKnown: number;
  /** Expected words known per skill. */
  skills: SkillCounts;
  /** Storage has answered (the minutes are real, not the zero placeholder). */
  loaded: boolean;
}

/** Every stored day (the repo takes calendar days, YYYY-MM-DD). */
const ALL_DAYS = { from: '1970-01-01', to: '9999-12-31' } as const;

export function useProfileStats(): ProfileStats & { refresh: () => void } {
  const { storage, learner } = useAppState();
  const { packs, clock } = useServices();
  const [rows, setRows] = useState<SpokenDayRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    storage.spokenTime.range(ALL_DAYS.from, ALL_DAYS.to).then(
      (days) => {
        if (current) setRows(days);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [storage, version]);

  const spoken = useMemo(() => {
    const now = clock.now();
    const tz = tzOffsetAt(now);
    const stats = spokenStats(spokenLogOf(rows ?? []), now, tz);
    // A refresh reads new rows, so the clock is read again too.
    return { stats, week: weekBars(stats, now, tz) };
  }, [rows, clock]);

  const words = useMemo(() => {
    const now = clock.now();
    const keys = frequencyLexemeKeys(packs.lang);
    return { wordsKnown: Math.round(estimateVocabulary(learner, now, keys)), skills: skillCounts(learner, now, keys) };
  }, [learner, clock, packs]);

  return {
    spokenMs: spoken.stats.totalMs,
    todayMs: spoken.stats.todayMs,
    week: spoken.week,
    streakDays: spoken.stats.streakDays,
    wordsKnown: words.wordsKnown,
    skills: words.skills,
    loaded: rows !== null,
    refresh,
  };
}
