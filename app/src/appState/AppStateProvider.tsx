/**
 * What every screen needs once the app has started: the opened storage, the settings and the
 * restored learner model. AppBootstrap builds it from the boot result; screens read it with
 * useAppState(), useSettings() or useLearner(). The storage is also in StorageProvider, so
 * useStorage() works below it.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LearnerModel } from '@cliffword/engine';
import type { BootResult } from '../bootstrap/bootstrap';
import { learnerPrior, type PriorPacks } from '../learner/prior';
import type { AppSettings } from '../storage/repos/settings';
import type { Storage } from '../storage/storage';
import { StorageProvider } from '../storage/StorageProvider';

export interface AppState {
  readonly storage: Storage;
  readonly settings: AppSettings;
  /**
   * The learner model. It is mutable: record events with storage.learner.record(learner, events)
   * so memory and the event log stay in step.
   */
  readonly learner: LearnerModel;
  /**
   * Writes `patch` to storage, then updates `settings` (calls run one after another). A change
   * of startLevel rebuilds the learner with the new prior. Rejects, changing nothing, when a
   * value is invalid (InvalidSettingError) or the write fails.
   */
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}

const AppStateContext = createContext<AppState | null>(null);

export interface AppStateProviderProps {
  boot: BootResult;
  /** The packs the learner prior is built from (services.packs). */
  packs: PriorPacks;
  children: ReactNode;
}

export function AppStateProvider({ boot, packs, children }: AppStateProviderProps) {
  const { storage } = boot;
  const [state, setState] = useState({ settings: boot.settings, learner: boot.learner.learner });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const learnerStart = useRef(boot.settings.startLevel);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>): Promise<AppSettings> => {
      const run = async (): Promise<AppSettings> => {
        const settings = await storage.settings.update(patch);
        let learner: LearnerModel | undefined;
        if (settings.startLevel !== learnerStart.current) {
          const prior = learnerPrior(packs, settings.startLevel);
          learner = (await storage.learner.loadLearner({ prior })).learner;
          learnerStart.current = settings.startLevel;
        }
        setState((prev) => ({ settings, learner: learner ?? prev.learner }));
        return settings;
      };
      const result = chain.current.then(run, run);
      chain.current = result.catch(() => undefined);
      return result;
    },
    [storage, packs],
  );

  const value = useMemo<AppState>(
    () => ({ storage, settings: state.settings, learner: state.learner, updateSettings }),
    [storage, state, updateSettings],
  );

  return (
    <StorageProvider storage={storage}>
      <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
    </StorageProvider>
  );
}

/** Storage, settings and learner. Must be inside AppStateProvider (AppBootstrap provides it). */
export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error('useAppState must be used inside <AppStateProvider> (rendered by <AppBootstrap>)');
  return state;
}

/** The settings and the function that changes them. */
export function useSettings(): Pick<AppState, 'settings' | 'updateSettings'> {
  const { settings, updateSettings } = useAppState();
  return { settings, updateSettings };
}

/** The restored learner model. */
export function useLearner(): LearnerModel {
  return useAppState().learner;
}
