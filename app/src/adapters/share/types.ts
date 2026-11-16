/**
 * Items shared into the app from other apps (the system share sheet). Spotify is share-in only
 * (its API caps new apps at 5 users): the learner shares a track from Spotify, the app reads
 * the link or the "Song - Artist" text with parseSpotifyShare and asks for the lyrics.
 *
 * Implementations:
 * - MemoryShareInbox: in memory; the fake for tests (receive() plays the share sheet) and the
 *   inbox on web, where nothing is shared in.
 * - ExpoShareInbox: iOS and Android. ShareIntentBridge (expo-share-intent, at the app root)
 *   feeds it; it writes each item to the share_inbox table before it shows up, and restores the
 *   unhandled ones at the next start.
 *
 * Both are ShareReceivers: a repeat of a pending item (the share sheet can hand the same item
 * over twice) returns the pending item and notifies nobody.
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

/** What arrives from the share sheet: a link, text, or both. */
export interface ShareInput {
  url?: string;
  text?: string;
}

export interface ShareInbox {
  /** Items not yet cleared, oldest first. */
  pending(): SharedItem[];
  /** Removes an item once the app has handled it. Unknown ids are ignored. */
  clear(id: string): void;
  /**
   * Called with each new item as it arrives (ExpoShareInbox also calls it once for each unhandled
   * item it restores from storage). Read pending() on mount and listen here for what follows.
   */
  onShare(listener: (item: SharedItem) => void): Unsubscribe;
}

/** An inbox the share bridge can feed (MemoryShareInbox, ExpoShareInbox). */
export interface ShareReceiver {
  /**
   * Adds a shared item and returns it. A blank input (no url, no text after trimming) gives null;
   * a repeat of a pending item gives that item without notifying listeners again.
   */
  receive(input: ShareInput): SharedItem | null | Promise<SharedItem | null>;
  /** Loads items kept from earlier runs (ExpoShareInbox). Safe to call more than once. */
  restore?(): Promise<void>;
}

export function isShareReceiver(inbox: object): inbox is ShareReceiver {
  return typeof (inbox as Partial<ShareReceiver>).receive === 'function';
}
