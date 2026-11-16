/**
 * Shared songs (Spotify is share-in only): an unprocessed item of services.share becomes a
 * draft the learner confirms (title and artist are editable: parsing a share is a heuristic),
 * then a song record that waits for its lyrics. No network calls: a short link that cannot be
 * read offline gives an empty draft to fill in.
 */
import type { SharedItem } from '../adapters/share/types';
import { parseSpotifyShare } from '../adapters/share/parseSpotifyShare';
import type { PendingShareRow } from '../features/music/types';
import type { Song } from '../storage/repos/songs';
import type { Storage } from '../storage/storage';

export interface ShareDraft {
  id: string;
  url: string | null;
  text: string | null;
  title: string;
  artist: string;
  /** The Spotify track id, when the share carried a track link. */
  trackId: string | null;
  /** A Spotify link to something other than a track (album, playlist, artist). */
  notASong: boolean;
}

export function shareDraft(item: SharedItem): ShareDraft {
  const parsed = parseSpotifyShare({ ...(item.url ? { url: item.url } : {}), ...(item.text ? { text: item.text } : {}) });
  return {
    id: item.id,
    url: item.url ?? null,
    text: item.text ?? null,
    title: parsed?.title ?? '',
    artist: parsed?.artist ?? '',
    trackId: parsed?.trackId ?? null,
    notASong: parsed === null && isSpotifyLink(item),
  };
}

function isSpotifyLink(item: SharedItem): boolean {
  const all = `${item.url ?? ''} ${item.text ?? ''}`;
  return /(?:https?:\/\/(?:open|play)\.spotify\.com\/|spotify:[a-z]+:)/i.test(all);
}

export function pendingShareRows(items: readonly SharedItem[]): PendingShareRow[] {
  return items.map((item) => {
    const d = shareDraft(item);
    return { id: d.id, title: d.title || null, artist: d.artist || null };
  });
}

/**
 * Save a confirmed share as a song: one row per Spotify track (sharing it again updates the
 * title and artist), or a manual song when there is no track id. The caller clears the share
 * from the inbox once this resolves.
 */
export async function saveSharedSong(storage: Storage, draft: ShareDraft, edit: { title: string; artist: string }): Promise<Song> {
  const title = edit.title.trim();
  if (!title) throw new Error('A shared song needs a title');
  const artist = edit.artist.trim();
  return draft.trackId
    ? storage.songs.upsert({ source: 'spotify_share', externalId: draft.trackId, title, artist })
    : storage.songs.upsert({ source: 'manual', title, artist });
}
