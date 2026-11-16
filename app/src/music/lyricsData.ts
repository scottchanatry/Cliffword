/**
 * Pasted lyrics: parse (engine parseLyrics: plain text or LRC, labels, repeats and site junk
 * removed), preview, store, read back.
 *
 * The raw text is the source of truth. The parsed lyrics are stored next to it as a cache, but
 * every read parses the raw text again (fast and deterministic), so an improved parser applies
 * to songs pasted earlier and no parser version has to be tracked. A lyric session keeps its
 * own copy of the lyrics in its snapshot, so a running session is never changed under the
 * learner; songSession.ts starts a new session when the lyrics changed.
 */
import { parseLyrics, songSlangNotes, type LanguagePack, type Lyrics, type PairPack } from '@cliffword/engine';
import type { LyricsPreview } from '../features/music/types';
import type { Storage } from '../storage/storage';

/** Lyric lines shown in the paste preview. */
export const PREVIEW_LINES = 4;

export function parsePastedLyrics(raw: string, pack: LanguagePack): Lyrics {
  return parseLyrics(raw, pack);
}

/** True when the pasted text has at least one lyric line. */
export function hasLyricLines(lyrics: Lyrics): boolean {
  return lyrics.lines.some((l) => l.text.trim().length > 0);
}

/** What the paste screen shows before saving: counts, slang notes, the first lines. */
export function lyricsPreview(
  lyrics: Lyrics,
  pack: LanguagePack,
  pair: PairPack,
  opts: { regions: readonly string[]; showExplicit: boolean },
): LyricsPreview {
  const all = songSlangNotes(lyrics, pack, pair, { regions: opts.regions, showExplicit: true });
  return {
    lines: lyrics.lines.length,
    timedLines: lyrics.lines.filter((l) => l.startMs !== undefined).length,
    removed: lyrics.removed.filter((r) => r.reason !== 'tag').length,
    notes: all.filter((n) => opts.showExplicit || !n.note.explicit).map((n) => n.note),
    explicit: all.filter((n) => n.note.explicit).reduce((sum, n) => sum + n.count, 0),
    firstLines: lyrics.lines.slice(0, PREVIEW_LINES).map((l) => l.text),
  };
}

/** Store (or replace) a song's lyrics: the raw text and its parse. */
export async function saveLyrics(storage: Storage, songId: string, raw: string, pack: LanguagePack, at?: number): Promise<Lyrics> {
  const lyrics = parsePastedLyrics(raw, pack);
  await storage.lyrics.put(songId, raw, lyrics, at);
  return lyrics;
}

export interface StoredLyrics {
  raw: string;
  lyrics: Lyrics;
  updatedAt: number;
}

/** A song's lyrics, parsed from the stored raw text; null when none were pasted. */
export async function readLyrics(storage: Storage, songId: string, pack: LanguagePack): Promise<StoredLyrics | null> {
  const row = await storage.lyrics.get(songId);
  if (!row || !row.rawText.trim()) return null;
  return { raw: row.rawText, lyrics: parsePastedLyrics(row.rawText, pack), updatedAt: row.updatedAt };
}
