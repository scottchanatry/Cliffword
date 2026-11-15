/**
 * Local calendar days as `YYYY-MM-DD` keys. Days follow the device's time zone at the moment
 * of the event, so an utterance at 23:50 counts for that evening.
 */
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function keyOf(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local day of a time (ms since the epoch). */
export function localDayKey(at: number): string {
  return keyOf(new Date(at));
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(value: string): boolean {
  const m = DAY_KEY.exec(value);
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return keyOf(date) === value;
}

/** The day `delta` days after `day` (negative for before), by calendar, not by 24 h steps. */
export function addDays(day: string, delta: number): string {
  const m = DAY_KEY.exec(day);
  if (!m) throw new Error(`Not a day key: ${day}`);
  return keyOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
}
