/**
 * The share inbox on iOS and Android. ShareIntentBridge hands it what other apps share
 * (expo-share-intent); it writes each item to the share_inbox table (ShareInboxRepo) before the
 * item shows up in pending(), so a share is not lost when it arrives while the app starts or is
 * not handled before the app closes. Read items with parseSpotifyShare (a track link or
 * "Song - Artist"); clear(id) marks one handled.
 *
 * - Ids are the table's row ids as strings.
 * - Repeats: the share sheet can deliver the same item more than once (the hook re-reads it when
 *   the app becomes active; a user shares the same song twice). ShareInboxRepo stores an
 *   identical unhandled item once, and the inbox then returns the pending item and notifies
 *   nobody.
 * - restore() loads the unhandled rows from earlier runs once (ShareIntentBridge calls it at
 *   start) and notifies listeners of each. A failed restore can be retried.
 * - If storage cannot be opened, an item still shows up for this run (id `mem-<n>`), and the
 *   failure is logged.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import type { ShareInbox, ShareInput, ShareReceiver, SharedItem } from './types';

/** A share_inbox row, as ShareInboxRepo returns it. */
export interface StoredShare {
  id: number;
  receivedAt: number;
  url: string | null;
  text: string | null;
}

/** What the inbox needs from ShareInboxRepo (storage.shareInbox). */
export interface ShareInboxStore {
  add(input: { url?: string | null; text?: string | null; receivedAt?: number }): Promise<StoredShare>;
  pending(): Promise<StoredShare[]>;
  markHandled(id: number): Promise<void>;
}

export type ShareInboxLog = (message: string, error: unknown) => void;

const defaultLog: ShareInboxLog = (message, error) => {
  if (__DEV__) console.warn(`[share] ${message}`, error);
};

const toItem = (row: StoredShare): SharedItem => ({
  id: String(row.id),
  receivedAt: row.receivedAt,
  ...(row.url ? { url: row.url } : {}),
  ...(row.text ? { text: row.text } : {}),
});

const rowIdOf = (id: string): number | null => (/^\d+$/.test(id) ? Number(id) : null);

export class ExpoShareInbox implements ShareInbox, ShareReceiver {
  private items: SharedItem[] = [];
  private readonly listeners = new Listeners<SharedItem>();
  /** Ids cleared in this run: a restore that read the table before the update must not bring them back. */
  private readonly cleared = new Set<string>();
  private restoring: Promise<void> | null = null;
  private restored = false;
  private memorySeq = 0;

  /** `openStore` is called for every write (storage.open() returns the opened database). */
  constructor(
    private readonly openStore: () => Promise<ShareInboxStore>,
    private readonly clock: Clock = systemClock,
    private readonly log: ShareInboxLog = defaultLog,
  ) {}

  pending(): SharedItem[] {
    return [...this.items];
  }

  clear(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.cleared.add(id);
    const rowId = rowIdOf(id);
    if (rowId === null) return;
    this.openStore()
      .then((store) => store.markHandled(rowId))
      .catch((error: unknown) => this.log(`could not mark share ${id} handled`, error));
  }

  onShare(listener: (item: SharedItem) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  restore(): Promise<void> {
    if (this.restored) return Promise.resolve();
    this.restoring ??= (async () => {
      try {
        const rows = await (await this.openStore()).pending();
        this.restored = true;
        for (const row of rows) this.adopt(toItem(row));
      } finally {
        this.restoring = null;
      }
    })();
    return this.restoring;
  }

  async receive(input: ShareInput): Promise<SharedItem | null> {
    const url = input.url?.trim() || undefined;
    const text = input.text?.trim() || undefined;
    if (!url && !text) return null;
    const receivedAt = this.clock.now();
    try {
      const row = await (await this.openStore()).add({ url: url ?? null, text: text ?? null, receivedAt });
      return this.adopt(toItem(row));
    } catch (error) {
      this.log('could not store a shared item; it is kept for this run only', error);
      const repeat = this.items.find((item) => item.url === url && item.text === text);
      if (repeat) return repeat;
      this.memorySeq += 1;
      return this.adopt({ id: `mem-${this.memorySeq}`, receivedAt, ...(url ? { url } : {}), ...(text ? { text } : {}) });
    }
  }

  /** Adds an item unless it is pending already (or was cleared in this run); notifies for a new one. */
  private adopt(item: SharedItem): SharedItem {
    const existing = this.items.find((pending) => pending.id === item.id);
    if (existing) return existing;
    if (this.cleared.has(item.id)) return item;
    this.items = [...this.items, item].sort((a, b) => a.receivedAt - b.receivedAt);
    this.listeners.emit(item);
    return item;
  }
}
