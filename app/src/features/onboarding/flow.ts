/**
 * The onboarding steps and their routes: welcome (/onboarding), the experience picker, "How much
 * Spanish do you know?", "How should people address you?", "Who are you in the story?" (the
 * learner's picture: a character or their own photo), the experience's choices (only when it has
 * some, such as "Who do you match with?"), the microphone, then done.
 * settings.onboardingStep stores the step to resume at, so a killed app comes back where it
 * stopped; 'done' goes with onboarded = true and the current onboardingVersion, and the root guard
 * then opens the Story tab.
 */
import type { OnboardingStep } from '../../storage/repos/settings';

export type OnboardingScreenStep = Exclude<OnboardingStep, 'done'>;

/** Every screen in order ('choices' is skipped for an experience without choices). */
export const ONBOARDING_SCREENS: readonly OnboardingScreenStep[] = ['welcome', 'experience', 'level', 'address', 'picture', 'choices', 'mic'];

export type OnboardingRoute =
  | '/onboarding'
  | '/onboarding/experience'
  | '/onboarding/level'
  | '/onboarding/address'
  | '/onboarding/picture'
  | '/onboarding/choices'
  | '/onboarding/mic';

export const STEP_ROUTES: Readonly<Record<OnboardingScreenStep, OnboardingRoute>> = {
  welcome: '/onboarding',
  experience: '/onboarding/experience',
  level: '/onboarding/level',
  address: '/onboarding/address',
  picture: '/onboarding/picture',
  choices: '/onboarding/choices',
  mic: '/onboarding/mic',
};

/** What the steps depend on: whether the chosen experience asks choices. */
export interface FlowContext {
  hasChoices: boolean;
}

/** The screens this learner goes through. */
export function screensFor(ctx: FlowContext): OnboardingScreenStep[] {
  return ONBOARDING_SCREENS.filter((s) => s !== 'choices' || ctx.hasChoices);
}

/** The step after `step` ('done' after the last screen). */
export function nextStep(step: OnboardingScreenStep, ctx: FlowContext): OnboardingStep {
  const screens = screensFor(ctx);
  const i = screens.indexOf(step);
  if (i < 0) return nextStep(ONBOARDING_SCREENS[ONBOARDING_SCREENS.indexOf(step) - 1] ?? 'welcome', ctx);
  return screens[i + 1] ?? 'done';
}

/** The screen before `step` (welcome has none). */
export function previousStep(step: OnboardingScreenStep, ctx: FlowContext): OnboardingScreenStep | null {
  const screens = screensFor(ctx);
  const i = screens.indexOf(step);
  if (i >= 0) return i > 0 ? (screens[i - 1] ?? null) : null;
  // A step this learner skips: the nearest earlier screen they see.
  const all = ONBOARDING_SCREENS.slice(0, ONBOARDING_SCREENS.indexOf(step));
  return [...all].reverse().find((s) => screens.includes(s)) ?? null;
}

/** 1-based position of a screen and the number of screens, for "Step 2 of 5". */
export function stepPosition(step: OnboardingScreenStep, ctx: FlowContext): { n: number; total: number } {
  const screens = screensFor(ctx);
  return { n: Math.max(1, screens.indexOf(step) + 1), total: screens.length };
}

/** Where a stored step resumes: a later screen, or null to stay on the welcome screen. */
export function resumeRoute(step: OnboardingStep): OnboardingRoute | null {
  if (step === 'welcome' || step === 'done') return null;
  return STEP_ROUTES[step];
}
