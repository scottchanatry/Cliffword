/**
 * sql.js driver: SQLite compiled to WebAssembly, running in memory in the JS thread.
 *
 * Used by Jest (Node) and by the web preview. The build is `sql-wasm-inline.js`, which carries
 * the WebAssembly inside the JavaScript file, so it needs no `.wasm` asset in Metro, no file
 * lookup in Node, and no cross-origin isolation headers. The database lives in memory only.
 */
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import type { BindParams, Database, SqlJsStatic, SqlValue as SqlJsValue } from 'sql.js';
import { createSqlDatabase } from './serialized';
import type { SqlDatabase, SqlDriver, SqlParams, SqlRow } from './types';

let loading: Promise<SqlJsStatic> | undefined;

/** The sql.js module, loaded once per JS context. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= initSqlJs().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

function bindable(params: SqlParams): BindParams {
  return params as unknown as SqlJsValue[];
}

/** A driver over an open sql.js database. */
export function sqlJsDriver(db: Database): SqlDriver {
  function all(sql: string, params: SqlParams): SqlRow[] {
    const statement = db.prepare(sql);
    try {
      statement.bind(bindable(params));
      const rows: SqlRow[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as SqlRow);
      return rows;
    } finally {
      statement.free();
    }
  }

  return {
    name: 'sql.js',
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params) {
      db.run(sql, bindable(params));
      const changes = db.getRowsModified();
      const id = all('SELECT last_insert_rowid() AS id', [])[0]?.id;
      return { changes, lastInsertRowId: typeof id === 'number' ? id : 0 };
    },
    async all(sql, params) {
      return all(sql, params);
    },
    async get(sql, params) {
      return all(sql, params)[0] ?? null;
    },
    async withTransaction(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Some errors end the transaction themselves; nothing is left to roll back.
        }
        throw error;
      }
    },
    async close() {
      db.close();
    },
  };
}

/** A fresh in-memory database, optionally loaded from a serialized SQLite file. */
export async function openSqlJsDatabase(data?: Uint8Array): Promise<SqlDatabase> {
  const SQL = await loadSqlJs();
  return createSqlDatabase(sqlJsDriver(new SQL.Database(data)));
}
