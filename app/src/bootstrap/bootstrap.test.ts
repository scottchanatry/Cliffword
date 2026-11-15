import { LearnerModel, frequencyLexemeKeys, type LearnerEvent } from '@cliffword/engine';
import { learnerPrior } from '../learner/prior';
import { createTestServices } from '../services/testServices';
import { bootstrap } from './bootstrap';

describe('bootstrap', () => {
  it('opens storage and starts a new learner with the default settings', async () => {
    const services = createTestServices();
    const boot = await bootstrap(services);
    expect(boot.storage).toBe(await services.storage.open());
    expect(boot.settings).toMatchObject({ onboarded: false, startLevel: 'brandNew' });
    expect(boot.learner).toMatchObject({ snapshotId: null, replayed: 0, lastEventId: 0 });
    await services.storage.close();
  });

  it('restores the learner from the newest snapshot plus later events, with the stored start level', async () => {
    const services = createTestServices();
    const storage = await services.storage.open();
    await storage.settings.update({ onboarded: true, startLevel: 'placement' });
    const prior = learnerPrior(services.packs, 'placement');
    const live = new LearnerModel({ prior });
    const at = services.clock.now();
    const before: LearnerEvent[] = [
      { type: 'heard', key: 'es:mercado', at },
      { type: 'cliff_answer', key: 'es:mercado', at: at + 1, credit: 'full', rung: 'free' },
    ];
    await storage.learner.record(live, before);
    await storage.learner.saveSnapshot(live, at + 2);
    await storage.learner.record(live, [{ type: 'tap_rehear', key: 'es:puesto', at: at + 3 }]);

    const boot = await bootstrap(services);
    expect(boot.settings.startLevel).toBe('placement');
    expect(boot.learner.snapshotId).not.toBeNull();
    expect(boot.learner.replayed).toBe(1);
    const now = at + 60_000;
    const keys = ['es:mercado', 'es:puesto', ...frequencyLexemeKeys(services.packs.lang).slice(0, 50)];
    for (const key of keys) {
      for (const skill of ['meaning', 'sound', 'written', 'speaking'] as const) {
        expect(boot.learner.learner.pKnown(key, skill, now)).toBe(live.pKnown(key, skill, now));
      }
    }
    await services.storage.close();
  });

  it('fails when storage cannot be opened', async () => {
    const services = createTestServices();
    jest.spyOn(services.storage, 'open').mockRejectedValue(new Error('disk full'));
    await expect(bootstrap(services)).rejects.toThrow('disk full');
  });
});
