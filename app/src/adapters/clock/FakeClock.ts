import type { Clock } from './types';

/** 2026-11-15T00:00:00Z: the default start of a FakeClock. */
export const FAKE_CLOCK_START = Date.UTC(2026, 10, 15);

/**
 * A clock that only moves when a test moves it. Fakes that measure time (speech durations,
 * music position) read it, so a test controls them by advancing the clock.
 */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: number = FAKE_CLOCK_START) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  /** Moves the clock forward by `ms` (must be zero or more). Returns the new time. */
  advance(ms: number): number {
    if (!(ms >= 0)) throw new RangeError(`FakeClock.advance: ms must be >= 0, got ${ms}`);
    this.current += ms;
    return this.current;
  }

  /** Sets the time. Moving backwards is allowed, for tests of clock changes. */
  set(ms: number): void {
    this.current = ms;
  }
}
