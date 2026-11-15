import { MigrationError, SchemaTooNewError, migrate, readSchemaVersion, type Migration } from './migrate';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { openSqlJsDatabase } from './sql/sqljs';
import type { SqlDatabase } from './sql/types';
import { openTestDatabase } from './testing/openTestStorage';

const TABLES = [
  'learner_events',
  'learner_snapshots',
  'lyrics',
  'model_files',
  'sessions',
  'settings',
  'share_inbox',
  'songs',
  'spoken_time',
  'stories',
  'story_sentences',
];

async function names(db: SqlDatabase, type: 'table' | 'index'): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [type],
  );
  return rows.map((r) => r.name);
}

/** Every table's columns, to compare schemas built different ways. */
async function schemaShape(db: SqlDatabase): Promise<Record<string, string[]>> {
  const shape: Record<string, string[]> = {};
  for (const table of await names(db, 'table')) {
    const cols = await db.all<{ name: string; type: string; notnull: number; pk: number }>(`PRAGMA table_info(${table})`);
    shape[table] = cols.map((c) => `${c.name} ${c.type} ${c.notnull} ${c.pk}`);
  }
  return shape;
}

describe('migrations', () => {
  let db: SqlDatabase | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it('numbers the migrations 1..n', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('builds a fresh database at the latest version', async () => {
    db = await openTestDatabase({ to: 0 });
    expect(await readSchemaVersion(db)).toBe(0);
    const result = await migrate(db, MIGRATIONS);
    expect(result).toEqual({ from: 0, to: SCHEMA_VERSION, applied: MIGRATIONS.map((m) => m.version) });
    expect(await names(db, 'table')).toEqual(TABLES);
    expect(await names(db, 'index')).toEqual(
      expect.arrayContaining(['learner_events_at', 'learner_events_key', 'sessions_one_active', 'share_inbox_pending']),
    );
  });

  it('is idempotent: a second run, or two at once, applies nothing more', async () => {
    db = await openTestDatabase({ to: 0 });
    const [a, b] = await Promise.all([migrate(db, MIGRATIONS), migrate(db, MIGRATIONS)]);
    expect([...a.applied, ...b.applied].sort()).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await migrate(db, MIGRATIONS)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, applied: [] });
  });

  it('upgrades a v1 database and keeps its data', async () => {
    db = await openTestDatabase({ to: 1 });
    expect(await readSchemaVersion(db)).toBe(1);
    expect(await names(db, 'table')).not.toContain('songs');
    await db.run("INSERT INTO settings (key, value, updated_at) VALUES ('onboarded', 'true', 1)");
    await db.run("INSERT INTO learner_events (at, type, key, payload) VALUES (5, 'heard', 'es:casa', '{}')");
    await db.run("INSERT INTO stories (id, title, created_at) VALUES ('s1', 'La playa', 2)");
    await db.run("INSERT INTO story_sentences (story_id, idx, text) VALUES ('s1', 0, 'Marta llegó tarde.')");

    const result = await migrate(db, MIGRATIONS);
    expect(result).toEqual({ from: 1, to: SCHEMA_VERSION, applied: [2] });
    expect(await db.all('SELECT key, value FROM settings')).toEqual([{ key: 'onboarded', value: 'true' }]);
    expect(await db.get('SELECT type, key FROM learner_events')).toEqual({ type: 'heard', key: 'es:casa' });
    expect(await db.get('SELECT text FROM story_sentences')).toEqual({ text: 'Marta llegó tarde.' });

    const fresh = await openTestDatabase();
    expect(await schemaShape(db)).toEqual(await schemaShape(fresh));
    await fresh.close();
  });

  it('refuses a database from a newer app', async () => {
    db = await openSqlJsDatabase();
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db, MIGRATIONS)).rejects.toBeInstanceOf(SchemaTooNewError);
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION + 1);
  });

  it('rolls a failed migration back completely and stays at the previous version', async () => {
    const broken: Migration[] = [
      MIGRATIONS[0]!,
      { version: 2, name: 'broken', steps: ['CREATE TABLE half_done (x)', 'CREATE TABLE oops (']},
    ];
    db = await openSqlJsDatabase();
    const error = await migrate(db, broken).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).version).toBe(2);
    expect(await readSchemaVersion(db)).toBe(1);
    expect(await names(db, 'table')).not.toContain('half_done');
    // The real v2 still applies afterwards.
    expect((await migrate(db, MIGRATIONS)).applied).toEqual([2]);
  });

  it('rejects a list with gaps and an unknown target', async () => {
    db = await openSqlJsDatabase();
    await expect(migrate(db, [{ version: 2, name: 'gap', steps: [] }])).rejects.toThrow(/expected 1/);
    await expect(migrate(db, MIGRATIONS, { to: SCHEMA_VERSION + 1 })).rejects.toThrow(/Cannot migrate/);
  });
});
