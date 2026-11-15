import { describe, expect, it } from 'vitest';
import { createDefaultPairPack } from '../packs';
import {
  DEFAULT_SPOKEN_TIME_OPTIONS,
  addSpoken,
  creditedMs,
  dayKeyOf,
  emptySpokenLog,
  localDay,
  minutesAndSeconds,
  restoreSpokenLog,
  spokenStats,
  spokenTodayUi,
} from './spokenTime';
import type { SpokenTimeLog } from './spokenTime';

const pair = createDefaultPairPack();
/** UTC-5 (New York in winter): local = UTC - 5 h. */
const NY = -300;
/** UTC+1 (Madrid in winter). */
const MADRID = 60;
/** Local wall-clock time in a zone, as ms since epoch. */
const local = (tz: number, y: number, mo: number, d: number, h = 12, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - tz * 60000;

describe('local days', () => {
  it('formats day keys like the calendar does, without a Date object in the engine', () => {
    for (const ms of [0, Date.UTC(2000, 1, 29), Date.UTC(2026, 10, 15), Date.UTC(2100, 11, 31), Date.UTC(1969, 11, 31)]) {
      expect(dayKeyOf(Math.floor(ms / 86400000))).toBe(new Date(ms).toISOString().slice(0, 10));
    }
  });

  it('splits days at local midnight, in the learner\'s time zone', () => {
    const before = local(NY, 2026, 11, 15, 23, 59, 59);
    const after = local(NY, 2026, 11, 16, 0, 0, 1);
    expect(localDay(before, NY)).toBe('2026-11-15');
    expect(localDay(after, NY)).toBe('2026-11-16');
    // 23:59 in New York is already the next day in UTC and in Madrid.
    expect(localDay(before, 0)).toBe('2026-11-16');
    expect(localDay(before, MADRID)).toBe('2026-11-16');
    // Offsets beyond the real range are clamped; garbage counts as UTC.
    expect(localDay(Date.UTC(2026, 10, 15, 12), 100000)).toBe(localDay(Date.UTC(2026, 10, 15, 12), 14 * 60));
    expect(localDay(Date.UTC(2026, 10, 15, 23), Number.NaN)).toBe('2026-11-15');
  });
});

describe('addSpoken', () => {
  it('credits utterances to the local day of their time, with today and total', () => {
    let log = emptySpokenLog();
    log = addSpoken(log, 4000, local(NY, 2026, 11, 15, 23, 59, 30), NY);
    log = addSpoken(log, 2500, local(NY, 2026, 11, 16, 0, 0, 30), NY);
    log = addSpoken(log, 1500, local(NY, 2026, 11, 16, 8, 0), NY);
    expect(log.days).toEqual({ '2026-11-15': 4000, '2026-11-16': 4000 });
    expect(log.totalMs).toBe(8000);
    expect(log.utterances).toBe(3);
    expect(log.lastAt).toBe(local(NY, 2026, 11, 16, 8, 0));
    const stats = spokenStats(log, local(NY, 2026, 11, 16, 9, 0), NY);
    expect(stats.today).toBe('2026-11-16');
    expect(stats.todayMs).toBe(4000);
    expect(stats.totalMs).toBe(8000);
    expect(stats.days).toEqual([{ day: '2026-11-15', ms: 4000 }, { day: '2026-11-16', ms: 4000 }]);
  });

  it('floors tiny utterances and caps absurd ones', () => {
    const { minUtteranceMs, maxUtteranceMs } = DEFAULT_SPOKEN_TIME_OPTIONS;
    const t = local(MADRID, 2026, 11, 15);
    const empty = emptySpokenLog();
    expect(addSpoken(empty, minUtteranceMs - 1, t, MADRID)).toBe(empty);
    expect(addSpoken(empty, minUtteranceMs, t, MADRID).totalMs).toBe(minUtteranceMs);
    expect(addSpoken(empty, 45 * 60000, t, MADRID).totalMs).toBe(maxUtteranceMs);
    expect(creditedMs(Number.NaN)).toBe(0);
    expect(creditedMs(-5000)).toBe(0);
    expect(creditedMs(Infinity)).toBe(0);
    expect(creditedMs(1234.6)).toBe(1235);
    expect(addSpoken(empty, 2000, Number.NaN, MADRID)).toBe(empty);
    expect(addSpoken(empty, 100, t, MADRID, { minUtteranceMs: 50 }).totalMs).toBe(100);
  });

  it('never mutates the log it is given', () => {
    const a = emptySpokenLog();
    const b = addSpoken(a, 3000, local(0, 2026, 11, 15), 0);
    const c = addSpoken(b, 3000, local(0, 2026, 11, 15), 0);
    expect(a).toEqual(emptySpokenLog());
    expect(b.days).toEqual({ '2026-11-15': 3000 });
    expect(c.days).toEqual({ '2026-11-15': 6000 });
  });

  it('is plain JSON and survives a round trip', () => {
    let log = emptySpokenLog();
    log = addSpoken(log, 65000, local(NY, 2026, 11, 14), NY);
    log = addSpoken(log, 5000, local(NY, 2026, 11, 15), NY);
    const back = restoreSpokenLog(JSON.parse(JSON.stringify(log)));
    expect(back).toEqual(log);
  });

  it('restores defensively from stored data', () => {
    expect(restoreSpokenLog(null)).toEqual(emptySpokenLog());
    expect(restoreSpokenLog('nope')).toEqual(emptySpokenLog());
    const restored = restoreSpokenLog({ days: { '2026-11-15': 5000, 'yesterday': 10, '2026-11-14': -3, '2026-11-13': 'x' }, totalMs: 10, utterances: 2.7, lastAt: 'x' });
    expect(restored).toEqual({ version: 1, days: { '2026-11-15': 5000 }, totalMs: 5000, utterances: 2, lastAt: null });
  });
});

describe('spokenStats streak', () => {
  function logOn(days: Array<[number, number, number, number]>, tz: number): SpokenTimeLog {
    return days.reduce((log, [y, m, d, ms]) => addSpoken(log, ms, local(tz, y, m, d, 18), tz), emptySpokenLog());
  }

  it('counts consecutive local days with at least streakMinMs, today included once it qualifies', () => {
    const log = logOn([[2026, 11, 12, 60000], [2026, 11, 13, 40000], [2026, 11, 14, 35000], [2026, 11, 15, 31000]], NY);
    const s = spokenStats(log, local(NY, 2026, 11, 15, 20), NY);
    expect(s.streakDays).toBe(4);
    expect(s.streakIncludesToday).toBe(true);
  });

  it('keeps the streak alive until today ends', () => {
    const log = logOn([[2026, 11, 13, 40000], [2026, 11, 14, 40000], [2026, 11, 15, 10000]], NY);
    const s = spokenStats(log, local(NY, 2026, 11, 15, 20), NY);
    expect(s.streakIncludesToday).toBe(false); // 10 s today is not enough yet
    expect(s.streakDays).toBe(2);
    expect(s.todayMs).toBe(10000);
    // A day later with nothing spoken yesterday, the streak is gone.
    expect(spokenStats(log, local(NY, 2026, 11, 17, 9), NY).streakDays).toBe(0);
  });

  it('breaks on a missed day and on a day below the minimum', () => {
    const gap = logOn([[2026, 11, 12, 40000], [2026, 11, 14, 40000], [2026, 11, 15, 40000]], MADRID);
    expect(spokenStats(gap, local(MADRID, 2026, 11, 15, 22), MADRID).streakDays).toBe(2);
    const short = logOn([[2026, 11, 13, 40000], [2026, 11, 14, 29999], [2026, 11, 15, 40000]], MADRID);
    expect(spokenStats(short, local(MADRID, 2026, 11, 15, 22), MADRID).streakDays).toBe(1);
    expect(spokenStats(short, local(MADRID, 2026, 11, 15, 22), MADRID, { streakMinMs: 20000 }).streakDays).toBe(3);
  });

  it('reads "today" in the time zone it is asked in', () => {
    // Spoken at 23:30 in New York on the 15th: that is the 16th in UTC.
    const log = addSpoken(emptySpokenLog(), 40000, local(NY, 2026, 11, 15, 23, 30), NY);
    expect(spokenStats(log, local(NY, 2026, 11, 15, 23, 45), NY).todayMs).toBe(40000);
    expect(spokenStats(log, local(NY, 2026, 11, 15, 23, 45), 0).todayMs).toBe(0);
  });

  it('formats minutes and seconds for "Spoken today"', () => {
    expect(minutesAndSeconds(5 * 60000 + 3000 + 999)).toEqual({ minutes: 5, seconds: 3 }); // "5:03"
    expect(minutesAndSeconds(-1)).toEqual({ minutes: 0, seconds: 0 });
    expect(spokenTodayUi(252000)).toEqual({ key: 'stats.spokenToday', params: { minutes: 4, seconds: 12 } });
    expect(pair.ui['stats.spokenToday']).toContain('{minutes}');
  });
});
