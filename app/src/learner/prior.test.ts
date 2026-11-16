import { PlacementTracker, cognateLexemeKeys, frequencyLexemeKeys, rankOfFromPack } from '@cliffword/engine';
import { defaultPacks } from '../services/defaults';
import { learnerPrior, priorSpecFor } from './prior';

describe('learnerPrior', () => {
  const packs = defaultPacks();
  const cognate = cognateLexemeKeys(packs.pair).find((k) => k === 'es:hospital') ?? cognateLexemeKeys(packs.pair)[0] ?? '';
  const frequent = frequencyLexemeKeys(packs.lang)[0] ?? '';
  const rare = 'es:zarigüeya';

  it('has keys to test with', () => {
    expect(cognate).toMatch(/^es:/);
    expect(frequent).toMatch(/^es:/);
    expect(cognateLexemeKeys(packs.pair)).not.toContain(frequent);
  });

  it("brand new: only cognates are probably understood, and less by ear or in speech", () => {
    const prior = learnerPrior(packs, 'brandNew');
    expect(prior(cognate, 'meaning')).toBe(0.5);
    expect(prior(cognate, 'sound')).toBeLessThan(prior(cognate, 'meaning'));
    expect(prior(cognate, 'speaking')).toBeLessThan(prior(cognate, 'sound'));
    expect(prior(frequent, 'meaning')).toBeLessThan(0.01);
    expect(prior(rare, 'meaning')).toBeLessThan(0.01);
  });

  it('placement: starts from a lower-intermediate estimate by frequency rank', () => {
    const prior = learnerPrior(packs, 'placement');
    expect(prior(frequent, 'meaning')).toBeGreaterThan(0.9);
    expect(prior(rare, 'meaning')).toBeLessThan(0.05);
    expect(prior(cognate, 'meaning')).toBeGreaterThanOrEqual(0.5);
    expect(prior(frequent, 'speaking')).toBeLessThan(prior(frequent, 'meaning'));
  });

  it('is the same function of its inputs every time (priors are not stored)', () => {
    const a = learnerPrior(packs, 'placement');
    const b = learnerPrior(packs, 'placement');
    for (const key of [cognate, frequent, rare]) expect(a(key, 'meaning')).toBe(b(key, 'meaning'));
  });

  it('uses the placement stored with the learner snapshot, only for the placement start level', () => {
    const tracker = new PlacementTracker();
    for (let i = 0; i < 6; i++) tracker.record(`es:probe${i}`, 2 ** (i + 3), false);
    const stored = { kind: 'placement' as const, placement: tracker.snapshot() };
    expect(priorSpecFor('placement', stored)).toBe(stored);
    expect(priorSpecFor('brandNew', stored)).toEqual({ kind: 'brandNew' });
    expect(priorSpecFor('placement', { kind: 'brandNew' }).kind).toBe('placement');
    const placed = learnerPrior(packs, 'placement', stored);
    const fresh = learnerPrior(packs, 'placement');
    const expected = PlacementTracker.restore(stored.placement).prior(rankOfFromPack(packs.lang), cognateLexemeKeys(packs.pair));
    expect(placed(frequent, 'meaning')).toBe(expected(frequent, 'meaning'));
    // Every probe missed: the stored placement knows less than the fresh estimate.
    expect(placed(frequent, 'meaning')).toBeLessThan(fresh(frequent, 'meaning'));
  });

  it('builds the fresh placement prior as the engine does (buildPrior over a new tracker)', () => {
    const prior = learnerPrior(packs, 'placement');
    const engine = new PlacementTracker().prior(rankOfFromPack(packs.lang), cognateLexemeKeys(packs.pair));
    for (const key of [cognate, frequent, rare]) expect(prior(key, 'meaning')).toBe(engine(key, 'meaning'));
  });
});
