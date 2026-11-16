import {
  LearnerModel,
  PlacementTracker,
  SKILLS,
  cognateLexemeKeys,
  createDefaultPairPack,
  formKey,
  type LearnerEvent,
  type PriorFn,
} from '@cliffword/engine';
import { openTestStorage } from '../testing/openTestStorage';

const HOUR = 3_600_000;
const T0 = new Date(2026, 10, 15, 9, 0).getTime();
const TENER_1S = formKey('es', 'tener', { mood: 'ind', tense: 'pres', person: '1', number: 's' });
const KEYS = ['es:casa', 'es:tener', TENER_1S, 'es:llegar', 'es:mercado', 'es:janguear@PR', 'es:chocolate', 'es:nunca'];

/** A morning of study: every event kind, a form key, and times out of order within the batch. */
function morning(start: number): LearnerEvent[] {
  return [
    { type: 'heard', key: 'es:casa', at: start + 5_000 },
    { type: 'read', key: 'es:casa', at: start + 1_000 },
    { type: 'tap_rehear', key: 'es:mercado', at: start + 6_000 },
    { type: 'hold_reveal', key: 'es:mercado', at: start + 7_000 },
    { type: 'gloss_lookup', key: 'es:llegar', at: start + 8_000 },
    { type: 'cliff_answer', key: 'es:llegar', at: start + 9_000, credit: 'partial', rung: 'options' },
    { type: 'cliff_answer', key: TENER_1S, at: start + 10_000, credit: 'full', rung: 'free' },
    { type: 'cliff_skip', key: 'es:nunca', at: start + 11_000 },
    { type: 'spoke_correct', key: 'es:tener', at: start + 12_000 },
    { type: 'spoke_error', key: 'es:mercado', at: start + 13_000 },
    { type: 'native_gap', key: 'es:janguear@PR', at: start + 14_000 },
    { type: 'marked_known', key: 'es:chocolate', at: start + 2_000 },
  ];
}

function evening(start: number): LearnerEvent[] {
  return [
    { type: 'heard', key: 'es:mercado', at: start },
    { type: 'cliff_answer', key: 'es:mercado', at: start + 1_000, credit: 'full', rung: 'hint' },
    { type: 'cliff_answer', key: TENER_1S, at: start + 2_000, credit: 'none', rung: 'hint' },
    { type: 'spoke_correct', key: 'es:llegar', at: start + 3_000 },
  ];
}

/** pKnown for every key and skill at a few moments after the last event. */
function knowledge(learner: LearnerModel, from: number): number[] {
  const out: number[] = [];
  for (const now of [from, from + 6 * HOUR, from + 72 * HOUR]) {
    for (const key of KEYS) for (const skill of SKILLS) out.push(learner.pKnown(key, skill, now));
  }
  return out;
}

