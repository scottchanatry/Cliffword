/**
 * Web preview: the same schema and repositories over sql.js, in memory. Nothing persists
 * across reloads. expo-sqlite's own web build is not used: it needs a Metro change for
 * `.wasm` assets plus COOP/COEP headers that the static preview server does not send
 * (see README.md). Metro picks this file over open.ts for web, so sql.js (about 1 MB with its
 * WebAssembly inlined) is only in the web bundle.
 */
import { openSqlJsDatabase } from './sql/sqljs';
import { createStorage, prepareDatabase, type OpenStorageOptions, type Storage, type StorageBackend } from './storage';

export async function openStorage(opts: OpenStorageOptions = {}): Promise<Storage> {
  const db = await openSqlJsDatabase();
  await prepareDatabase(db);
  return createStorage(db, opts.clock);
}

export const STORAGE_BACKEND: StorageBackend = 'sql.js-memory';
