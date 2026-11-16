/**
 * useLyricController(target): the lyric controller of one song or brought text for a route,
 * built from useServices() and the app state, read with useSyncExternalStore.
 *
 * - Inside <LyricControllersProvider> (the Music stack's layout), every route of the same song
 *   (the song page, the two-registers page, "time it while you listen") shares one controller,
 *   so a tap on the timing page and the song page's cliff act on the same session. The last
 *   route to let go suspends and disposes it. Without the provider (text/[textId]) each mount
 *   has its own.
 * - It starts at once (restoring the stored session of that song or opening its song page).
 * - It recognizes and speaks with the device's locales (expo-localization) after the learner's
 *   slang regions.
 * - App settings changed elsewhere (library pills, profile) reach the session; app background
 *   suspends it (speech and listening stop, the session is stored).
 * - A learner swapped in from elsewhere (placement on the Story tab) builds a new controller on
 *   it, which restores the stored session.
 * - Every controller in use is registered with the app state (trackSession), so a reset of
 *   progress disposes it without a write before the data is cleared; the new learner and
 *   progressEpoch then build a fresh one.
 * - Before the controller exists, actions that do nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState as NativeAppState } from 'react-native';
import type { LearnerModel } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import { useServices } from '../../services/ServicesProvider';
import { deviceLocales } from '../common/deviceLocales';
import type { LyricActions, LyricViewModel } from '../contract';
import { createLyricController, initialLyricViewModel, type LyricControllerDeps, type LyricControllerHandle } from './createLyricController';
import type { LyricSourceState, LyricTarget } from './source';

export interface UseLyricController {
  vm: LyricViewModel;
  actions: Required<LyricActions>;
  source: LyricSourceState;
  /** The live controller (null before it exists): timing lines, position, reload. */
  controller: LyricControllerHandle | null;
}

const noop = () => undefined;

/** Before the controller exists there is no screen, so every action is ignored. */
export const NO_LYRIC_ACTIONS: Required<LyricActions> = {
  start: noop,
  next: noop,
  openLine: noop,
  startEcho: noop,
  setRegister: noop,
  showSong: noop,
  markLine: noop,
  play: noop,
  pause: noop,
  setShowExplicit: noop,
  hearWord: noop,
  holdBegin: noop,
  holdStart: noop,
  holdEnd: noop,
  holdCancel: noop,
  typeAnswer: noop,
  command: noop,
  pickOption: noop,
  closeMeaning: noop,
  dismissNotice: noop,
};

const LOADING: LyricSourceState = { status: 'loading' };

export function targetKey(target: LyricTarget): string {
  return target.kind === 'song' ? `song:${target.songId}` : `text:${target.textId}`;
}

interface Entry {
  key: string;
  learner: LearnerModel;
  controller: LyricControllerHandle;
  refs: number;
}

/** Controllers shared by the routes of one song (see the file header). */
export class LyricControllerRegistry {
  private readonly entries = new Set<Entry>();

  acquire(key: string, learner: LearnerModel, make: () => LyricControllerHandle): LyricControllerHandle {
    for (const e of this.entries) {
      if (e.key === key && e.learner === learner) {
        e.refs += 1;
        return e.controller;
      }
    }
    const entry: Entry = { key, learner, controller: make(), refs: 1 };
    this.entries.add(entry);
    entry.controller.actions.start();
    return entry.controller;
  }

  release(controller: LyricControllerHandle): void {
    for (const e of this.entries) {
      if (e.controller !== controller) continue;
      e.refs -= 1;
      if (e.refs <= 0) {
        this.entries.delete(e);
        void controller.suspend().finally(() => controller.dispose());
      }
      return;
    }
  }

  /** Every live controller of a song or text (a route that changed its lyrics reloads them). */
  find(key: string): LyricControllerHandle[] {
    return [...this.entries].filter((e) => e.key === key).map((e) => e.controller);
  }
}

const RegistryContext = createContext<LyricControllerRegistry | null>(null);

export function LyricControllersProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new LyricControllerRegistry());
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** The registry of the Music stack, or null outside it. */
export function useLyricControllerRegistry(): LyricControllerRegistry | null {
  return useContext(RegistryContext);
}

export function useLyricController(target: LyricTarget | null, overrides: Partial<Pick<LyricControllerDeps, 'ticker' | 'onError'>> = {}): UseLyricController {
  const services = useServices();
  const appState = useAppState();
  const registry = useContext(RegistryContext);
  const { storage, settings, learner, progressEpoch } = appState;
  const key = target ? targetKey(target) : null;

  const latest = useRef({ appState, target, overrides });
  useEffect(() => {
    latest.current = { appState, target, overrides };
  });

  const [controller, setController] = useState<LyricControllerHandle | null>(null);
  useEffect(() => {
    const { appState: state, target: t, overrides: o } = latest.current;
    if (!key || !t) {
      setController(null);
      return;
    }
    // The save on the way out may meet storage already closed (tests, sign-out): no warning then.
    let leaving = false;
    const make = () =>
      createLyricController({
        target: t,
        model: services.model,
        packs: services.packs,
        storage,
        settings: state.settings,
        learner,
        speechOut: services.speechOut,
        speechIn: services.speechIn,
        haptics: services.haptics,
        clock: services.clock,
        music: services.music,
        deviceLocales: deviceLocales(),
        updateSettings: (patch) => latest.current.appState.updateSettings(patch),
        onError:
          o.onError ??
          ((error) => {
            if (!leaving) console.warn('[lyric] controller error', error);
          }),
        ...(o.ticker !== undefined ? { ticker: o.ticker } : {}),
      });
    let c: LyricControllerHandle;
    if (registry) c = registry.acquire(key, learner, make);
    else {
      c = make();
      c.actions.start();
    }
    const untrack = state.trackSession(c);
    setController(c);
    return () => {
      leaving = true;
      untrack();
      if (registry) registry.release(c);
      else void c.suspend().finally(() => c.dispose());
    };
  }, [key, services, storage, learner, registry, progressEpoch]);

  useEffect(() => {
    controller?.setAppSettings(settings);
  }, [controller, settings]);

  useEffect(() => {
    if (!controller) return;
    const sub = NativeAppState.addEventListener('change', (status) => {
      if (status === 'background') void controller.suspend();
    });
    return () => sub.remove();
  }, [controller]);

  const modelMode = services.model.status === 'ready' ? 'model' : 'canned';
  const initial = useMemo(() => initialLyricViewModel(settings, modelMode), [settings, modelMode]);
  const subscribe = useCallback((listener: () => void) => (controller ? controller.subscribe(listener) : noop), [controller]);
  const getSnapshot = useCallback(() => (controller ? controller.getSnapshot() : initial), [controller, initial]);
  const getSource = useCallback(() => (controller ? controller.getSource() : LOADING), [controller]);
  const vm = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const source = useSyncExternalStore(subscribe, getSource, getSource);

  return { vm, actions: controller ? controller.actions : NO_LYRIC_ACTIONS, source, controller };
}
