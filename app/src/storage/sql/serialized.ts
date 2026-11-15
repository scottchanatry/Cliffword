/**
 * Turns a driver into a `SqlDatabase`: one queue for every call, and transactions that hold
 * the queue until they finish.
 *
 * Why a queue: expo-sqlite has one connection per database, and a statement started while a
 * `withTransactionAsync` task is running joins that transaction (and is rolled back with it),
 * while a second `withTransactionAsync` started meanwhile fails ("cannot start a transaction
 * within a transaction"). Queuing every call keeps transactions isolated on one connection, on
 * every platform, without `withExclusiveTransactionAsync` (not available on web).
 *
 * Ordering guarantee: calls run in the order they were made. A caller that changes in-memory
 * state and starts the matching write in the same synchronous step (no `await` in between)
 * can rely on every later call seeing that write.
 */
import type { SqlDatabase, SqlDriver, SqlExecutor, SqlParams, SqlRow, SqlTransaction } from './types';

const NO_PARAMS: SqlParams = [];

export function createSqlDatabase(driver: SqlDriver): SqlDatabase {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;

  /** Run `job` after every earlier call has settled. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error(`${driver.name}: database is closed`));
    const result = tail.then(job);
    tail = result.catch(() => undefined);
    return result;
  }

  /** Direct calls on the driver; `check` throws when they are no longer allowed. */
  function executor(check: () => void): SqlExecutor {
    return {
      async exec(sql) {
        check();
        await driver.exec(sql);
      },
      async run(sql, params = NO_PARAMS) {
        check();
        return driver.run(sql, params);
      },
      async all<T extends object = SqlRow>(sql: string, params: SqlParams = NO_PARAMS) {
        check();
        return (await driver.all(sql, params)) as unknown as T[];
      },
      async get<T extends object = SqlRow>(sql: string, params: SqlParams = NO_PARAMS) {
        check();
        return (await driver.get(sql, params)) as unknown as T | null;
      },
    };
  }

  const direct = executor(() => {
    if (closed) throw new Error(`${driver.name}: database is closed`);
  });

  async function runTransaction<T>(task: (tx: SqlTransaction) => Promise<T>): Promise<T> {
    let open = true;
    const base = executor(() => {
      if (!open) throw new Error(`${driver.name}: transaction is already finished`);
    });
    const tx: SqlTransaction = {
      ...base,
      // Nested transactions join this one: an error that escapes them rolls back everything.
      transaction: (inner) => inner(tx),
    };
    let value: T | undefined;
    try {
      await driver.withTransaction(async () => {
        value = await task(tx);
      });
    } finally {
      open = false;
    }
    return value as T;
  }

  return {
    exec: (sql) => enqueue(() => direct.exec(sql)),
    run: (sql, params) => enqueue(() => direct.run(sql, params)),
    all: <T extends object = SqlRow>(sql: string, params?: SqlParams) => enqueue(() => direct.all<T>(sql, params)),
    get: <T extends object = SqlRow>(sql: string, params?: SqlParams) => enqueue(() => direct.get<T>(sql, params)),
    transaction: (task) => enqueue(() => runTransaction(task)),
    close: () => {
      if (closed) return Promise.resolve();
      return enqueue(async () => {
        if (closed) return;
        closed = true;
        await driver.close();
      });
    },
  };
}
