import { cognateLexemeKeys, frequencyLexemeKeys } from '@cliffword/engine';
import { defaultPacks } from '../services/defaults';
import { learnerPrior } from './prior';

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
});
