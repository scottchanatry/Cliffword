import { PlacementTracker } from '@cliffword/engine';
import { DEFAULT_SETTINGS } from '../../storage/repos/settings';
import { sameSessionSettings, sessionSettingsFor, startModeFor, toAppTextMode, toEngineTextMode } from './settings';

describe('story session settings', () => {
  it('maps the app settings onto the engine session settings', () => {
    expect(sessionSettingsFor(DEFAULT_SETTINGS)).toEqual({
      register: 'neutral',
      regions: ['PR', 'CARIB'],
      showExplicit: true,
      textMode: 'auto',
      speechRateBias: 1,
      nativeAnswersAllowed: true,
    });
    const s = sessionSettingsFor({ ...DEFAULT_SETTINGS, register: 'street', showExplicit: false, textMode: 'tiles', speechRateBias: -0.2, nativeAnswersAllowed: false });
    expect(s).toMatchObject({ register: 'street', showExplicit: false, textMode: 'all_tiles', nativeAnswersAllowed: false });
    expect(s.speechRateBias).toBeCloseTo(0.8);
  });

  it('converts the text mode both ways', () => {
    for (const mode of ['auto', 'text', 'tiles'] as const) expect(toAppTextMode(toEngineTextMode(mode))).toBe(mode);
    expect(toEngineTextMode('text')).toBe('all_text');
  });

  it('compares settings by value', () => {
    const a = sessionSettingsFor(DEFAULT_SETTINGS);
    expect(sameSessionSettings(a, sessionSettingsFor({ ...DEFAULT_SETTINGS }))).toBe(true);
    expect(sameSessionSettings(a, sessionSettingsFor({ ...DEFAULT_SETTINGS, regions: ['CU'] }))).toBe(false);
  });

  it('starts brand new or with placement from onboarding, and continues once there is history', () => {
    const none = { storedPrior: null, earlierSessions: 0 };
    expect(startModeFor('brandNew', none)).toBe('brand_new');
    expect(startModeFor('placement', none)).toBe('placement');
    expect(startModeFor('placement', { storedPrior: { kind: 'placement', placement: new PlacementTracker().snapshot() }, earlierSessions: 0 })).toBe('continue');
    expect(startModeFor('brandNew', { storedPrior: { kind: 'brandNew' }, earlierSessions: 1 })).toBe('continue');
  });
});
