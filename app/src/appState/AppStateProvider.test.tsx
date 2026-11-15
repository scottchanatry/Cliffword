import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { LearnerModel, cognateLexemeKeys, frequencyLexemeKeys } from '@cliffword/engine';
import { bootstrap } from '../bootstrap/bootstrap';
import { learnerPrior } from '../learner/prior';
import { createTestServices, type TestServices } from '../services/testServices';
import { InvalidSettingError, type AppSettings } from '../storage/repos/settings';
import { useStorage } from '../storage/StorageProvider';
import { AppStateProvider, useAppState, useLearner, useSettings } from './AppStateProvider';

let services: TestServices;

async function renderState() {
  const boot = await bootstrap(services);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppStateProvider boot={boot} packs={services.packs}>
      {children}
    </AppStateProvider>
  );
  const hook = await renderHook(
    () => ({ state: useAppState(), settings: useSettings(), learner: useLearner(), storage: useStorage() }),
    { wrapper },
  );
  return { boot, ...hook };
}

beforeEach(() => {
  services = createTestServices();
});

afterEach(() => services.storage.close());

describe('AppStateProvider', () => {
  it('gives the boot result to the hooks, and storage to useStorage', async () => {
    const { boot, result } = await renderState();
    expect(result.current.state.storage).toBe(boot.storage);
    expect(result.current.storage).toBe(boot.storage);
    expect(result.current.settings.settings).toEqual(boot.settings);
    expect(result.current.learner).toBe(boot.learner.learner);
  });

  it('writes settings to storage, then shows them', async () => {
    const { result, boot } = await renderState();
    await act(async () => {
      await result.current.settings.updateSettings({ showExplicit: false, regions: ['DO'] });
    });
    expect(result.current.settings.settings).toMatchObject({ showExplicit: false, regions: ['DO'] });
    expect(await boot.storage.settings.getAll()).toMatchObject({ showExplicit: false, regions: ['DO'] });
  });

  it('applies updates one after another, in call order', async () => {
    const { result, boot } = await renderState();
    await act(async () => {
      await Promise.all([
        result.current.state.updateSettings({ textMode: 'tiles' }),
        result.current.state.updateSettings({ textMode: 'text' }),
      ]);
    });
    expect(result.current.settings.settings.textMode).toBe('text');
    expect(await boot.storage.settings.get('textMode')).toBe('text');
  });

  it('rejects an invalid value and changes nothing', async () => {
    const { result, boot } = await renderState();
    const before = result.current.settings.settings;
    await act(async () => {
      await expect(
        result.current.settings.updateSettings({ onboarded: true, register: 'loud' as AppSettings['register'] }),
      ).rejects.toBeInstanceOf(InvalidSettingError);
    });
    expect(result.current.settings.settings).toBe(before);
    expect(await boot.storage.settings.get('onboarded')).toBe(false);
    // The queue keeps working after a failure.
    await act(async () => {
      await result.current.settings.updateSettings({ onboarded: true });
    });
    expect(result.current.settings.settings.onboarded).toBe(true);
  });

  it('rebuilds the learner with the new prior when the start level changes, keeping logged events', async () => {
    const { result } = await renderState();
    const first = result.current.learner;
    const frequent = frequencyLexemeKeys(services.packs.lang).find((k) => !cognateLexemeKeys(services.packs.pair).includes(k)) ?? '';
    const now = services.clock.now();
    await result.current.storage.learner.record(first, [{ type: 'heard', key: 'es:mercado', at: now }]);
    expect(first.pKnown(frequent, 'meaning', now)).toBeLessThan(0.01);

    await act(async () => {
      await result.current.settings.updateSettings({ onboarded: true, startLevel: 'placement' });
    });
    const rebuilt = result.current.learner;
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.pKnown(frequent, 'meaning', now)).toBeGreaterThan(0.9);
    // The logged event was replayed into the rebuilt model: it differs from a fresh one.
    const fresh = new LearnerModel({ prior: learnerPrior(services.packs, 'placement') });
    expect(rebuilt.pKnown('es:mercado', 'sound', now)).toBeGreaterThan(fresh.pKnown('es:mercado', 'sound', now));
    expect(rebuilt.pKnown(frequent, 'meaning', now)).toBe(fresh.pKnown(frequent, 'meaning', now));

    // Other settings leave the learner alone.
    await act(async () => {
      await result.current.settings.updateSettings({ showExplicit: false });
    });
    expect(result.current.learner).toBe(rebuilt);
  });

  it('throws outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useAppState())).rejects.toThrow(/inside <AppStateProvider>/);
    spy.mockRestore();
  });
});
