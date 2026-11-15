import type { StorageClock } from '../clock';

/** A clock for tests: fixed time you move by hand, and ids "id-1", "id-2", ... */
export interface TestClock extends StorageClock {
  set(ms: number): void;
  advance(ms: number): void;
}

/** 2026-11-15 12:00 local time. */
export const TEST_START = new Date(2026, 10, 15, 12, 0, 0).getTime();

export function createTestClock(start = TEST_START): TestClock {
  let time = start;
  let n = 0;
  return {
    now: () => time,
    newId: () => `id-${++n}`,
    set: (ms) => {
      time = ms;
    },
    advance: (ms) => {
      time += ms;
    },
  };
}
