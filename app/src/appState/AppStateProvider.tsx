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
import { clearProgress } from '../storage/progress';
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
  /**
   * Puts a learner model rebuilt elsewhere in place of `learner`: the story session replaces
   * the model when placement sets a new prior (it stores that prior with a learner snapshot
   * first), and every screen should then use the same object.
   */
  replaceLearner(learner: LearnerModel): void;
  /**
   * Reset progress (Settings): stops every live session controller without letting it write
   * (trackSession), clears the progress (src/storage/progress.ts: learner, sessions, stories,
   * minutes spoken; settings, songs, lyrics, texts and the model stay), builds a new learner
   * with the prior of settings.startLevel and advances progressEpoch, so the Story tab starts its
   * first story afresh. Onboarding is not shown again. Runs in turn with updateSettings.
   */
  resetProgress(): Promise<void>;
  /** Advances with every reset: the session hooks build new controllers for it. */
  readonly progressEpoch: number;
  /**
   * A session controller registers while it lives (its hook does), so resetProgress can stop
   * it before clearing what it would write back. Returns the unregister function.
   */
  trackSession(session: { dispose(): void }): () => void;
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
  const [state, setState] = useState({ settings: boot.settings, learner: boot.learner.learner, progressEpoch: 0 });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const learnerStart = useRef(boot.settings.startLevel);
  const [sessions] = useState(() => new Set<{ dispose(): void }>());

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>): Promise<AppSettings> => {
      const run = async (): Promise<AppSettings> => {
        const settings = await storage.settings.update(patch);
        let learner: LearnerModel | undefined;
        if (settings.startLevel !== learnerStart.current) {
          const prior = learnerPrior(packs, settings.startLevel, await storage.learner.latestPrior());
          learner = (await storage.learner.loadLearner({ prior })).learner;
          learnerStart.current = settings.startLevel;
        }
        setState((prev) => ({ ...prev, settings, learner: learner ?? prev.learner }));
        return settings;
      };
      const result = chain.current.then(run, run);
      chain.current = result.catch(() => undefined);
      return result;
    },
    [storage, packs],
  );

  const replaceLearner = useCallback((learner: LearnerModel) => {
    setState((prev) => (prev.learner === learner ? prev : { ...prev, learner }));
  }, []);

  const trackSession = useCallback(
    (session: { dispose(): void }) => {
      // A wrapper per registration: two routes sharing one controller register it twice.
      const entry = { dispose: () => session.dispose() };
      sessions.add(entry);
      return () => void sessions.delete(entry);
    },
    [sessions],
  );

  const resetProgress = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      // Disposed controllers write nothing more; a step already writing finishes first (the
      // database runs one transaction at a time), so the clear below sees everything.
      for (const session of [...sessions]) session.dispose();
      sessions.clear();
      await clearProgress(storage);
      const settings = await storage.settings.getAll();
      const { learner } = await storage.learner.loadLearner({ prior: learnerPrior(packs, settings.startLevel, null) });
      learnerStart.current = settings.startLevel;
      setState((prev) => ({ settings, learner, progressEpoch: prev.progressEpoch + 1 }));
    };
    const result = chain.current.then(run, run);
    chain.current = result.catch(() => undefined);
    return result;
  }, [storage, packs, sessions]);

  const value = useMemo<AppState>(
    () => ({
      storage,
      settings: state.settings,
      learner: state.learner,
      progressEpoch: state.progressEpoch,
      updateSettings,
      replaceLearner,
      resetProgress,
      trackSession,
    }),
    [storage, state, updateSettings, replaceLearner, resetProgress, trackSession],
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
