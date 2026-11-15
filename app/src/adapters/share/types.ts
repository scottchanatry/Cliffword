/**
 * Items shared into the app from other apps (the system share sheet). Spotify is share-in only
 * (its API caps new apps at 5 users): the learner shares a track from Spotify, the app reads
 * the link or the "Song - Artist" text with parseSpotifyShare and asks for the lyrics.
 *
 * Implementations:
 * - MemoryShareInbox: in memory; the fake for tests (receive() plays the share sheet) and the
 *   inbox on web, where nothing is shared in.
 * - A native inbox over expo-share-intent (later stage).
 */
import type { Unsubscribe } from '../listeners';

export interface SharedItem {
  /** Unique within the inbox. */
  id: string;
  url?: string;
  text?: string;
  /** Clock time (ms since epoch) when the item arrived. */
  receivedAt: number;
}

export interface ShareInbox {
  /** Items not yet cleared, oldest first. */
  pending(): SharedItem[];
  /** Removes an item once the app has handled it. Unknown ids are ignored. */
  clear(id: string): void;
  /** Called with each new item as it arrives. */
  onShare(listener: (item: SharedItem) => void): Unsubscribe;
}
