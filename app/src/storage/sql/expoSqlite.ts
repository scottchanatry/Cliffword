/**
 * expo-sqlite driver (SDK 58 async API) for iOS and Android.
 *
 * This file only imports types from expo-sqlite, so it can be tested in Jest with a fake
 * connection; `openStorage` in ../open.ts opens the real one.
 */
import type { SQLiteBindValue } from 'expo-sqlite';
import { createSqlDatabase } from './serialized';
import type { SqlDatabase, SqlDriver, SqlParams, SqlRow } from './types';

/**
 * The part of expo-sqlite's `SQLiteDatabase` this driver uses. A real `SQLiteDatabase`
 * satisfies it; tests pass a fake.
 */
export interface ExpoSqliteConnection {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SQLiteBindValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(source: string, params: SQLiteBindValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SQLiteBindValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

// expo-sqlite takes a mutable array; the params are never changed by it.
const bind = (params: SqlParams) => params as SQLiteBindValue[];

export function expoSqliteDriver(connection: ExpoSqliteConnection): SqlDriver {
  return {
    name: 'expo-sqlite',
    exec: (sql) => connection.execAsync(sql),
    async run(sql, params) {
      const { changes, lastInsertRowId } = await connection.runAsync(sql, bind(params));
      return { changes, lastInsertRowId };
    },
    all: (sql, params) => connection.getAllAsync<SqlRow>(sql, bind(params)),
    get: (sql, params) => connection.getFirstAsync<SqlRow>(sql, bind(params)),
    withTransaction: (task) => connection.withTransactionAsync(task),
    close: () => connection.closeAsync(),
  };
}

/** A queued `SqlDatabase` over an open expo-sqlite connection. */
export function fromExpoSqlite(connection: ExpoSqliteConnection): SqlDatabase {
  return createSqlDatabase(expoSqliteDriver(connection));
}
