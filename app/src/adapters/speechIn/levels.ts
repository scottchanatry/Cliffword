/** The level treated as silence, in dBFS. */
export const SILENCE_DB = -60;

/** Maps a dBFS level to 0..1 for a level meter: SILENCE_DB and below is 0, 0 dBFS is 1. */
export function levelToUnit(db: number, silenceDb: number = SILENCE_DB): number {
  if (!Number.isFinite(db)) return 0;
  const unit = (db - silenceDb) / -silenceDb;
  return Math.min(1, Math.max(0, unit));
}

/**
 * expo-speech-recognition's volumechange value (-2 to 10, "below 0 is inaudible") in dBFS.
 * iOS computes it from the buffer power as -2 + 12 * (dB + 60) / 60, so this is its exact
 * inverse: -2 -> -60 dBFS, 0 -> -50, 10 -> 0. Android passes the recognizer's rmsdB, which
 * uses about the same range, so the same mapping keeps the meter alike on both.
 */
export function moduleLevelToDb(value: number): number {
  if (!Number.isFinite(value)) return SILENCE_DB;
  return 5 * value - 50;
}

/**
 * Smooths levels for the hold-to-speak animation: rises fast (attack), falls slower (release),
 * so the shape follows syllables without flicker. Values are 0..1, rounded to 3 decimals.
 */
export class LevelMeter {
  private value = 0;

  constructor(
    private readonly attack = 0.6,
    private readonly release = 0.3,
  ) {}

  /** The meter value after a level of `db` dBFS. */
  push(db: number): number {
    const target = levelToUnit(db);
    const k = target > this.value ? this.attack : this.release;
    this.value += (target - this.value) * k;
    if (this.value < 0.001) this.value = 0;
    return Math.round(this.value * 1000) / 1000;
  }

  /** Back to 0 (session end). */
  reset(): void {
    this.value = 0;
  }

  get current(): number {
    return this.value;
  }
}
