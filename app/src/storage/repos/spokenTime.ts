/**
 * Minutes spoken, the headline metric: utterance durations summed per local calendar day.
 *
 * Streak: consecutive days with speaking, ending today. A day without speaking yet does not
 * break the streak until it is over, so the streak counts back from yesterday when today is
 * still empty.
 */
import { addDays, isDayKey, localDayKey } from '../day';
import type { SqlDatabase } from '../sql/types';

export interface SpokenDay {
  /** Local day, YYYY-MM-DD. */
  day: string;
  ms: number;
}

export class SpokenTimeRepo {
  constructor(private readonly db: SqlDatabase) {}

  /** Add one utterance of `ms` milliseconds to the local day of `at`. */
  async addUtterance(ms: number, at: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`Bad utterance length: ${ms}`);
    if (!Number.isFinite(at)) throw new Error(`Bad utterance time: ${at}`);
    const rounded = Math.round(ms);
    if (rounded === 0) return;
    await this.db.run(
      'INSERT INTO spoken_time (day, ms) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET ms = ms + excluded.ms',
      [localDayKey(at), rounded],
    );
  }

  /** ms spoken on one local day. */
  async day(day: string): Promise<number> {
    const row = await this.db.get<{ ms: number }>('SELECT ms FROM spoken_time WHERE day = ?', [day]);
    return row?.ms ?? 0;
  }

  /** ms spoken today (the local day of `now`). */
  today(now: number): Promise<number> {
    return this.day(localDayKey(now));
  }

  /** ms spoken on every day. */
  async total(): Promise<number> {
    const row = await this.db.get<{ ms: number | null }>('SELECT SUM(ms) AS ms FROM spoken_time');
    return row?.ms ?? 0;
  }

  /** Days with speaking from `from` to `to` inclusive (YYYY-MM-DD), oldest first. */
  async range(from: string, to: string): Promise<SpokenDay[]> {
    if (!isDayKey(from) || !isDayKey(to)) throw new Error(`Bad day range: ${from} to ${to}`);
    return this.db.all<SpokenDay>('SELECT day, ms FROM spoken_time WHERE day >= ? AND day <= ? AND ms > 0 ORDER BY day', [
      from,
      to,
    ]);
  }

  /** Consecutive days with at least `minMs` spoken, ending today (or yesterday, see above). */
  async streak(now: number, minMs = 1): Promise<number> {
    const today = localDayKey(now);
    const rows = await this.db.all<{ day: string }>('SELECT day FROM spoken_time WHERE day <= ? AND ms >= ? ORDER BY day DESC', [
      today,
      minMs,
    ]);
    let expected = rows[0]?.day === today ? today : addDays(today, -1);
    let streak = 0;
    for (const { day } of rows) {
      if (day !== expected) break;
      streak++;
      expected = addDays(expected, -1);
    }
    return streak;
  }
}
