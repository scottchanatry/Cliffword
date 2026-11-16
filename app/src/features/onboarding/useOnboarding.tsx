/**
 * Moving through onboarding: each step stores the next one (settings.onboardingStep) before its
 * screen opens, so a killed app resumes there; the last one stores onboarded = true and the root
 * guard opens the Story tab (nothing navigates there by hand).
 *
 * Resume: OnboardingResumeProvider (app/onboarding/_layout.tsx) reads the stored step when
 * onboarding opens; the welcome screen forwards to it once, and going back to the welcome screen
 * later stays there.
 *
 * Reset progress (Settings) does not come back here: AppState.resetProgress restarts the story.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useAppState } from '../../appState/AppStateProvider';
import type { AppSettings, StartLevel } from '../../storage/repos/settings';
import { nextStep, previousStep, resumeRoute, STEP_ROUTES, type OnboardingScreenStep } from './flow';

/** The stored step's route when onboarding opened, until a step screen opened. */
const ResumeContext = createContext<ReturnType<typeof resumeRoute>>(null);

/** Reads the stored step once, when onboarding opens (a relaunch), for the welcome screen. */
export function OnboardingResumeProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppState();
  const pathname = usePathname();
  const [route, setRoute] = useState(() => resumeRoute(settings.onboardingStep));
  // Forwarded once: once a step screen is open, going back to the welcome screen stays there.
  if (route && pathname !== STEP_ROUTES.welcome) setRoute(null);
  return <ResumeContext.Provider value={route}>{children}</ResumeContext.Provider>;
}

/** The route the welcome screen should forward to (once per launch of onboarding), or null. */
export function useResumeRoute(): ReturnType<typeof resumeRoute> {
  return useContext(ResumeContext);
}

export interface Onboarding {
  settings: AppSettings;
  /** A step is being stored. */
  saving: boolean;
  /** The last store failed (the screen shows a generic error and stays). */
  failed: boolean;
  /** Store `patch` and the next step, then open it (or finish after the last). */
  advance: (from: OnboardingScreenStep, patch?: Partial<AppSettings>) => Promise<void>;
  /** Welcome: placement ("Start the first story") or brand new. */
  chooseStart: (startLevel: StartLevel) => Promise<void>;
  /** The previous screen (history when there is one, else its route). */
  back: (from: OnboardingScreenStep) => void;
  /** Store settings without moving (choices made on a step). */
  update: (patch: Partial<AppSettings>) => void;
}

export function useOnboarding(): Onboarding {
  const router = useRouter();
  const { settings, updateSettings } = useAppState();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const store = useCallback(
    async (work: () => Promise<void>) => {
      setSaving(true);
      setFailed(false);
      try {
        await work();
      } catch (e) {
        console.warn('[onboarding] not saved', e);
        setFailed(true);
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const advance = useCallback(
    (from: OnboardingScreenStep, patch: Partial<AppSettings> = {}) =>
      store(async () => {
        const to = nextStep(from);
        if (to === 'done') {
          // The guard swaps onboarding for the tabs once this is stored.
          await updateSettings({ ...patch, onboardingStep: 'done', onboarded: true });
          return;
        }
        await updateSettings({ ...patch, onboardingStep: to });
        router.push(STEP_ROUTES[to]);
      }),
    [store, updateSettings, router],
  );

  const chooseStart = useCallback((startLevel: StartLevel) => advance('welcome', { startLevel }), [advance]);

  const back = useCallback(
    (from: OnboardingScreenStep) => {
      const to = previousStep(from);
      if (router.canGoBack()) router.back();
      else if (to) router.replace(STEP_ROUTES[to]);
    },
    [router],
  );

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      void updateSettings(patch).catch((e: unknown) => console.warn('[onboarding] not saved', e));
    },
    [updateSettings],
  );

  return { settings, saving, failed, advance, chooseStart, back, update };
}
