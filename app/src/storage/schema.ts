/**
 * The database schema as a versioned list of migrations.
 *
 * Rules for changing it:
 * - Never edit a migration that has shipped. Add a new one with the next version.
 * - Each migration runs in its own transaction together with `PRAGMA user_version = N`, so a
 *   failure leaves the database at the previous version with nothing half-applied.
 * - Statements use IF NOT EXISTS so re-running a step is harmless.
 * - No CHECK constraints on value lists that may grow (session kinds, song sources, model file
 *   statuses): repositories validate them, and a new value never needs a table rebuild.
 *
 * All times are ms since the epoch (INTEGER). JSON columns hold TEXT.
 */
import type { Migration } from './migrate';

/** v1: settings, the learner model, sessions and stories. */
const CORE: Migration = {
  version: 1,
  name: 'core',
  steps: [
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // Append-only. payload holds the event's fields other than type, key and at.
    `CREATE TABLE IF NOT EXISTS learner_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    )`,
    'CREATE INDEX IF NOT EXISTS learner_events_key ON learner_events (key)',
    'CREATE INDEX IF NOT EXISTS learner_events_at ON learner_events (at)',
    // through_event_id: the snapshot includes every event with id <= it.
    `CREATE TABLE IF NOT EXISTS learner_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      version INTEGER NOT NULL,
      json TEXT NOT NULL,
      through_event_id INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    )`,
    'CREATE INDEX IF NOT EXISTS sessions_kind_updated ON sessions (kind, updated_at)',
    // At most one active (resumable) session per kind.
    'CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active ON sessions (kind) WHERE active = 1',
    `CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS story_sentences (
      story_id TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      json TEXT NOT NULL DEFAULT 'null',
      PRIMARY KEY (story_id, idx)
    )`,
  ],
};

/** v2: music (songs, lyrics), minutes spoken, model files and the share inbox. */
const MUSIC_AND_DEVICE: Migration = {
  version: 2,
  name: 'music-and-device',
  steps: [
    // external_id is NULL for manual songs; NULLs never collide in the UNIQUE constraint.
    `CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      artwork_url TEXT,
      added_at INTEGER NOT NULL,
      UNIQUE (source, external_id)
    )`,
    // Lyrics are pasted by the learner and stay on this device: never synced or exported.
    `CREATE TABLE IF NOT EXISTS lyrics (
      song_id TEXT PRIMARY KEY NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
      raw_text TEXT NOT NULL,
      parsed TEXT NOT NULL DEFAULT 'null',
      updated_at INTEGER NOT NULL
    )`,
    // day: the learner's local calendar day, YYYY-MM-DD.
    `CREATE TABLE IF NOT EXISTS spoken_time (
      day TEXT PRIMARY KEY NOT NULL,
      ms INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS model_files (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS share_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at INTEGER NOT NULL,
      url TEXT,
      text TEXT,
      handled INTEGER NOT NULL DEFAULT 0
    )`,
    'CREATE INDEX IF NOT EXISTS share_inbox_pending ON share_inbox (handled, received_at)',
  ],
};

/**
 * v3: the learner model's prior next to its snapshot. A prior is a function, so the row keeps
 * the engine's PriorSpec (JSON) that rebuilds it (buildPrior); NULL on older rows, where
 * settings.startLevel decides (src/learner/prior.ts). Written when placement replaces the prior.
 */
const LEARNER_PRIOR: Migration = {
  version: 3,
  name: 'learner-prior',
  steps: ['ALTER TABLE learner_snapshots ADD COLUMN prior TEXT'],
};

/**
 * v4: texts the learner brings (articles, transcripts) for cliffs and surprise shading. Like
 * lyrics they stay on this device. Songs gain the Apple Music genre (the song page's "artist ·
 * genre · region" line) and when they were last opened (the library puts recent songs first).
 */
const BROUGHT_TEXTS: Migration = {
  version: 4,
  name: 'brought-texts',
  steps: [
    `CREATE TABLE IF NOT EXISTS texts (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_opened_at INTEGER
    )`,
    'ALTER TABLE songs ADD COLUMN genre TEXT',
    'ALTER TABLE songs ADD COLUMN last_opened_at INTEGER',
  ],
};

export const MIGRATIONS: readonly Migration[] = [CORE, MUSIC_AND_DEVICE, LEARNER_PRIOR, BROUGHT_TEXTS];

/** The schema version this build of the app writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;
