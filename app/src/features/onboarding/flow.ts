/**
 * The onboarding steps (OUTLINE 5.3) and their routes: welcome (/onboarding), model, voice,
 * slang, then done. settings.onboardingStep stores the step to resume at, so a killed app comes
 * back where it stopped; 'done' goes with onboarded = true, and the root guard then opens the
 * Story tab.
 */
import type { OnboardingStep } from '../../storage/repos/settings';

export type OnboardingScreenStep = Exclude<OnboardingStep, 'done'>;

/** The screens in order. */
export const ONBOARDING_SCREENS: readonly OnboardingScreenStep[] = ['welcome', 'model', 'voice', 'slang'];

export const STEP_ROUTES: Readonly<Record<OnboardingScreenStep, '/onboarding' | '/onboarding/model' | '/onboarding/voice' | '/onboarding/slang'>> = {
  welcome: '/onboarding',
  model: '/onboarding/model',
  voice: '/onboarding/voice',
  slang: '/onboarding/slang',
};

/** The step after `step` ('done' after the last screen). */
export function nextStep(step: OnboardingScreenStep): OnboardingStep {
  const i = ONBOARDING_SCREENS.indexOf(step);
  return ONBOARDING_SCREENS[i + 1] ?? 'done';
}

/** The screen before `step` (welcome has none). */
export function previousStep(step: OnboardingScreenStep): OnboardingScreenStep | null {
  const i = ONBOARDING_SCREENS.indexOf(step);
  return i > 0 ? (ONBOARDING_SCREENS[i - 1] ?? null) : null;
}

/** 1-based position of a screen, for "Step 2 of 4". */
export function stepNumber(step: OnboardingScreenStep): number {
  return ONBOARDING_SCREENS.indexOf(step) + 1;
}

/** Where a stored step resumes: a later screen, or null to stay on the welcome screen. */
export function resumeRoute(step: OnboardingStep): (typeof STEP_ROUTES)[OnboardingScreenStep] | null {
  if (step === 'welcome' || step === 'done') return null;
  return STEP_ROUTES[step];
}
