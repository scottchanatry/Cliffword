/**
 * The storage facade: every repository over one database, and the setup every connection
 * gets before use (connection pragmas, then migrations).
 */
import { systemClock, type StorageClock } from './clock';
import { migrate, type MigrationResult } from './migrate';
import { LearnerRepo } from './repos/learner';
import { LyricsRepo } from './repos/lyrics';
import { ModelFileRepo } from './repos/modelFiles';
import { SessionRepo } from './repos/sessions';
import { SettingsRepo } from './repos/settings';
import { ShareInboxRepo } from './repos/shareInbox';
import { SongRepo } from './repos/songs';
import { SpokenTimeRepo } from './repos/spokenTime';
import { StoryRepo } from './repos/stories';
import { MIGRATIONS } from './schema';
import type { SqlDatabase } from './sql/types';

export interface Storage {
  readonly db: SqlDatabase;
  readonly settings: SettingsRepo;
  readonly learner: LearnerRepo;
  readonly sessions: SessionRepo;
  readonly stories: StoryRepo;
  readonly songs: SongRepo;
  readonly lyrics: LyricsRepo;
  readonly spokenTime: SpokenTimeRepo;
  readonly modelFiles: ModelFileRepo;
  readonly shareInbox: ShareInboxRepo;
  close(): Promise<void>;
}

/** Repositories over a database that is already prepared (see prepareDatabase). */
export function createStorage(db: SqlDatabase, clock: StorageClock = systemClock): Storage {
  return {
    db,
    settings: new SettingsRepo(db, clock),
    learner: new LearnerRepo(db),
    sessions: new SessionRepo(db, clock),
    stories: new StoryRepo(db, clock),
    songs: new SongRepo(db, clock),
    lyrics: new LyricsRepo(db, clock),
    spokenTime: new SpokenTimeRepo(db),
    modelFiles: new ModelFileRepo(db, clock),
    shareInbox: new ShareInboxRepo(db, clock),
    close: () => db.close(),
  };
}

/**
 * Per-connection settings (outside any transaction), then the schema migrations.
 * `journalWal` is for file databases (native); in-memory databases have no WAL.
 */
export async function prepareDatabase(db: SqlDatabase, opts: { journalWal?: boolean } = {}): Promise<MigrationResult> {
  if (opts.journalWal) await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  return migrate(db, MIGRATIONS);
}

export interface OpenStorageOptions {
  /** Database file name (native). Default "cliffword.db". */
  name?: string;
  clock?: StorageClock;
}

export const DATABASE_NAME = 'cliffword.db';

/** expo-sqlite: a file on the device. sql.js-memory: the web preview, gone on reload. */
export type StorageBackend = 'expo-sqlite' | 'sql.js-memory';
