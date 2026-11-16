/**
 * What a lyric controller opens: a stored song with pasted lyrics, or a brought text, as the
 * engine's LyricSource, plus the session row it is kept under and the Apple Music track it can
 * play.
 *
 * Sessions: one stored LyricSession per song ('lyric:<songId>') and per text ('text:<textId>'),
 * kind 'lyric', never marked active (active means "the one to resume for its kind", and every
 * song resumes its own). A stored session whose lyrics differ from the song's current lyrics
 * (pasted again) is replaced by a new one.
 */
import type { LanguagePack, LyricSessionSnapshot, LyricSource } from '@cliffword/engine';
import { readLyrics } from '../../music/lyricsData';
import type { Storage } from '../../storage/storage';

export type LyricTarget = { kind: 'song'; songId: string } | { kind: 'text'; textId: string };

/** What the route shows around the controller: loading, a song or text that does not exist, a song without lyrics, or ready. */
export type LyricSourceState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'needsLyrics'; songId: string; title: string; artist: string }
  | {
      status: 'ready';
      kind: 'song' | 'text';
      id: string;
      title: string;
      artist: string;
      genre: string | null;
      /** The song is an Apple Music library song (it can play here once access is granted). */
      linked: boolean;
    };

export interface LoadedSource {
  target: LyricTarget;
  sessionId: string;
  source: LyricSource;
  title: string;
  artist: string;
  genre: string | null;
  /** The MusicKit id to play, or null (shared, manual or brought text). */
  trackId: string | null;
}

export function sessionIdFor(target: LyricTarget): string {
  return target.kind === 'song' ? `lyric:${target.songId}` : `text:${target.textId}`;
}

export type SourceLoad = { state: Exclude<LyricSourceState, { status: 'ready' | 'loading' }> } | { state: Extract<LyricSourceState, { status: 'ready' }>; loaded: LoadedSource };

export async function loadLyricSource(storage: Storage, pack: LanguagePack, target: LyricTarget): Promise<SourceLoad> {
  const sessionId = sessionIdFor(target);
  if (target.kind === 'text') {
    const text = await storage.texts.get(target.textId);
    if (!text || !text.rawText.trim()) return { state: { status: 'missing' } };
    const loaded: LoadedSource = { target, sessionId, source: { kind: 'text', text: text.rawText }, title: text.title, artist: '', genre: null, trackId: null };
    return { state: { status: 'ready', kind: 'text', id: text.id, title: text.title, artist: '', genre: null, linked: false }, loaded };
  }
  const song = await storage.songs.get(target.songId);
  if (!song) return { state: { status: 'missing' } };
  const stored = await readLyrics(storage, song.id, pack);
  if (!stored || stored.lyrics.lines.length === 0) {
    return { state: { status: 'needsLyrics', songId: song.id, title: song.title, artist: song.artist } };
  }
  const linked = song.source === 'apple_music' && song.externalId !== null;
  const loaded: LoadedSource = {
    target,
    sessionId,
    source: { kind: 'lyrics', lyrics: stored.lyrics },
    title: song.title,
    artist: song.artist,
    genre: song.genre,
    trackId: linked ? song.externalId : null,
  };
  return { state: { status: 'ready', kind: 'song', id: song.id, title: song.title, artist: song.artist, genre: song.genre, linked }, loaded };
}

/** The stored session was made from these same lyrics (or this same text). */
export function sameSource(snapshot: LyricSessionSnapshot | null | undefined, source: LyricSource): boolean {
  const stored = snapshot?.state?.source;
  return stored !== undefined && JSON.stringify(stored) === JSON.stringify(source);
}
