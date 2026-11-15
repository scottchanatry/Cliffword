/** The level treated as silence, in dBFS. */
export const SILENCE_DB = -60;

/** Maps a dBFS level to 0..1 for a level meter: SILENCE_DB and below is 0, 0 dBFS is 1. */
export function levelToUnit(db: number, silenceDb: number = SILENCE_DB): number {
  if (!Number.isFinite(db)) return 0;
  const unit = (db - silenceDb) / -silenceDb;
  return Math.min(1, Math.max(0, unit));
}
