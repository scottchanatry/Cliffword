/**
 * The learner model on disk: an append-only event log plus periodic snapshots.
 *
 * `loadLearner` restores the newest readable snapshot and replays the events logged after it
 * (by event id, in log order), so the restored model matches the one in memory. Each snapshot
 * records `through_event_id`, the last event it includes.
 *
 * Keeping memory and disk in step: `record(learner, events)` applies the events to the model
 * and queues their insert in the same synchronous step, and `saveSnapshot` takes the snapshot
 * and queues its insert in the same step too. The database runs calls in order (see
 * sql/serialized.ts), so a snapshot's `through_event_id` always matches the events it contains.
 * Events are applied and logged in `applyAll` order (stable by `at`).
 */
import {
  LearnerModel,
  type EventEvidenceTable,
  type LearnerEvent,
  type LearnerParamsInput,
  type LearnerSnapshot,
  type PriorFn,
} from '@cliffword/engine';
import { fromJson } from '../json';
import type { SqlDatabase, SqlExecutor } from '../sql/types';

export interface StoredLearnerEvent {
  id: number;
  event: LearnerEvent;
}

export interface SnapshotInfo {
  id: number;
  at: number;
  version: number;
  /** The snapshot includes every event with id <= this. */
  throughEventId: number;
}

export interface StoredSnapshot extends SnapshotInfo {
  snapshot: LearnerSnapshot;
}

export interface LoadLearnerOptions {
  /** The learner's prior (not stored in snapshots); pass the one the model was built with. */
  prior?: PriorFn;
  /** Used only when no snapshot can be restored and the model is built from events alone. */
  params?: LearnerParamsInput;
  evidence?: EventEvidenceTable;
}

export interface LoadedLearner {
  learner: LearnerModel;
  /** The snapshot restored, or null when the model was rebuilt from the full log. */
  snapshotId: number | null;
  /** Events replayed on top of the snapshot. */
  replayed: number;
  /** Newer snapshots that could not be restored (unknown version or damaged) and were skipped. */
  skippedSnapshots: number;
  /** Id of the last logged event, 0 when there are none. */
  lastEventId: number;
}

/** Snapshots kept by default; older ones are deleted when a new one is saved. */
export const DEFAULT_SNAPSHOTS_KEPT = 3;

interface EventRow {
  id: number;
  at: number;
  type: string;
  key: string;
  payload: string;
}

interface SnapshotRow {
  id: number;
  at: number;
  version: number;
  json: string;
  through_event_id: number;
}

/** The same events LearnerModel.apply accepts; anything else is not logged. */
function isLoggable(event: LearnerEvent): boolean {
  return typeof event.type === 'string' && typeof event.key === 'string' && event.key !== '' && Number.isFinite(event.at);
}

/** Stable sort by time: the order LearnerModel.applyAll applies a batch in. */
function inApplyOrder(events: readonly LearnerEvent[]): LearnerEvent[] {
  return events
    .map((event, i) => ({ event, i }))
    .sort((a, b) => a.event.at - b.event.at || a.i - b.i)
    .map(({ event }) => event);
}

function toEvent(row: EventRow): LearnerEvent {
  const extra = fromJson<Record<string, unknown>>(row.payload, {});
  return { ...extra, type: row.type, key: row.key, at: row.at } as LearnerEvent;
}

const toStored = (row: EventRow): StoredLearnerEvent => ({ id: row.id, event: toEvent(row) });

const EVENT_COLUMNS = 'id, at, type, key, payload';

export class LearnerRepo {
  constructor(private readonly db: SqlDatabase) {}

  /**
   * Log events (in `applyAll` order; events LearnerModel would ignore are skipped). Returns
   * the new event ids.
   */
  appendEvents(events: readonly LearnerEvent[]): Promise<number[]> {
    const ordered = inApplyOrder(events.filter(isLoggable));
    if (ordered.length === 0) return Promise.resolve([]);
    return this.db.transaction(async (tx) => {
      const ids: number[] = [];
      for (const { type, key, at, ...extra } of ordered) {
        const result = await tx.run('INSERT INTO learner_events (at, type, key, payload) VALUES (?, ?, ?, ?)', [
          at,
          type,
          key,
          JSON.stringify(extra),
        ]);
        ids.push(result.lastInsertRowId);
      }
      return ids;
    });
  }

