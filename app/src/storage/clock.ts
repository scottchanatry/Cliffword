/**
 * Time and ids for repositories, injectable so tests are deterministic. Every repository
 * method that records a time also accepts an explicit one.
 */
export interface StorageClock {
  /** ms since the epoch. */
  now(): number;
  /** A new unique id for app-level rows (stories, sessions, songs). */
  newId(): string;
}

let counter = 0;

/** Unique on this device: time, a counter and randomness (no crypto module needed). */
export function createId(now: number = Date.now()): string {
  counter = (counter + 1) % 1_679_616; // 36^4
  const random = Math.floor(Math.random() * 2_176_782_336).toString(36).padStart(6, '0'); // 36^6
  return `${now.toString(36)}-${counter.toString(36).padStart(4, '0')}-${random}`;
}

export const systemClock: StorageClock = {
  now: () => Date.now(),
  newId: () => createId(),
};
