/**
 * Stories and their sentences. A sentence keeps its text and the engine's JSON for it (target
 * words, cliff, word scores), numbered from 0 in story order.
 */
import type { StorageClock } from '../clock';
import { fromJson, toJson } from '../json';
import type { SqlDatabase } from '../sql/types';

export interface Story {
  id: string;
  title: string;
  createdAt: number;
}

export interface StorySentence<T = unknown> {
  storyId: string;
  /** 0-based position in the story. */
  idx: number;
  text: string;
  data: T;
}

interface StoryRow {
  id: string;
  title: string;
  created_at: number;
}

interface SentenceRow {
  story_id: string;
  idx: number;
  text: string;
  json: string;
}

const toStory = (row: StoryRow): Story => ({ id: row.id, title: row.title, createdAt: row.created_at });

function toSentence<T>(row: SentenceRow): StorySentence<T> {
  return { storyId: row.story_id, idx: row.idx, text: row.text, data: fromJson<T>(row.json, null as T) };
}

export class StoryRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  async create(input: { id?: string; title: string; createdAt?: number }): Promise<Story> {
    const story: Story = {
      id: input.id ?? this.clock.newId(),
      title: input.title,
      createdAt: input.createdAt ?? this.clock.now(),
    };
    await this.db.run('INSERT INTO stories (id, title, created_at) VALUES (?, ?, ?)', [story.id, story.title, story.createdAt]);
    return story;
  }

  async get(id: string): Promise<Story | null> {
    const row = await this.db.get<StoryRow>('SELECT * FROM stories WHERE id = ?', [id]);
    return row ? toStory(row) : null;
  }

  /** Newest first. */
  async list(limit = -1): Promise<Story[]> {
    const rows = await this.db.all<StoryRow>('SELECT * FROM stories ORDER BY created_at DESC, id LIMIT ?', [limit]);
    return rows.map(toStory);
  }

  async rename(id: string, title: string): Promise<void> {
    await this.db.run('UPDATE stories SET title = ? WHERE id = ?', [title, id]);
  }

  /** Delete a story and its sentences. */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM story_sentences WHERE story_id = ?', [id]);
      await tx.run('DELETE FROM stories WHERE id = ?', [id]);
    });
  }

  /** Add a sentence after the last one. Throws if the story does not exist. */
  appendSentence<T>(storyId: string, text: string, data: T): Promise<StorySentence<T>> {
    return this.db.transaction(async (tx) => {
      if (!(await tx.get('SELECT 1 AS ok FROM stories WHERE id = ?', [storyId]))) {
        throw new Error(`No story with id ${storyId}`);
      }
      const row = await tx.get<{ next: number }>(
        'SELECT COALESCE(MAX(idx) + 1, 0) AS next FROM story_sentences WHERE story_id = ?',
        [storyId],
      );
      const idx = row?.next ?? 0;
      await tx.run('INSERT INTO story_sentences (story_id, idx, text, json) VALUES (?, ?, ?, ?)', [
        storyId,
        idx,
        text,
        toJson(data),
      ]);
      return { storyId, idx, text, data };
    });
  }

  /** Replace the sentence at `idx` (or add it there). */
  async putSentence<T>(storyId: string, idx: number, text: string, data: T): Promise<StorySentence<T>> {
    if (!Number.isInteger(idx) || idx < 0) throw new Error(`Bad sentence index: ${idx}`);
    await this.db.run(
      `INSERT INTO story_sentences (story_id, idx, text, json) VALUES (?, ?, ?, ?)
       ON CONFLICT (story_id, idx) DO UPDATE SET text = excluded.text, json = excluded.json`,
      [storyId, idx, text, toJson(data)],
    );
    return { storyId, idx, text, data };
  }

  /** Sentences in story order. */
  async sentences<T = unknown>(storyId: string): Promise<StorySentence<T>[]> {
    const rows = await this.db.all<SentenceRow>('SELECT * FROM story_sentences WHERE story_id = ? ORDER BY idx', [storyId]);
    return rows.map((row) => toSentence<T>(row));
  }

  /** Drop the sentences from `fromIdx` on (to regenerate the end of a story). Returns how many. */
  async truncate(storyId: string, fromIdx: number): Promise<number> {
    const result = await this.db.run('DELETE FROM story_sentences WHERE story_id = ? AND idx >= ?', [storyId, fromIdx]);
    return result.changes;
  }
}
