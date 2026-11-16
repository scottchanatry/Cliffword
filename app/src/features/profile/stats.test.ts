import { estimateVocabulary, frequencyLexemeKeys, LearnerModel, spokenStats } from '@cliffword/engine';
import { defaultPacks } from '../../services/defaults';
import { skillCounts, spokenLogOf, weakestSkill, weekBars, weekTotal } from './stats';

const DAY = 86_400_000;
/** Monday 2026-11-16, 12:00 UTC. */
const NOON = Date.UTC(2026, 10, 16, 12);

describe('profile stats', () => {
  it('reads stored per-day totals as the engine log: today, total and streak', () => {
    const log = spokenLogOf([
      { day: '2026-11-16', ms: 125_000 },
      { day: '2026-11-15', ms: 60_000 },
      { day: '2026-11-13', ms: 30_000 },
      { day: '2026-11-01', ms: 600_000 },
      { day: '2026-10-31', ms: 0 },
    ]);
    expect(log.totalMs).toBe(815_000);
    const stats = spokenStats(log, NOON, 0);
    expect(stats).toMatchObject({ today: '2026-11-16', todayMs: 125_000, totalMs: 815_000, streakDays: 2 });
  });

  it('builds the last seven days ending today, with weekdays and shares of the best day', () => {
    const stats = spokenStats(spokenLogOf([
      { day: '2026-11-16', ms: 120_000 },
      { day: '2026-11-14', ms: 60_000 },
      { day: '2026-11-09', ms: 999_000 },
    ]), NOON, 0);
    const bars = weekBars(stats, NOON, 0);
    expect(bars.map((b) => b.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
    // 2026-11-16 is a Monday (1); the week runs Tuesday to Monday.
    expect(bars.map((b) => b.weekday)).toEqual([2, 3, 4, 5, 6, 0, 1]);
    expect(bars.map((b) => b.share)).toEqual([0, 0, 0, 0, 0.5, 0, 1]);
    expect(bars.filter((b) => b.today).map((b) => b.day)).toEqual(['2026-11-16']);
    expect(weekTotal(bars)).toBe(180_000);
  });

  it('follows the learner’s time zone for the local day', () => {
    // 23:30 UTC on Monday is already Tuesday in Madrid (+60).
    const late = Date.UTC(2026, 10, 16, 23, 30);
    const stats = spokenStats(spokenLogOf([{ day: '2026-11-17', ms: 1000 }]), late, 60);
    expect(weekBars(stats, late, 60).at(-1)).toMatchObject({ day: '2026-11-17', weekday: 2, ms: 1000, today: true });
    expect(weekBars(stats, late - 7 * DAY, 0).every((b) => b.ms === 0)).toBe(true);
  });

  it('counts words per skill like estimateVocabulary, so the meaning count is the words understood', () => {
    const { lang } = defaultPacks();
    const keys = frequencyLexemeKeys(lang);
    const learner = new LearnerModel();
    const at = NOON;
    learner.apply({ type: 'marked_known', key: keys[0] as string, at });
    const counts = skillCounts(learner, at, keys);
    expect(counts.meaning).toBe(Math.round(estimateVocabulary(learner, at, keys)));
    expect(counts.meaning).toBeGreaterThan(0);
    expect(counts.sound).toBeGreaterThanOrEqual(0);
    expect(counts.speaking).toBeGreaterThanOrEqual(0);
  });

  it('names the weakest skill only when the mix is lopsided and there is enough to say', () => {
    expect(weakestSkill({ meaning: 400, sound: 300, speaking: 90 })).toBe('speaking');
    expect(weakestSkill({ meaning: 100, sound: 40, speaking: 95 })).toBe('sound');
    expect(weakestSkill({ meaning: 400, sound: 380, speaking: 300 })).toBeNull();
    expect(weakestSkill({ meaning: 10, sound: 0, speaking: 0 })).toBeNull();
  });
});
