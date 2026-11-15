/**
 * Opens the app's database on iOS and Android: expo-sqlite, a file in the app's documents
 * (kept across restarts and app updates), WAL journal, foreign keys on, schema migrated.
 * The web build uses open.web.ts instead (Metro picks it by platform extension).
 */
import { openDatabaseAsync } from 'expo-sqlite';
import { fromExpoSqlite } from './sql/expoSqlite';
import { createStorage, DATABASE_NAME, prepareDatabase, type OpenStorageOptions, type Storage, type StorageBackend } from './storage';

export async function openStorage(opts: OpenStorageOptions = {}): Promise<Storage> {
  const db = fromExpoSqlite(await openDatabaseAsync(opts.name ?? DATABASE_NAME));
  try {
    await prepareDatabase(db, { journalWal: true });
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
  return createStorage(db, opts.clock);
}

/** Where the data lives on this platform. */
export const STORAGE_BACKEND: StorageBackend = 'expo-sqlite';
