/**
 * The numbers on the profile, as plain functions (tested in stats.test.ts):
 *
 * - spokenLogOf(days): the spoken_time rows as the engine's SpokenTimeLog, so spokenStats()
 *   gives today, the total and the streak exactly as the engine defines them.
 * - weekBars(stats, now, tzOffsetMin): the last seven local days ending today, oldest first,
 *   each with its weekday (0 Sunday to 6 Saturday) and the share of the week's best day.
 * - skillCounts(learner, now, keys): the expected number of words the learner has for each
 *   skill (meaning, sound, speaking), the same sum as the engine's estimateVocabulary (which is
 *   the meaning count), so "words you understand" and the skill mix agree.
 * - weakestSkill(counts): which skill to practise next, or null while the mix is balanced.
 */
import {
  dayKeyOf,
  lexemeOf,
  localDayNumber,
  type LearnerView,
  type Skill,
  type SpokenStats,
  type SpokenTimeLog,
} from '@cliffword/engine';

export interface SpokenDayRow {
  /** Local day, YYYY-MM-DD. */
  day: string;
  ms: number;
}

/** The stored per-day totals (storage.spokenTime.range) as the engine's spoken-time log. */
export function spokenLogOf(rows: readonly SpokenDayRow[]): SpokenTimeLog {
  const days: Record<string, number> = {};
  let totalMs = 0;
  for (const { day, ms } of rows) {
    if (!Number.isFinite(ms) || ms <= 0) continue;
    days[day] = (days[day] ?? 0) + ms;
    totalMs += ms;
  }
  return { version: 1, days, totalMs, utterances: 0, lastAt: null };
}

/** The learner's UTC offset in minutes at `at` (local minus UTC; the engine's tzOffsetMin). */
export function tzOffsetAt(at: number): number {
  return -new Date(at).getTimezoneOffset();
}

export interface WeekBar {
  /** Local day, YYYY-MM-DD. */
  day: string;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  ms: number;
  /** ms over the week's best day, 0 to 1 (0 for a week without speaking). */
  share: number;
  today: boolean;
}

/** The seven local days ending today, oldest first. */
export function weekBars(stats: Pick<SpokenStats, 'days'>, now: number, tzOffsetMin: number): WeekBar[] {
  const byDay = new Map(stats.days.map((d) => [d.day, d.ms] as const));
  const today = localDayNumber(now, tzOffsetMin);
  const bars = Array.from({ length: 7 }, (_, i) => {
    const n = today - 6 + i;
    const day = dayKeyOf(n);
    // Day 0 (1970-01-01) was a Thursday.
    const weekday = (((n + 4) % 7) + 7) % 7;
    return { day, weekday, ms: byDay.get(day) ?? 0, share: 0, today: n === today };
  });
  const best = Math.max(0, ...bars.map((b) => b.ms));
  return bars.map((b) => ({ ...b, share: best > 0 ? b.ms / best : 0 }));
}

/** ms spoken over the bars. */
export function weekTotal(bars: readonly WeekBar[]): number {
  return bars.reduce((sum, b) => sum + b.ms, 0);
}

/** The skills the profile shows ("written" is tracked too, but the app is speaking first). */
export const PROFILE_SKILLS = ['meaning', 'sound', 'speaking'] as const satisfies readonly Skill[];
export type ProfileSkill = (typeof PROFILE_SKILLS)[number];

export type SkillCounts = Readonly<Record<ProfileSkill, number>>;

/**
 * Expected words known per skill: the sum of pKnown(lexeme, skill) over the frequency list plus
 * every lexeme with evidence (forms count toward their lexeme once), as estimateVocabulary does
 * for meaning.
 */
export function skillCounts(learner: LearnerView, now: number, frequencyKeys: Iterable<string>): SkillCounts {
  const lexemes = new Set<string>();
  for (const k of frequencyKeys) if (k) lexemes.add(lexemeOf(k));
  for (const k of learner.knownKeys()) if (k) lexemes.add(lexemeOf(k));
  const counts: Record<ProfileSkill, number> = { meaning: 0, sound: 0, speaking: 0 };
  for (const key of lexemes) {
    for (const skill of PROFILE_SKILLS) {
      const p = learner.pKnown(key, skill, now);
      if (p > 0) counts[skill] += Math.min(1, p);
    }
  }
  return { meaning: Math.round(counts.meaning), sound: Math.round(counts.sound), speaking: Math.round(counts.speaking) };
}

/**
 * The skill furthest behind the best one, when it is at most `ratio` of it (and the best is at
 * least `minWords`); null while the mix is balanced or there is too little to say.
 */
export function weakestSkill(counts: SkillCounts, ratio = 0.6, minWords = 20): ProfileSkill | null {
  const best = Math.max(...PROFILE_SKILLS.map((s) => counts[s]));
  if (best < minWords) return null;
  let weakest: ProfileSkill = 'meaning';
  for (const s of PROFILE_SKILLS) if (counts[s] < counts[weakest]) weakest = s;
  return counts[weakest] <= best * ratio ? weakest : null;
}