  /** Apply events to the model and log them, keeping memory and disk in step. */
  record(learner: LearnerModel, events: readonly LearnerEvent[]): Promise<number[]> {
    const ordered = inApplyOrder(events);
    for (const event of ordered) learner.apply(event);
    return this.appendEvents(ordered);
  }

  /** Logged events with id > `afterId`, oldest first. */
  async eventsSince(afterId = 0, limit = -1): Promise<StoredLearnerEvent[]> {
    const rows = await this.db.all<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM learner_events WHERE id > ? ORDER BY id LIMIT ?`,
      [afterId, limit],
    );
    return rows.map(toStored);
  }

  /** Logged events for one learner key, oldest first. */
  async eventsForKey(key: string, limit = -1): Promise<StoredLearnerEvent[]> {
    const rows = await this.db.all<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM learner_events WHERE key = ? ORDER BY id LIMIT ?`,
      [key, limit],
    );
    return rows.map(toStored);
  }

  async countEvents(): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM learner_events');
    return row?.n ?? 0;
  }

  /**
   * Save the model's snapshot now; it covers every event logged before this call. Keeps the
   * newest `keep` snapshots (0 keeps all).
   */
  saveSnapshot(learner: LearnerModel, at: number, opts: { keep?: number } = {}): Promise<SnapshotInfo> {
    const snapshot = learner.snapshot();
    const keep = opts.keep ?? DEFAULT_SNAPSHOTS_KEPT;
    return this.db.transaction(async (tx) => {
      const through = await lastEventId(tx);
      const result = await tx.run(
        'INSERT INTO learner_snapshots (at, version, json, through_event_id) VALUES (?, ?, ?, ?)',
        [at, snapshot.version, JSON.stringify(snapshot), through],
      );
      if (keep > 0) {
        await tx.run(
          'DELETE FROM learner_snapshots WHERE id NOT IN (SELECT id FROM learner_snapshots ORDER BY id DESC LIMIT ?)',
          [keep],
        );
      }
      return { id: result.lastInsertRowId, at, version: snapshot.version, throughEventId: through };
    });
  }

  /** The newest snapshot whose JSON parses, or null. */
  async latestSnapshot(): Promise<StoredSnapshot | null> {
    const rows = await this.db.all<SnapshotRow>('SELECT * FROM learner_snapshots ORDER BY id DESC');
    for (const row of rows) {
      const snapshot = fromJson<LearnerSnapshot | null>(row.json, null);
      if (snapshot) return { ...snapshotInfo(row), snapshot };
    }
    return null;
  }

  /**
   * Rebuild the learner: the newest snapshot LearnerModel.restore accepts, plus the events
   * logged after it. With no usable snapshot, a new model replays the whole log.
   */
  loadLearner(opts: LoadLearnerOptions = {}): Promise<LoadedLearner> {
    return this.db.transaction(async (tx) => {
      const snapshots = await tx.all<SnapshotRow>('SELECT * FROM learner_snapshots ORDER BY id DESC');
      let learner: LearnerModel | undefined;
      let base: SnapshotRow | undefined;
      let skippedSnapshots = 0;
      for (const row of snapshots) {
        try {
          learner = LearnerModel.restore(JSON.parse(row.json) as LearnerSnapshot, { prior: opts.prior });
          base = row;
          break;
        } catch {
          skippedSnapshots++;
        }
      }
      learner ??= new LearnerModel({ prior: opts.prior, params: opts.params, evidence: opts.evidence });
      const rows = await tx.all<EventRow>(`SELECT ${EVENT_COLUMNS} FROM learner_events WHERE id > ? ORDER BY id`, [
        base?.through_event_id ?? 0,
      ]);
      let replayed = 0;
      for (const row of rows) if (learner.apply(toEvent(row))) replayed++;
      return {
        learner,
        snapshotId: base?.id ?? null,
        replayed,
        skippedSnapshots,
        lastEventId: await lastEventId(tx),
      };
    });
  }
}

async function lastEventId(tx: SqlExecutor): Promise<number> {
  const row = await tx.get<{ id: number | null }>('SELECT MAX(id) AS id FROM learner_events');
  return row?.id ?? 0;
}

function snapshotInfo(row: SnapshotRow): SnapshotInfo {
  return { id: row.id, at: row.at, version: row.version, throughEventId: row.through_event_id };
}
