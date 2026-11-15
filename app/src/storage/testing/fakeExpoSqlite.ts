/**
 * A stand-in for expo-sqlite's SQLiteDatabase backed by sql.js, so the expo-sqlite driver and
 * openStorage can run their real SQL in Jest. withTransactionAsync behaves like expo-sqlite's:
 * BEGIN, the task, COMMIT or ROLLBACK, and no queue of its own.
 */
import type { Database } from 'sql.js';
import type { SQLiteBindValue } from 'expo-sqlite';
import type { ExpoSqliteConnection } from '../sql/expoSqlite';
import { loadSqlJs } from '../sql/sqljs';

export interface FakeExpoSqlite extends ExpoSqliteConnection {
  /** Names of the methods called, in order. */
  readonly calls: string[];
  readonly closed: boolean;
  /** The sql.js database behind it. */
  readonly raw: Database;
}

export async function createFakeExpoSqlite(): Promise<FakeExpoSqlite> {
  const SQL = await loadSqlJs();
  const raw = new SQL.Database();
  const calls: string[] = [];
  let closed = false;

  function rows<T>(source: string, params: SQLiteBindValue[]): T[] {
    const statement = raw.prepare(source);
    try {
      statement.bind(params as (string | number | null | Uint8Array)[]);
      const out: T[] = [];
      while (statement.step()) out.push(statement.getAsObject() as T);
      return out;
    } finally {
      statement.free();
    }
  }

  return {
    calls,
    raw,
    get closed() {
      return closed;
    },
    async execAsync(source) {
      calls.push('execAsync');
      raw.exec(source);
    },
    async runAsync(source, params) {
      calls.push('runAsync');
      raw.run(source, params as (string | number | null | Uint8Array)[]);
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
      return { changes, lastInsertRowId: typeof id === 'number' ? id : 0 };
    },
    async getAllAsync<T>(source: string, params: SQLiteBindValue[]) {
      calls.push('getAllAsync');
      return rows<T>(source, params);
    },
    async getFirstAsync<T>(source: string, params: SQLiteBindValue[]) {
      calls.push('getFirstAsync');
      return rows<T>(source, params)[0] ?? null;
    },
    async withTransactionAsync(task) {
      calls.push('withTransactionAsync');
      // Same steps as expo-sqlite 58's SQLiteDatabase.withTransactionAsync.
      try {
        raw.exec('BEGIN');
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          // Already rolled back; keep the original error.
        }
        throw error;
      }
    },
    async closeAsync() {
      calls.push('closeAsync');
      closed = true;
      raw.close();
    },
  };
}
