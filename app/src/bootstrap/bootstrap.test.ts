import { LearnerModel, frequencyLexemeKeys, type LearnerEvent } from '@cliffword/engine';
import { learnerPrior } from '../learner/prior';
import { createTestServices } from '../services/testServices';
import type { PhotoPicker } from '../adapters/photo/types';
import { DEFAULT_PICTURE } from '../storage/repos/settings';
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

  it("keeps the learner's photo when its file is there", async () => {
    const services = createTestServices();
    const uri = services.photos.store();
    const storage = await services.storage.open();
    await storage.settings.set('picture', { kind: 'photo', uri });
    const boot = await bootstrap(services);
    expect(boot.settings.picture).toEqual({ kind: 'photo', uri });
    await services.storage.close();
  });

  it('falls back to the default character when the photo file is gone (a restore or a reinstall)', async () => {
    const services = createTestServices();
    const uri = services.photos.store();
    const storage = await services.storage.open();
    await storage.settings.update({ onboarded: true, picture: { kind: 'photo', uri } });
    services.photos.lose(uri);
    const boot = await bootstrap(services);
    expect(boot.settings.picture).toEqual(DEFAULT_PICTURE);
    // Stored, so the next start does not look again; nothing else changed.
    expect(await storage.settings.get('picture')).toEqual(DEFAULT_PICTURE);
    expect(boot.settings.onboarded).toBe(true);
    await services.storage.close();
  });

  it('stores the new uri of a photo found under a moved documents folder', async () => {
    const before = 'file:///var/mobile/Containers/Data/Application/OLD/Documents/avatar/1.jpg';
    const after = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/avatar/1.jpg';
    const photos: PhotoPicker = {
      sources: ['camera', 'library'],
      pick: async () => ({ kind: 'cancelled' }),
      locate: async (uri) => (uri === before ? after : null),
      remove: async () => undefined,
    };
    const services = createTestServices({ photos });
    const storage = await services.storage.open();
    await storage.settings.set('picture', { kind: 'photo', uri: before });
    const boot = await bootstrap(services);
    expect(boot.settings.picture).toEqual({ kind: 'photo', uri: after });
    expect(await storage.settings.get('picture')).toEqual({ kind: 'photo', uri: after });
    await services.storage.close();
  });

  it('starts with the checked picture even when it cannot be stored, and never looks for a character', async () => {
    const services = createTestServices();
    const locate = jest.spyOn(services.photos, 'locate');
    await bootstrap(services);
    expect(locate).not.toHaveBeenCalled();
    const uri = 'file:///fake/documents/avatar/gone.jpg';
    const storage = await services.storage.open();
    await storage.settings.set('picture', { kind: 'photo', uri });
    jest.spyOn(storage.settings, 'update').mockRejectedValueOnce(new Error('disk full'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boot = await bootstrap(services);
    expect(boot.settings.picture).toEqual(DEFAULT_PICTURE);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await services.storage.close();
  });

  it('fails when storage cannot be opened', async () => {
    const services = createTestServices();
    jest.spyOn(services.storage, 'open').mockRejectedValue(new Error('disk full'));
    await expect(bootstrap(services)).rejects.toThrow('disk full');
  });
});
