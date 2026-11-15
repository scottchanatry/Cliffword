/**
 * Minutes spoken, the headline metric: a small, JSON-serializable log of credited
 * speaking time per local day, with today's total, the all-time total and the streak.
 *
 * The log is plain data (store it as JSON in SQLite); addSpoken is a pure reducer that
 * returns a new log, and spokenStats reads one. Time is always passed in: `at` in ms
 * since epoch and the learner's UTC offset in minutes (local time minus UTC, the ISO
 * 8601 sign: UTC-5 is -300, Madrid in summer is +120; in JavaScript that is
 * -new Date().getTimezoneOffset()). An utterance counts on the local day of `at`.
 */
import type { UiText } from './text';

/** Credited speaking time per local day. JSON-serializable; never mutated by this module. */
export interface SpokenTimeLog {
  readonly version: 1;
  /** Credited ms per local day, keyed "YYYY-MM-DD". */
  readonly days: Readonly<Record<string, number>>;
  /** Sum of every credited utterance (ms). */
  readonly totalMs: number;
  /** Utterances credited. */
  readonly utterances: number;
  /** `at` of the latest credited utterance (ms since epoch), or null. */
  readonly lastAt: number | null;
}

/** Tunable numbers of the spoken-time log. */
export interface SpokenTimeOptions {
  /** Utterances shorter than this (ms) are not credited. */
  minUtteranceMs: number;
  /** Longer utterances are credited only this much (ms). */
  maxUtteranceMs: number;
  /** A day counts toward the streak with at least this much credited time (ms). */
  streakMinMs: number;
}

/**
 * Defaults (judgement calls; calibrate from usage):
 * - minUtteranceMs 300: a press of the hold-to-speak area without speech, or a cough,
 *   is shorter; the shortest real answers ("sí", "ya") take about that long.
 * - maxUtteranceMs 120000: longer than any retell lane (60 s) with room for a long free
 *   answer; a longer hold is almost always a stuck press or an open microphone, so only
 *   two minutes are credited.
 * - streakMinMs 30000: about a dozen spoken answers. One stray command does not keep a
 *   streak alive; a short session does.
 */
export const DEFAULT_SPOKEN_TIME_OPTIONS: Readonly<SpokenTimeOptions> = {
  minUtteranceMs: 300,
  maxUtteranceMs: 120000,
  streakMinMs: 30000,
};

const DAY_MS = 86400000;
/** UTC offsets in use run from -12:00 to +14:00; anything outside is clamped. */
const MIN_OFFSET = -12 * 60;
const MAX_OFFSET = 14 * 60;

/** An empty log. */
export function emptySpokenLog(): SpokenTimeLog {
  return { version: 1, days: {}, totalMs: 0, utterances: 0, lastAt: null };
}

function offsetMs(tzOffsetMin: number): number {
  const t = Number.isFinite(tzOffsetMin) ? Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, tzOffsetMin)) : 0;
  return t * 60000;
}

/** Local day number (days since 1970-01-01 in local time) of an instant. */
export function localDayNumber(at: number, tzOffsetMin: number): number {
  return Math.floor((at + offsetMs(tzOffsetMin)) / DAY_MS);
}

/**
 * "YYYY-MM-DD" of a local day number (proleptic Gregorian calendar; Hinnant's
 * civil-from-days, so no Date object is involved).
 */
