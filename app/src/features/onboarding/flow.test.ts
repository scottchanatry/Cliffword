import { nextStep, ONBOARDING_SCREENS, previousStep, resumeRoute, screensFor, stepPosition } from './flow';

const plain = { hasChoices: false };
const withChoices = { hasChoices: true };

describe('onboarding flow', () => {
  it('runs welcome, experience, level, address, mic, then done (no choices step without choices)', () => {
    expect(ONBOARDING_SCREENS).toEqual(['welcome', 'experience', 'level', 'address', 'choices', 'mic']);
    expect(screensFor(plain)).toEqual(['welcome', 'experience', 'level', 'address', 'mic']);
    expect(nextStep('welcome', plain)).toBe('experience');
    expect(nextStep('experience', plain)).toBe('level');
    expect(nextStep('level', plain)).toBe('address');
    expect(nextStep('address', plain)).toBe('mic');
    expect(nextStep('mic', plain)).toBe('done');
    expect(previousStep('welcome', plain)).toBeNull();
    expect(previousStep('mic', plain)).toBe('address');
    expect(stepPosition('mic', plain)).toEqual({ n: 5, total: 5 });
  });

  it('asks the experience choices after the address when there are some', () => {
    expect(nextStep('address', withChoices)).toBe('choices');
    expect(nextStep('choices', withChoices)).toBe('mic');
    expect(previousStep('mic', withChoices)).toBe('choices');
    expect(stepPosition('mic', withChoices)).toEqual({ n: 6, total: 6 });
    // A stored choices step whose experience no longer has choices moves on.
    expect(nextStep('choices', plain)).toBe('mic');
    expect(previousStep('choices', plain)).toBe('address');
  });

  it('resumes a stored step at its route; welcome and done stay put', () => {
    expect(resumeRoute('welcome')).toBeNull();
    expect(resumeRoute('done')).toBeNull();
    expect(resumeRoute('experience')).toBe('/onboarding/experience');
    expect(resumeRoute('mic')).toBe('/onboarding/mic');
  });
});
