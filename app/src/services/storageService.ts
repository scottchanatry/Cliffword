/**
 * The storage service in the container: a handle that opens the app's database once, on first
 * use, and hands out the repositories. Opening is async (SQLite file, migrations), so the
 * container holds the handle and AppBootstrap calls open() at startup.
 *
 * - iOS / Android: expo-sqlite, the file cliffword.db (src/storage/open.ts).
 * - Web preview: sql.js in memory (src/storage/open.web.ts), gone on reload.
 * - Tests: sql.js in memory with deterministic ids (testServices.ts).
 */
import type { Clock } from '../adapters/clock/types';
import { createId, type StorageClock } from '../storage/clock';
import type { Storage, StorageBackend } from '../storage/storage';

export interface StorageService {
  /** Where the data lives: 'expo-sqlite' (a file on the device) or 'sql.js-memory' (web preview, tests). */
  readonly backend: StorageBackend;
  /**
   * Opens and migrates the database on the first call; every later call returns the same
   * promise. When opening fails, the next call tries again.
   */
  open(): Promise<Storage>;
  /** Closes the database if it was opened. The next open() opens it afresh. */
  close(): Promise<void>;
}

/** A StorageService around an opener (openStorage for the platform, or an in-memory one for tests). */
export function createStorageService(backend: StorageBackend, opener: () => Promise<Storage>): StorageService {
  let opening: Promise<Storage> | null = null;
  const open = (): Promise<Storage> => {
    if (!opening) {
      const attempt = opener();
      opening = attempt;
      attempt.catch(() => {
        // Let the next open() retry (for example after the user taps Try again).
        if (opening === attempt) opening = null;
      });
    }
    return opening;
  };
  const close = async (): Promise<void> => {
    const current = opening;
    opening = null;
    if (!current) return;
    const storage = await current.catch(() => null);
    await storage?.close();
  };
  return { backend, open, close };
}

/**
 * The StorageClock the repositories need, from the container's Clock: times come from `clock`
 * (a FakeClock in tests), ids from `newId` (unique on the device by default).
 */
export function storageClockFor(clock: Clock, newId: () => string = () => createId(clock.now())): StorageClock {
  return { now: () => clock.now(), newId };
}
