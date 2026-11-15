/**
 * Lyrics the learner pasted for a song, with the parsed lines (the engine's lyrics JSON).
 *
 * Lyrics stay on this device: nothing here is synced, uploaded or included in any export,
 * because the learner's copy of a song's words is not ours to move.
 */
import type { StorageClock } from '../clock';
import { fromJson, toJson } from '../json';
import type { SqlDatabase } from '../sql/types';

export interface Lyrics<T = unknown> {
  songId: string;
  rawText: string;
  parsed: T;
  updatedAt: number;
}

interface LyricsRow {
  song_id: string;
  raw_text: string;
  parsed: string;
  updated_at: number;
}

export class LyricsRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  /** Store (or replace) a song's lyrics. The song must exist. */
  async put<T>(songId: string, rawText: string, parsed: T, updatedAt = this.clock.now()): Promise<Lyrics<T>> {
    await this.db.run(
      `INSERT INTO lyrics (song_id, raw_text, parsed, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (song_id) DO UPDATE SET raw_text = excluded.raw_text, parsed = excluded.parsed,
         updated_at = excluded.updated_at`,
      [songId, rawText, toJson(parsed), updatedAt],
    );
    return { songId, rawText, parsed, updatedAt };
  }

  async get<T = unknown>(songId: string): Promise<Lyrics<T> | null> {
    const row = await this.db.get<LyricsRow>('SELECT * FROM lyrics WHERE song_id = ?', [songId]);
    if (!row) return null;
    return { songId: row.song_id, rawText: row.raw_text, parsed: fromJson<T>(row.parsed, null as T), updatedAt: row.updated_at };
  }

  async remove(songId: string): Promise<void> {
    await this.db.run('DELETE FROM lyrics WHERE song_id = ?', [songId]);
  }
}
