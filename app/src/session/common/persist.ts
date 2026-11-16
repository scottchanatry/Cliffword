/**
 * Writing one session step, shared by the session controllers: the step's learner events, the
 * session snapshot and the credited speaking time, in one storage transaction, so a failed step
 * writes nothing.
 *
 * - Events: sessions run with applyEvents false, and storage.learner.record(learner, events)
 *   applies and logs them in one synchronous step, so each event is applied exactly once and
 *   memory and the log stay in step. If the write fails before record() ran, the events are
 *   still applied in memory (the learner stays right for this run).
 * - Spoken time: the engine's creditedMs of the voiced time (typed answers earn none), to the
 *   local day of `at` (spoken_time).
 *
 * Same as the story controller's persist(); shared so both controllers write the same way.
 */
import { localDay, type LearnerEvent, type LearnerModel } from '@cliffword/engine';
import type { Clock } from '../../adapters/clock/types';
import { createId, type StorageClock } from '../../storage/clock';
import type { SaveSessionInput } from '../../storage/repos/sessions';
import type { SqlDatabase, SqlTransaction } from '../../storage/sql/types';
import { createStorage, type Storage } from '../../storage/storage';

/** A transaction as a database for repositories: their own transactions join it. */
export function transactionDatabase(tx: SqlTransaction): SqlDatabase {
  return {
    exec: (sql) => tx.exec(sql),
    run: (sql, params) => tx.run(sql, params),
    all: (sql, params) => tx.all(sql, params),
    get: (sql, params) => tx.get(sql, params),
    transaction: (task) => tx.transaction(task),
    close: () => Promise.reject(new Error('A transaction cannot be closed')),
  };
}

/** The storage clock of a controller: its ids and times come from the service clock. */
export function storageClockOf(clock: Clock): StorageClock {
  return { now: () => clock.now(), newId: () => createId(clock.now()) };
}

export interface StepWrite<T> {
  learner: LearnerModel;
  events: readonly LearnerEvent[];
  /** The session row to save (id, kind, version, snapshot, active, updatedAt). */
  session: SaveSessionInput<T>;
  /** Credited speaking time of the step, ms (0 for none). */
  creditedMs: number;
  at: number;
  /** More writes in the same transaction (a learner snapshot with a prior, ...). */
  extra?: (tx: Storage) => Promise<void>;
}

/** Events, session snapshot and spoken time of one step, in one transaction. */
export async function persistStep<T>(storage: Storage, clock: StorageClock, w: StepWrite<T>): Promise<void> {
  let applied = false;
  try {
    await storage.db.transaction(async (tx) => {
      const s = createStorage(transactionDatabase(tx), clock);
      if (w.events.length > 0) {
        // record() applies the events to the learner in this same synchronous step.
        const logged = s.learner.record(w.learner, w.events);
        applied = true;
        await logged;
      }
      await w.extra?.(s);
      await s.sessions.save(w.session);
      if (w.creditedMs > 0) await s.spokenTime.addUtterance(w.creditedMs, w.at);
    });
  } catch (e) {
    // Keep the learner in memory right even when the log could not be written.
    if (!applied && w.events.length > 0) w.learner.applyAll(w.events);
    throw e;
  }
}

/** The learner's UTC offset in minutes at `at` (local minus UTC), from the device. */
export const deviceTzOffset = (at: number): number => -new Date(at).getTimezoneOffset();

/** The local day key of `at` (engine localDay), as spoken_time stores it. */
export function dayKey(at: number, tzOffsetMin: (at: number) => number = deviceTzOffset): string {
  return localDay(at, tzOffsetMin(at));
}
