/**
 * Things shared into the app (a Spotify track link, song lyrics, an article) waiting to be
 * handled. The share sheet can hand the same item over more than once (for example after a
 * restart), so an identical unhandled item is stored only once.
 */
import type { StorageClock } from '../clock';
import { fromFlag } from '../json';
import type { SqlDatabase } from '../sql/types';

export interface SharedItem {
  id: number;
  receivedAt: number;
  url: string | null;
  text: string | null;
  handled: boolean;
}

interface ShareRow {
  id: number;
  received_at: number;
  url: string | null;
  text: string | null;
  handled: number;
}

const toItem = (row: ShareRow): SharedItem => ({
  id: row.id,
  receivedAt: row.received_at,
  url: row.url,
  text: row.text,
  handled: fromFlag(row.handled),
});

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export class ShareInboxRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  /** Store a shared item (a URL, text or both). Returns the existing one for a repeat. */
  add(input: { url?: string | null; text?: string | null; receivedAt?: number }): Promise<SharedItem> {
    const url = clean(input.url);
    const text = clean(input.text);
    if (url === null && text === null) return Promise.reject(new Error('A shared item needs a URL or text'));
    const receivedAt = input.receivedAt ?? this.clock.now();
    return this.db.transaction(async (tx) => {
      const existing = await tx.get<ShareRow>(
        'SELECT * FROM share_inbox WHERE handled = 0 AND url IS ? AND text IS ? ORDER BY id LIMIT 1',
        [url, text],
      );
      if (existing) return toItem(existing);
      const result = await tx.run('INSERT INTO share_inbox (received_at, url, text, handled) VALUES (?, ?, ?, 0)', [
        receivedAt,
        url,
        text,
      ]);
      return { id: result.lastInsertRowId, receivedAt, url, text, handled: false };
    });
  }

  async get(id: number): Promise<SharedItem | null> {
    const row = await this.db.get<ShareRow>('SELECT * FROM share_inbox WHERE id = ?', [id]);
    return row ? toItem(row) : null;
  }

  /** Unhandled items, oldest first. */
  async pending(limit = -1): Promise<SharedItem[]> {
    const rows = await this.db.all<ShareRow>('SELECT * FROM share_inbox WHERE handled = 0 ORDER BY received_at, id LIMIT ?', [
      limit,
    ]);
    return rows.map(toItem);
  }

  async markHandled(id: number): Promise<void> {
    await this.db.run('UPDATE share_inbox SET handled = 1 WHERE id = ?', [id]);
  }

  /** Delete handled items received before `before`. Returns how many. */
  async purgeHandled(before: number): Promise<number> {
    const result = await this.db.run('DELETE FROM share_inbox WHERE handled = 1 AND received_at < ?', [before]);
    return result.changes;
  }
}
