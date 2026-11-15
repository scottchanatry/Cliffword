/**
 * Saved sessions (a story, a lyric session, a retell) so the learner can pick up where they
 * left off. The snapshot is the session module's own JSON, stored as is with its format
 * version. At most one session per kind is active (the one to resume).
 */
import type { StorageClock } from '../clock';
import { fromFlag, fromJson, toFlag, toJson } from '../json';
import type { SqlDatabase } from '../sql/types';

export type SessionKind = 'story' | 'lyric' | 'retell';
export const SESSION_KINDS: readonly SessionKind[] = ['story', 'lyric', 'retell'];

export interface SessionRecord<T = unknown> {
  id: string;
  kind: SessionKind;
  updatedAt: number;
  /** Format version of `snapshot`, owned by the session module. */
  version: number;
  snapshot: T;
  active: boolean;
}

export interface SaveSessionInput<T> {
  /** Omit to create a new session. */
  id?: string;
  kind: SessionKind;
  version: number;
  snapshot: T;
  /** Default true: saving a session makes it the one to resume for its kind. */
  active?: boolean;
  updatedAt?: number;
}

interface SessionRow {
  id: string;
  kind: string;
  updated_at: number;
  version: number;
  snapshot: string;
  active: number;
}

function toRecord<T>(row: SessionRow): SessionRecord<T> {
  return {
    id: row.id,
    kind: row.kind as SessionKind,
    updatedAt: row.updated_at,
    version: row.version,
    snapshot: fromJson<T>(row.snapshot, null as T),
    active: fromFlag(row.active),
  };
}

export class SessionRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  /** Insert or replace a session. An active save deactivates the other sessions of its kind. */
  async save<T>(input: SaveSessionInput<T>): Promise<SessionRecord<T>> {
    if (!SESSION_KINDS.includes(input.kind)) throw new Error(`Unknown session kind: ${String(input.kind)}`);
    if (!Number.isInteger(input.version)) throw new Error('Session version must be an integer');
    const record: SessionRecord<T> = {
      id: input.id ?? this.clock.newId(),
      kind: input.kind,
      updatedAt: input.updatedAt ?? this.clock.now(),
      version: input.version,
      snapshot: input.snapshot,
      active: input.active ?? true,
    };
    await this.db.transaction(async (tx) => {
      if (record.active) {
        await tx.run('UPDATE sessions SET active = 0 WHERE kind = ? AND id <> ? AND active = 1', [record.kind, record.id]);
      }
      await tx.run(
        `INSERT INTO sessions (id, kind, updated_at, version, snapshot, active) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at,
           version = excluded.version, snapshot = excluded.snapshot, active = excluded.active`,
        [record.id, record.kind, record.updatedAt, record.version, toJson(record.snapshot), toFlag(record.active)],
      );
    });
    return record;
  }

  async get<T = unknown>(id: string): Promise<SessionRecord<T> | null> {
    const row = await this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
    return row ? toRecord<T>(row) : null;
  }

  /** The session to resume for `kind`, or null. */
  async active<T = unknown>(kind: SessionKind): Promise<SessionRecord<T> | null> {
    const row = await this.db.get<SessionRow>('SELECT * FROM sessions WHERE kind = ? AND active = 1', [kind]);
    return row ? toRecord<T>(row) : null;
  }

  /** Most recently updated first; all kinds unless `kind` is given. */
  async list(opts: { kind?: SessionKind; limit?: number } = {}): Promise<SessionRecord[]> {
    const limit = opts.limit ?? -1;
    const rows = opts.kind
      ? await this.db.all<SessionRow>('SELECT * FROM sessions WHERE kind = ? ORDER BY updated_at DESC, id LIMIT ?', [
          opts.kind,
          limit,
        ])
      : await this.db.all<SessionRow>('SELECT * FROM sessions ORDER BY updated_at DESC, id LIMIT ?', [limit]);
    return rows.map((row) => toRecord(row));
  }

  /** Keep the session but stop offering it for resume (finished or abandoned). */
  async deactivate(id: string): Promise<void> {
    await this.db.run('UPDATE sessions SET active = 0 WHERE id = ?', [id]);
  }

  async remove(id: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE id = ?', [id]);
  }
}
