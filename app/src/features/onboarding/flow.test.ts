import { nextStep, ONBOARDING_SCREENS, previousStep, resumeRoute, screensFor, stepPosition } from './flow';

const plain = { hasChoices: false };
const withChoices = { hasChoices: true };

describe('onboarding flow', () => {
  it('runs welcome, experience, level, address, picture, mic, then done (no choices step without choices)', () => {
    expect(ONBOARDING_SCREENS).toEqual(['welcome', 'experience', 'level', 'address', 'picture', 'choices', 'mic']);
    expect(screensFor(plain)).toEqual(['welcome', 'experience', 'level', 'address', 'picture', 'mic']);
    expect(nextStep('welcome', plain)).toBe('experience');
    expect(nextStep('experience', plain)).toBe('level');
    expect(nextStep('level', plain)).toBe('address');
    expect(nextStep('address', plain)).toBe('picture');
    expect(nextStep('picture', plain)).toBe('mic');
    expect(nextStep('mic', plain)).toBe('done');
    expect(previousStep('welcome', plain)).toBeNull();
    expect(previousStep('picture', plain)).toBe('address');
    expect(previousStep('mic', plain)).toBe('picture');
    expect(stepPosition('address', plain)).toEqual({ n: 4, total: 6 });
    expect(stepPosition('picture', plain)).toEqual({ n: 5, total: 6 });
    expect(stepPosition('mic', plain)).toEqual({ n: 6, total: 6 });
  });

  it('asks "Who are you in the story?" right after the address, then the experience choices when there are some', () => {
    expect(nextStep('address', withChoices)).toBe('picture');
    expect(nextStep('picture', withChoices)).toBe('choices');
    expect(nextStep('choices', withChoices)).toBe('mic');
    expect(previousStep('choices', withChoices)).toBe('picture');
    expect(previousStep('mic', withChoices)).toBe('choices');
    expect(stepPosition('picture', withChoices)).toEqual({ n: 5, total: 7 });
    expect(stepPosition('mic', withChoices)).toEqual({ n: 7, total: 7 });
    // A stored choices step whose experience no longer has choices moves on.
    expect(nextStep('choices', plain)).toBe('mic');
    expect(previousStep('choices', plain)).toBe('picture');
  });

  it('resumes a stored step at its route; welcome and done stay put', () => {
    expect(resumeRoute('welcome')).toBeNull();
    expect(resumeRoute('done')).toBeNull();
    expect(resumeRoute('experience')).toBe('/onboarding/experience');
    expect(resumeRoute('picture')).toBe('/onboarding/picture');
    expect(resumeRoute('mic')).toBe('/onboarding/mic');
  });
});