describe('LearnerRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  let prior: PriorFn;

  beforeAll(() => {
    prior = PlacementTracker.brandNew(cognateLexemeKeys(createDefaultPairPack()));
  });
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  describe('event log', () => {
    it('appends events in applyAll order and reads them back whole', async () => {
      const ids = await storage.learner.appendEvents(morning(T0));
      expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      const stored = await storage.learner.eventsSince();
      expect(stored.map((s) => s.event.at)).toEqual([...stored.map((s) => s.event.at)].sort((a, b) => a - b));
      expect(stored.find((s) => s.event.key === TENER_1S)?.event).toEqual({
        type: 'cliff_answer',
        key: TENER_1S,
        at: T0 + 10_000,
        credit: 'full',
        rung: 'free',
      });
      expect(await storage.learner.countEvents()).toBe(12);
    });

    it('reads events after an id, with a limit, and by key', async () => {
      await storage.learner.appendEvents(morning(T0));
      expect((await storage.learner.eventsSince(10)).map((s) => s.id)).toEqual([11, 12]);
      expect(await storage.learner.eventsSince(0, 3)).toHaveLength(3);
      const mercado = await storage.learner.eventsForKey('es:mercado');
      expect(mercado.map((s) => s.event.type)).toEqual(['tap_rehear', 'hold_reveal', 'spoke_error']);
    });

    it('skips events the learner model would ignore', async () => {
      const bad = [
        { type: 'heard', key: '', at: T0 },
        { type: 'heard', key: 'es:casa', at: Number.NaN },
      ] as LearnerEvent[];
      expect(await storage.learner.appendEvents(bad)).toEqual([]);
      expect(await storage.learner.countEvents()).toBe(0);
    });
  });

  describe('snapshots', () => {
    it('saves snapshots with the last event they include and keeps the newest few', async () => {
      const learner = new LearnerModel({ prior });
      await storage.learner.record(learner, morning(T0));
      const first = await storage.learner.saveSnapshot(learner, T0 + HOUR);
      expect(first).toEqual({ id: 1, at: T0 + HOUR, version: 1, throughEventId: 12 });
      const latest = await storage.learner.latestSnapshot();
      expect(latest?.snapshot).toEqual(learner.snapshot());

      for (let i = 0; i < 4; i++) await storage.learner.saveSnapshot(learner, T0 + (i + 2) * HOUR, { keep: 2 });
      const rows = await storage.db.all<{ id: number }>('SELECT id FROM learner_snapshots ORDER BY id');
      expect(rows.map((r) => r.id)).toEqual([4, 5]);
    });

    it('has no snapshot at first', async () => {
      expect(await storage.learner.latestSnapshot()).toBeNull();
    });
  });

  describe('loadLearner', () => {
    it('restores the latest snapshot, replays later events and gives the same pKnown', async () => {
      const live = new LearnerModel({ prior });
      await storage.learner.record(live, morning(T0));
      const snap = await storage.learner.saveSnapshot(live, T0 + HOUR);
      await storage.learner.record(live, evening(T0 + 10 * HOUR));

      const loaded = await storage.learner.loadLearner({ prior });
      expect(loaded).toMatchObject({ snapshotId: snap.id, replayed: 4, skippedSnapshots: 0, lastEventId: 16 });
      expect(knowledge(loaded.learner, T0 + 11 * HOUR)).toEqual(knowledge(live, T0 + 11 * HOUR));
      expect(loaded.learner.snapshot()).toEqual(live.snapshot());
      // The knowledge is real: the round trip is not comparing two empty models.
      expect(live.pKnown('es:mercado', 'meaning', T0 + 11 * HOUR)).not.toBe(prior('es:mercado', 'meaning'));
    });

    it('rebuilds from the whole log when there is no snapshot', async () => {
      const live = new LearnerModel({ prior });
      await storage.learner.record(live, [...morning(T0), ...evening(T0 + 10 * HOUR)]);
      const loaded = await storage.learner.loadLearner({ prior });
      expect(loaded).toMatchObject({ snapshotId: null, replayed: 16 });
      expect(knowledge(loaded.learner, T0 + 11 * HOUR)).toEqual(knowledge(live, T0 + 11 * HOUR));
    });

    it('matches a model that applied the same batches with applyAll', async () => {
      const reference = new LearnerModel({ prior });
      reference.applyAll(morning(T0));
      reference.applyAll(evening(T0 + 10 * HOUR));
      await storage.learner.appendEvents(morning(T0));
      await storage.learner.appendEvents(evening(T0 + 10 * HOUR));
      const loaded = await storage.learner.loadLearner({ prior });
      expect(knowledge(loaded.learner, T0 + 11 * HOUR)).toEqual(knowledge(reference, T0 + 11 * HOUR));
    });

    it('stays in step when recording and snapshotting are not awaited in between', async () => {
      const live = new LearnerModel({ prior });
      const pending = [
        storage.learner.record(live, morning(T0)),
        storage.learner.saveSnapshot(live, T0 + HOUR),
        storage.learner.record(live, evening(T0 + 10 * HOUR)),
      ];
      await Promise.all(pending);
      const loaded = await storage.learner.loadLearner({ prior });
      expect(loaded.replayed).toBe(4);
      expect(knowledge(loaded.learner, T0 + 11 * HOUR)).toEqual(knowledge(live, T0 + 11 * HOUR));
    });

    it('skips a damaged newest snapshot and uses the one before it', async () => {
      const live = new LearnerModel({ prior });
      await storage.learner.record(live, morning(T0));
      await storage.learner.saveSnapshot(live, T0 + HOUR);
      await storage.learner.record(live, evening(T0 + 10 * HOUR));
      const newest = await storage.learner.saveSnapshot(live, T0 + 11 * HOUR);
      await storage.db.run('UPDATE learner_snapshots SET json = ? WHERE id = ?', ['{"version":99}', newest.id]);

      const loaded = await storage.learner.loadLearner({ prior });
      expect(loaded).toMatchObject({ snapshotId: 1, skippedSnapshots: 1, replayed: 4 });
      expect(knowledge(loaded.learner, T0 + 12 * HOUR)).toEqual(knowledge(live, T0 + 12 * HOUR));
    });

    it('starts a new learner on an empty log', async () => {
      const loaded = await storage.learner.loadLearner({ prior });
      expect(loaded).toMatchObject({ snapshotId: null, replayed: 0, lastEventId: 0 });
      expect([...loaded.learner.knownKeys()]).toEqual([]);
      expect(loaded.learner.pKnown('es:chocolate', 'meaning', T0)).toBe(prior('es:chocolate', 'meaning'));
    });

    it('replays event types it does not know without effect', async () => {
      const live = new LearnerModel({ prior });
      await storage.learner.record(live, morning(T0));
      await storage.db.run("INSERT INTO learner_events (at, type, key, payload) VALUES (?, 'sang_along', 'es:casa', '{}')", [
        T0 + HOUR,
      ]);
      const loaded = await storage.learner.loadLearner({ prior });
      expect(knowledge(loaded.learner, T0 + 2 * HOUR)).toEqual(knowledge(live, T0 + 2 * HOUR));
    });
  });
  describe('the prior with the snapshot (v3)', () => {
    const placement = new PlacementTracker().snapshot();

    it('has no prior before one is stored', async () => {
      expect(await storage.learner.latestPrior()).toBeNull();
      await storage.learner.saveSnapshot(new LearnerModel({ prior }), T0);
      expect(await storage.learner.latestPrior()).toBeNull();
    });

    it('stores the PriorSpec with a snapshot and keeps it on later checkpoints', async () => {
      const live = new LearnerModel({ prior });
      await storage.learner.saveSnapshot(live, T0, { prior: { kind: 'brandNew' } });
      expect(await storage.learner.latestPrior()).toEqual({ kind: 'brandNew' });
      await storage.learner.saveSnapshot(live, T0 + 1, { prior: { kind: 'placement', placement } });
      // More checkpoints than are kept: the prior travels with the newest row.
      for (let i = 0; i < 4; i++) await storage.learner.saveSnapshot(live, T0 + 2 + i);
      expect(await storage.learner.latestPrior()).toEqual({ kind: 'placement', placement });
      const rows = await storage.db.all<{ prior: string | null }>('SELECT prior FROM learner_snapshots ORDER BY id');
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.prior !== null)).toBe(true);
    });

    it('reads a damaged prior as none', async () => {
      const info = await storage.learner.saveSnapshot(new LearnerModel({ prior }), T0, { prior: { kind: 'brandNew' } });
      await storage.db.run('UPDATE learner_snapshots SET prior = ? WHERE id = ?', ['{"kind":"oracle"}', info.id]);
      expect(await storage.learner.latestPrior()).toBeNull();
    });
  });
});