export function dayKeyOf(dayNumber: number): string {
  const z = Math.floor(dayNumber) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  const pad = (v: number, w: number) => String(v).padStart(w, '0');
  return `${y < 0 ? '-' : ''}${pad(Math.abs(y), 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** "YYYY-MM-DD" of the local day of an instant. */
export function localDay(at: number, tzOffsetMin: number): string {
  return dayKeyOf(localDayNumber(at, tzOffsetMin));
}

/** The credited length of an utterance: 0 below the floor, capped at the ceiling, 0 for invalid input. */
export function creditedMs(utteranceMs: number, opts: Partial<SpokenTimeOptions> = {}): number {
  const o: SpokenTimeOptions = { ...DEFAULT_SPOKEN_TIME_OPTIONS, ...opts };
  if (!Number.isFinite(utteranceMs) || utteranceMs < o.minUtteranceMs) return 0;
  return Math.min(Math.round(utteranceMs), o.maxUtteranceMs);
}

/**
 * Add an utterance (reducer): credit its length (creditedMs) to the local day of `at`.
 * Returns a new log; the input is unchanged. An utterance below the floor, or with a
 * non-finite length or time, returns the same log object.
 */
export function addSpoken(
  log: SpokenTimeLog,
  utteranceMs: number,
  at: number,
  tzOffsetMin: number,
  opts: Partial<SpokenTimeOptions> = {},
): SpokenTimeLog {
  const ms = creditedMs(utteranceMs, opts);
  if (ms <= 0 || !Number.isFinite(at)) return log;
  const day = localDay(at, tzOffsetMin);
  return {
    version: 1,
    days: { ...log.days, [day]: (log.days[day] ?? 0) + ms },
    totalMs: log.totalMs + ms,
    utterances: log.utterances + 1,
    lastAt: log.lastAt === null ? at : Math.max(log.lastAt, at),
  };
}

export interface SpokenDay {
  day: string;
  ms: number;
}

export interface SpokenStats {
  /** Local day of `now` ("YYYY-MM-DD"). */
  today: string;
  todayMs: number;
  totalMs: number;
  /**
   * Consecutive local days with at least streakMinMs, ending today when today already
   * qualifies, else ending yesterday (the streak is still alive until today ends).
   */
  streakDays: number;
  /** Today already counts toward the streak. */
  streakIncludesToday: boolean;
  /** Every day with credited time, oldest first. */
  days: SpokenDay[];
}

/** Today's total, the all-time total, the streak and the per-day totals at time `now`. */
export function spokenStats(
  log: SpokenTimeLog,
  now: number,
  tzOffsetMin: number,
  opts: Partial<SpokenTimeOptions> = {},
): SpokenStats {
  const o: SpokenTimeOptions = { ...DEFAULT_SPOKEN_TIME_OPTIONS, ...opts };
  const todayNumber = localDayNumber(now, tzOffsetMin);
  const today = dayKeyOf(todayNumber);
  const todayMs = log.days[today] ?? 0;
  const qualifies = (n: number) => (log.days[dayKeyOf(n)] ?? 0) >= o.streakMinMs;
  const streakIncludesToday = qualifies(todayNumber);
  let streakDays = 0;
  const limit = Object.keys(log.days).length;
  for (let n = streakIncludesToday ? todayNumber : todayNumber - 1; streakDays < limit && qualifies(n); n--) streakDays++;
  const days = Object.entries(log.days)
    .filter(([, ms]) => ms > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, ms]) => ({ day, ms }));
  return { today, todayMs, totalMs: log.totalMs, streakDays, streakIncludesToday, days };
}

/** Whole minutes and remaining seconds of a duration ("5:03" is { minutes: 5, seconds: 3 }). */
export function minutesAndSeconds(ms: number): { minutes: number; seconds: number } {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** "Spoken today: {minutes} min" as a PairPack.ui lookup ('stats.spokenToday'), with {seconds} too. */
export function spokenTodayUi(todayMs: number, key = 'stats.spokenToday'): UiText {
  return { key, params: minutesAndSeconds(todayMs) };
}

/**
 * A log from stored JSON (already parsed). Unknown or malformed input gives an empty
 * log; day entries that are not "YYYY-MM-DD" with a positive finite number are dropped,
 * and totalMs is never below the sum of the kept days.
 */
export function restoreSpokenLog(data: unknown): SpokenTimeLog {
  if (typeof data !== 'object' || data === null) return emptySpokenLog();
  const d = data as Record<string, unknown>;
  const days: Record<string, number> = {};
  let sum = 0;
  if (typeof d.days === 'object' && d.days !== null) {
    for (const [day, ms] of Object.entries(d.days as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) continue;
      days[day] = ms;
      sum += ms;
    }
  }
  const totalMs = typeof d.totalMs === 'number' && Number.isFinite(d.totalMs) ? Math.max(d.totalMs, sum) : sum;
  const utterances = typeof d.utterances === 'number' && Number.isFinite(d.utterances) && d.utterances >= 0 ? Math.floor(d.utterances) : 0;
  const lastAt = typeof d.lastAt === 'number' && Number.isFinite(d.lastAt) ? d.lastAt : null;
  return { version: 1, days, totalMs, utterances, lastAt };
}
