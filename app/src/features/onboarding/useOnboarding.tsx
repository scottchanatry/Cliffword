/**
 * Moving through onboarding (welcome, experience, level, address, picture, the experience's
 * choices, microphone): each step stores the next one (settings.onboardingStep) before its
 * screen opens, so a killed app resumes there; the last one stores ONBOARDED (onboarded, 'done' and
 * the current onboardingVersion) and the root guard opens the Story tab (nothing navigates there by hand).
 *
 * Resume: OnboardingResumeProvider (app/onboarding/_layout.tsx) reads the stored step when
 * onboarding opens; the welcome screen forwards to it once, and going back to the welcome screen
 * later stays there.
 *
 * Reset progress (Settings) does not come back here: AppState.resetProgress restarts the story.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'expo-router';
import type { PairPack } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import { usePairPack } from '../../engine/PacksProvider';
import { ONBOARDED, type AppSettings } from '../../storage/repos/settings';
import { nextStep, previousStep, resumeRoute, STEP_ROUTES, type FlowContext, type OnboardingScreenStep } from './flow';

/** Whether the experience asks choices before its first episode ("Who do you match with?"). */
export function flowContext(pair: Pick<PairPack, 'tracks'>, trackId: string | null): FlowContext {
  const track = (pair.tracks ?? []).find((t) => t.id === trackId);
  return { hasChoices: (track?.choices ?? []).length > 0 };
}

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
  /** The steps this learner goes through (the chosen experience may add its choices). */
  ctx: FlowContext;
  /** A step is being stored. */
  saving: boolean;
  /** The last store failed (the screen shows a generic error and stays). */
  failed: boolean;
  /** Store `patch` and the next step, then open it (or finish after the last). */
  advance: (from: OnboardingScreenStep, patch?: Partial<AppSettings>) => Promise<void>;
  /** The previous screen (popped to when it is in the history, else opened in place). */
  back: (from: OnboardingScreenStep) => void;
  /** Store settings without moving (choices made on a step). */
  update: (patch: Partial<AppSettings>) => void;
}

export function useOnboarding(): Onboarding {
  const router = useRouter();
  const pair = usePairPack();
  const { settings, updateSettings } = useAppState();
  const ctx = useMemo(() => flowContext(pair, settings.trackId), [pair, settings.trackId]);
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
        const to = nextStep(from, flowContext(pair, patch.trackId !== undefined ? patch.trackId : settings.trackId));
        if (to === 'done') {
          // The guard swaps onboarding for the tabs once this is stored.
          await updateSettings({ ...patch, ...ONBOARDED });
          return;
        }
        await updateSettings({ ...patch, onboardingStep: to });
        router.push(STEP_ROUTES[to]);
      }),
    [store, updateSettings, router, pair, settings.trackId],
  );

  const back = useCallback(
    (from: OnboardingScreenStep) => {
      // Always the step before (a resumed step has the welcome screen under it in the history).
      const to = previousStep(from, ctx);
      if (to) router.dismissTo(STEP_ROUTES[to]);
      else if (router.canGoBack()) router.back();
    },
    [router, ctx],
  );

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      void updateSettings(patch).catch((e: unknown) => console.warn('[onboarding] not saved', e));
    },
    [updateSettings],
  );

  return { settings, ctx, saving, failed, advance, back, update };
}
