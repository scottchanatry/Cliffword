/**
 * useStoryController(): the Story tab's controller for the route, built from useServices()
 * and the app state, read with useSyncExternalStore.
 *
 * - One controller per mount; it starts at once (restoring the stored session or beginning
 *   one) and is suspended and disposed on unmount.
 * - App settings changed elsewhere (profile, Music tab) reach the session.
 * - App background suspends it (speech and listening stop, the session is stored); nothing is
 *   lost on return.
 * - When the session replaces the learner (placement sets a new prior), the controller hands
 *   it to the app state, and the same controller goes on. A learner swapped in from elsewhere
 *   (the start level changed) restarts the controller on it, which restores the session.
 * - The controller is registered with the app state (trackSession) while it lives: a reset of
 *   progress disposes it without a write, clears the data and advances progressEpoch, and a new
 *   controller then starts the first story afresh.
 * - The controller gets the device's locales (expo-localization) for recognition and the voice,
 *   and expo-linking's openURL with the app version and platform for "Report this sentence".
 * - `actions` is the live controller's (stable for its life); before it exists, actions that
 *   do nothing (there is no screen to act on yet).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState as NativeAppState } from 'react-native';
import type { LearnerModel } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import { appVersion, platformLabel } from '../../config/appInfo';
import { openUrl } from '../../config/openUrl';
import { useServices } from '../../services/ServicesProvider';
import { deviceLocales } from '../common/deviceLocales';
import type { StoryActions, StoryViewModel } from '../contract';
import { createStoryController, initialStoryViewModel, type StoryControllerHandle } from './createStoryController';
import { toEngineTextMode } from './settings';

export interface UseStoryController {
  vm: StoryViewModel;
  actions: StoryActions;
}

const noop = () => undefined;

export function useStoryController(): UseStoryController {
  const services = useServices();
  const appState = useAppState();
  const { storage, settings, learner, progressEpoch } = appState;

  // Learners the controller handed to the app state itself: those never restart it.
  const [adopted] = useState(() => new WeakSet<LearnerModel>());
  const [generation, setGeneration] = useState({ learner, n: 0 });
  if (generation.learner !== learner) {
    setGeneration({ learner, n: adopted.has(learner) ? generation.n : generation.n + 1 });
  }

  const latest = useRef(appState);
  useEffect(() => {
    latest.current = appState;
  });

  const [controller, setController] = useState<StoryControllerHandle | null>(null);
  useEffect(() => {
    const state = latest.current;
    // The save on the way out may meet storage already closed (tests, sign-out): no warning then.
    let leaving = false;
    const c = createStoryController({
      model: services.model,
      packs: services.packs,
      storage,
      settings: state.settings,
      learner: state.learner,
      speechOut: services.speechOut,
      speechIn: services.speechIn,
      haptics: services.haptics,
      clock: services.clock,
      deviceLocales: deviceLocales(),
      openUrl,
      appInfo: { ...appVersion(), platform: platformLabel() },
      updateSettings: (patch) => latest.current.updateSettings(patch),
      onLearnerReplaced: (next) => {
        adopted.add(next);
        latest.current.replaceLearner(next);
      },
      onError: (error) => {
        if (!leaving) console.warn('[story] controller error', error);
      },
    });
    const untrack = state.trackSession(c);
    setController(c);
    c.actions.start();
    return () => {
      leaving = true;
      untrack();
      // A controller a reset disposed has nothing to save.
      void c.suspend().finally(() => c.dispose());
    };
  }, [services, storage, generation.n, adopted, progressEpoch]);

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

  const textMode = toEngineTextMode(settings.textMode);
  const modelMode = services.model.status === 'ready' ? 'model' : 'canned';
  const initial = useMemo(() => initialStoryViewModel(textMode, modelMode), [textMode, modelMode]);
  const subscribe = useCallback((listener: () => void) => (controller ? controller.subscribe(listener) : noop), [controller]);
  const getSnapshot = useCallback(() => (controller ? controller.getSnapshot() : initial), [controller, initial]);
  const vm = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const actions = controller ? controller.actions : NO_ACTIONS;

  return { vm, actions };
}

/** Before the controller exists there is no screen, so every action is ignored. */
const NO_ACTIONS: StoryActions = {
  start: noop,
  next: noop,
  hearWord: noop,
  revealWord: noop,
  replay: noop,
  setTextMode: noop,
  startRegisterTask: noop,
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
