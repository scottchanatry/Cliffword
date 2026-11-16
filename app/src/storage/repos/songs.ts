/**
 * Songs the learner added: from Apple Music (MusicKit id), shared in from Spotify (track id
 * from the share link) or typed in by hand (no external id). A song from a service is stored
 * once per (source, external id); adding it again updates its title, artist and artwork (and
 * its genre when the new one has one). v4 adds the genre and when the song was last opened.
 */
import type { StorageClock } from '../clock';
import type { SqlDatabase } from '../sql/types';

export type SongSource = 'apple_music' | 'spotify_share' | 'manual';
export const SONG_SOURCES: readonly SongSource[] = ['apple_music', 'spotify_share', 'manual'];

export interface Song {
  id: string;
  source: SongSource;
  /** The service's id; null for manual songs. */
  externalId: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  addedAt: number;
  /** Apple Music's first genre name ("Reggaeton"); null when unknown. */
  genre: string | null;
  /** When the song page was last opened; null until then. */
  lastOpenedAt: number | null;
}

export interface SongInput {
  source: SongSource;
  externalId?: string | null;
  title: string;
  artist?: string;
  artworkUrl?: string | null;
  addedAt?: number;
  genre?: string | null;
}

interface SongRow {
  id: string;
  source: string;
  external_id: string | null;
  title: string;
  artist: string;
  artwork_url: string | null;
  added_at: number;
  genre: string | null;
  last_opened_at: number | null;
}

const toSong = (row: SongRow): Song => ({
  id: row.id,
  source: row.source as SongSource,
  externalId: row.external_id,
  title: row.title,
  artist: row.artist,
  artworkUrl: row.artwork_url,
  addedAt: row.added_at,
  genre: row.genre ?? null,
  lastOpenedAt: row.last_opened_at ?? null,
});

export class SongRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  /** Add a song, or update the stored one with the same source and external id. */
  async upsert(input: SongInput): Promise<Song> {
    if (!SONG_SOURCES.includes(input.source)) throw new Error(`Unknown song source: ${String(input.source)}`);
    const externalId = input.source === 'manual' ? null : input.externalId?.trim() || null;
    if (input.source !== 'manual' && !externalId) throw new Error(`A ${input.source} song needs an external id`);
    const id = this.clock.newId();
    const addedAt = input.addedAt ?? this.clock.now();
    return this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO songs (id, source, external_id, title, artist, artwork_url, added_at, genre) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, external_id) DO UPDATE SET title = excluded.title, artist = excluded.artist,
           artwork_url = excluded.artwork_url, genre = COALESCE(excluded.genre, songs.genre)`,
        [id, input.source, externalId, input.title, input.artist ?? '', input.artworkUrl ?? null, addedAt, input.genre?.trim() || null],
      );
      const row = externalId
        ? await tx.get<SongRow>('SELECT * FROM songs WHERE source = ? AND external_id = ?', [input.source, externalId])
        : await tx.get<SongRow>('SELECT * FROM songs WHERE id = ?', [id]);
      if (!row) throw new Error('Song was not stored');
      return toSong(row);
    });
  }

  async get(id: string): Promise<Song | null> {
    const row = await this.db.get<SongRow>('SELECT * FROM songs WHERE id = ?', [id]);
    return row ? toSong(row) : null;
  }

  async findByExternal(source: SongSource, externalId: string): Promise<Song | null> {
    const row = await this.db.get<SongRow>('SELECT * FROM songs WHERE source = ? AND external_id = ?', [source, externalId]);
    return row ? toSong(row) : null;
  }

  /** Newest first. */
  async list(limit = -1): Promise<Song[]> {
    const rows = await this.db.all<SongRow>('SELECT * FROM songs ORDER BY added_at DESC, id LIMIT ?', [limit]);
    return rows.map(toSong);
  }

  /** Most recently opened or added first (the library order). */
  async recent(limit = -1): Promise<Song[]> {
    const rows = await this.db.all<SongRow>(
      'SELECT * FROM songs ORDER BY MAX(added_at, IFNULL(last_opened_at, 0)) DESC, added_at DESC, id LIMIT ?',
      [limit],
    );
    return rows.map(toSong);
  }

  /** Change the title or artist (the learner corrects a shared or pasted song). Returns null for an unknown id. */
  async rename(id: string, patch: { title?: string; artist?: string }): Promise<Song | null> {
    const title = patch.title?.trim();
    const artist = patch.artist?.trim();
    if (title !== undefined && !title) throw new Error('A song needs a title');
    if (title !== undefined) await this.db.run('UPDATE songs SET title = ? WHERE id = ?', [title, id]);
    if (artist !== undefined) await this.db.run('UPDATE songs SET artist = ? WHERE id = ?', [artist, id]);
    return this.get(id);
  }

  /** The song page was opened at `at`. */
  async markOpened(id: string, at: number = this.clock.now()): Promise<void> {
    await this.db.run('UPDATE songs SET last_opened_at = ? WHERE id = ?', [at, id]);
  }

  /** Delete a song and its lyrics. */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM lyrics WHERE song_id = ?', [id]);
      await tx.run('DELETE FROM songs WHERE id = ?', [id]);
    });
  }
}
