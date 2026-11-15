/**
 * The time source for the app and its adapters. The engine takes time as an argument (ms since
 * the epoch) and never reads the system clock; the app reads it here, so tests swap in a
 * FakeClock and every timestamp (learner events, durations, received shares, music position)
 * is deterministic.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}
