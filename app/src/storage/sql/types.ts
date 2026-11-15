/**
 * The tiny SQL contract every storage repository is written against.
 *
 * Two drivers implement it (see README.md in this folder):
 * - expo-sqlite on iOS and Android (`expoSqlite.ts`), the app's real database file;
 * - sql.js in memory (`sqljs.ts`), for Jest in Node and for the static web preview.
 *
 * Repositories only use `SqlExecutor` / `SqlDatabase`, never a driver, so both run the same SQL.
 */

/** A value SQLite can bind or return. Booleans are stored as 0 / 1; objects as JSON text. */
export type SqlValue = string | number | null | Uint8Array;

/** Positional parameters for `?` placeholders. */
export type SqlParams = readonly SqlValue[];

/** A result row keyed by column name. */
export type SqlRow = Record<string, SqlValue>;

/** What a write did. */
export interface SqlRunResult {
  /** Rows inserted, updated or deleted by the statement. */
  changes: number;
  /** Row id of the last inserted row on this connection. */
  lastInsertRowId: number;
}

/** Run statements and read rows. */
export interface SqlExecutor {
  /** Run one or more statements without parameters (DDL, PRAGMA). Never pass data here. */
  exec(sql: string): Promise<void>;
  /** Run one statement with parameters. */
  run(sql: string, params?: SqlParams): Promise<SqlRunResult>;
  /** All rows of a query. */
  all<T extends object = SqlRow>(sql: string, params?: SqlParams): Promise<T[]>;
  /** The first row of a query, or null. */
  get<T extends object = SqlRow>(sql: string, params?: SqlParams): Promise<T | null>;
}

/** Inside a transaction: the same calls, plus nested transactions that join the outer one. */
export interface SqlTransaction extends SqlExecutor {
  transaction<T>(task: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}

/**
 * A database connection.
 *
 * Every call is queued: calls run one at a time in the order they were made, and a
 * transaction holds the queue until it commits or rolls back, so work started elsewhere
 * never lands inside someone else's transaction. Inside `transaction`, use only the `tx`
 * argument; calling the database itself from inside a transaction task would wait for the
 * transaction to finish and never return.
 */
export interface SqlDatabase extends SqlExecutor {
  /** Commit when `task` resolves, roll back when it rejects. Returns what `task` returns. */
  transaction<T>(task: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  /** Close the connection. Later calls reject. */
  close(): Promise<void>;
}

/**
 * What a backend must provide. `createSqlDatabase` (serialized.ts) turns a driver into a
 * `SqlDatabase` with the queue and the transaction rules above.
 */
export interface SqlDriver {
  /** Short name for errors and logs, e.g. "expo-sqlite" or "sql.js". */
  readonly name: string;
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlParams): Promise<SqlRunResult>;
  all(sql: string, params: SqlParams): Promise<SqlRow[]>;
  get(sql: string, params: SqlParams): Promise<SqlRow | null>;
  /** BEGIN, run `task`, then COMMIT, or ROLLBACK if it rejects (and reject with its error). */
  withTransaction(task: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
