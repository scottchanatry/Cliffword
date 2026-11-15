/**
 * Schema migrations tracked with SQLite's `PRAGMA user_version`.
 *
 * `migrate` brings a database from its stored version up to the newest migration (or to
 * `opts.to`). Each pending migration runs in its own transaction with the version bump, and
 * re-checks the version inside the transaction, so running it twice, or twice at once, is a
 * no-op. A database written by a newer app (version above every known migration) is refused
 * rather than touched.
 */
import type { SqlDatabase, SqlExecutor } from './sql/types';

export interface Migration {
  /** 1, 2, 3, ... with no gaps. */
  version: number;
  /** Short label for errors and logs. */
  name: string;
  /** SQL statements run in order. Static SQL only: no data, no parameters. */
  steps: readonly string[];
}

export interface MigrationResult {
  /** Version found when migrate started. */
  from: number;
  /** Version when it finished. */
  to: number;
  /** Versions this call applied, in order. */
  applied: number[];
}

/** The stored schema is newer than this app knows. Update the app; never downgrade the data. */
export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema version ${found} is newer than this app supports (${supported})`);
    this.name = 'SchemaTooNewError';
  }
}

/** A migration step failed; the database stays at `version - 1`. */
export class MigrationError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
    cause: unknown,
  ) {
    super(`Migration ${version} (${migrationName}) failed: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.name = 'MigrationError';
  }
}

/** Throws unless versions run 1, 2, 3, ... in order. */
export function assertValidMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration at position ${i} has version ${m.version}; expected ${i + 1}`);
    }
  });
}

export async function readSchemaVersion(db: SqlExecutor): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export async function migrate(
  db: SqlDatabase,
  migrations: readonly Migration[],
  opts: { to?: number } = {},
): Promise<MigrationResult> {
  assertValidMigrations(migrations);
  const latest = migrations.length;
  const target = opts.to ?? latest;
  if (!Number.isInteger(target) || target < 0 || target > latest) {
    throw new Error(`Cannot migrate to version ${target}; known versions are 0 to ${latest}`);
  }
  const from = await readSchemaVersion(db);
  if (from > latest) throw new SchemaTooNewError(from, latest);

  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= from || migration.version > target) continue;
    const ran = await db
      .transaction(async (tx) => {
        if ((await readSchemaVersion(tx)) >= migration.version) return false;
        for (const step of migration.steps) await tx.exec(step);
        // version is a validated integer, so it is safe to put in the SQL text.
        await tx.exec(`PRAGMA user_version = ${migration.version}`);
        return true;
      })
      .catch((error: unknown) => {
        throw new MigrationError(migration.version, migration.name, error);
      });
    if (ran) applied.push(migration.version);
  }
  return { from, to: await readSchemaVersion(db), applied };
}
