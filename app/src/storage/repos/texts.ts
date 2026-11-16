/**
 * Texts the learner brought (an article, a transcript, lyrics pasted as prose) for cliffs and
 * surprise shading (schema v4). Like lyrics they stay on this device: nothing here is synced,
 * uploaded or exported.
 */
import type { StorageClock } from '../clock';
import type { SqlDatabase } from '../sql/types';

export interface BroughtText {
  id: string;
  title: string;
  rawText: string;
  createdAt: number;
  lastOpenedAt: number | null;
}

export interface BroughtTextInput {
  title: string;
  rawText: string;
  createdAt?: number;
}

interface TextRow {
  id: string;
  title: string;
  raw_text: string;
  created_at: number;
  last_opened_at: number | null;
}

const toText = (row: TextRow): BroughtText => ({
  id: row.id,
  title: row.title,
  rawText: row.raw_text,
  createdAt: row.created_at,
  lastOpenedAt: row.last_opened_at ?? null,
});

export class TextRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  /** Store a new text. The text must have some non-blank content; a blank title is allowed (the view names it). */
  async add(input: BroughtTextInput): Promise<BroughtText> {
    if (!input.rawText.trim()) throw new Error('A brought text needs some text');
    const text: BroughtText = {
      id: this.clock.newId(),
      title: input.title.trim(),
      rawText: input.rawText,
      createdAt: input.createdAt ?? this.clock.now(),
      lastOpenedAt: null,
    };
    await this.db.run('INSERT INTO texts (id, title, raw_text, created_at, last_opened_at) VALUES (?, ?, ?, ?, NULL)', [
      text.id,
      text.title,
      text.rawText,
      text.createdAt,
    ]);
    return text;
  }

  async get(id: string): Promise<BroughtText | null> {
    const row = await this.db.get<TextRow>('SELECT * FROM texts WHERE id = ?', [id]);
    return row ? toText(row) : null;
  }

  /** Most recently opened or added first. */
  async list(limit = -1): Promise<BroughtText[]> {
    const rows = await this.db.all<TextRow>(
      'SELECT * FROM texts ORDER BY MAX(created_at, IFNULL(last_opened_at, 0)) DESC, created_at DESC, id LIMIT ?',
      [limit],
    );
    return rows.map(toText);
  }

  async markOpened(id: string, at: number = this.clock.now()): Promise<void> {
    await this.db.run('UPDATE texts SET last_opened_at = ? WHERE id = ?', [at, id]);
  }

  async remove(id: string): Promise<void> {
    await this.db.run('DELETE FROM texts WHERE id = ?', [id]);
  }
}
