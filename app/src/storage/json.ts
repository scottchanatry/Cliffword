/** JSON columns: write with `toJson`, read with `fromJson` (a broken value reads as the fallback). */

/** JSON text for a column. `undefined` is stored as null. */
export function toJson(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/** Parse a JSON column; returns `fallback` for a missing or malformed value. */
export function fromJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** SQLite has no boolean: 1 is true, anything else false. */
export const toFlag = (value: boolean): number => (value ? 1 : 0);
export const fromFlag = (value: unknown): boolean => value === 1;
