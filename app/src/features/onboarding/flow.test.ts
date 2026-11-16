import { nextStep, ONBOARDING_SCREENS, previousStep, resumeRoute, stepNumber } from './flow';

describe('onboarding flow', () => {
  it('runs welcome, model, voice, slang, then done', () => {
    expect(ONBOARDING_SCREENS).toEqual(['welcome', 'model', 'voice', 'slang']);
    expect(nextStep('welcome')).toBe('model');
    expect(nextStep('model')).toBe('voice');
    expect(nextStep('voice')).toBe('slang');
    expect(nextStep('slang')).toBe('done');
    expect(previousStep('welcome')).toBeNull();
    expect(previousStep('slang')).toBe('voice');
    expect(ONBOARDING_SCREENS.map(stepNumber)).toEqual([1, 2, 3, 4]);
  });

  it('resumes a stored step at its route; welcome and done stay put', () => {
    expect(resumeRoute('welcome')).toBeNull();
    expect(resumeRoute('done')).toBeNull();
    expect(resumeRoute('model')).toBe('/onboarding/model');
    expect(resumeRoute('voice')).toBe('/onboarding/voice');
    expect(resumeRoute('slang')).toBe('/onboarding/slang');
  });
});
