import { openTestStorage } from '../testing/openTestStorage';
import { DEFAULT_SETTINGS, InvalidSettingError, SPEECH_RATE_BIAS_LIMIT, type AppSettings } from './settings';

describe('SettingsRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('starts with the defaults from the brief', async () => {
    const expected: AppSettings = {
      register: 'neutral',
      regions: ['PR', 'CARIB'],
      showExplicit: true,
      textMode: 'auto',
      nativeLanguage: 'en',
      targetLanguage: 'es',
      onboarded: false,
      startLevel: 'brandNew',
      speechRateBias: 0,
      nativeAnswersAllowed: true,
      onboardingStep: 'welcome',
      voiceId: null,
      modelDeclined: false,
      allowNetworkRecognition: false,
      progressResetPending: false,
    };
    expect(await storage.settings.getAll()).toEqual(expected);
    expect(DEFAULT_SETTINGS).toEqual(expected);
    expect(await storage.settings.get('regions')).toEqual(['PR', 'CARIB']);
  });

  it('stores typed values and reads them back', async () => {
    await storage.settings.set('register', 'street');
    await storage.settings.set('regions', ['DO', 'CU', 'DO']);
    await storage.settings.set('onboarded', true);
    await storage.settings.set('textMode', 'tiles');
    await storage.settings.set('startLevel', 'placement');
    expect(await storage.settings.get('register')).toBe('street');
    expect(await storage.settings.get('regions')).toEqual(['DO', 'CU']);
    expect(await storage.settings.get('onboarded')).toBe(true);
    const all = await storage.settings.getAll();
    expect(all).toMatchObject({ register: 'street', textMode: 'tiles', showExplicit: true, startLevel: 'placement' });
  });

  it('updates several settings at once and returns the result', async () => {
    const after = await storage.settings.update({ showExplicit: false, speechRateBias: 0.2, nativeAnswersAllowed: false });
    expect(after).toMatchObject({ showExplicit: false, speechRateBias: 0.2, nativeAnswersAllowed: false, register: 'neutral' });
    expect(await storage.settings.getAll()).toEqual(after);
  });

  it('clamps the speech rate bias', async () => {
    await storage.settings.set('speechRateBias', 3);
    expect(await storage.settings.get('speechRateBias')).toBe(SPEECH_RATE_BIAS_LIMIT);
  });

  it('rejects invalid values and leaves the rest of the update unapplied', async () => {
    await expect(
      storage.settings.update({ onboarded: true, register: 'loud' as AppSettings['register'] }),
    ).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('regions', ['pr'])).rejects.toThrow(/regions/);
    await expect(storage.settings.set('nativeLanguage', 'English')).rejects.toThrow(/nativeLanguage/);
    await expect(storage.settings.set('speechRateBias', Number.NaN)).rejects.toThrow();
    await expect(storage.settings.set('startLevel', 'expert' as AppSettings['startLevel'])).rejects.toThrow(/startLevel/);
    expect(await storage.settings.get('onboarded')).toBe(false);
  });

  it('reads damaged or unknown stored values as defaults', async () => {
    await storage.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('register', 'not json', 0)");
    await storage.db.run(`INSERT INTO settings (key, value, updated_at) VALUES ('textMode', '"sideways"', 0)`);
    await storage.db.run(`INSERT INTO settings (key, value, updated_at) VALUES ('fromTheFuture', '1', 0)`);
    expect(await storage.settings.get('register')).toBe('neutral');
    const all = await storage.settings.getAll();
    expect(all.textMode).toBe('auto');
    expect(all).not.toHaveProperty('fromTheFuture');
  });

  it('records when a setting changed', async () => {
    storage.clock.set(1234);
    await storage.settings.set('onboarded', true);
    expect(await storage.db.get("SELECT value, updated_at FROM settings WHERE key = 'onboarded'")).toEqual({
      value: 'true',
      updated_at: 1234,
    });
  });

  it('checks the onboarding, voice and recognition settings', async () => {
    await storage.settings.update({ onboardingStep: 'voice', voiceId: 'com.apple.voice.es-MX.Paulina', modelDeclined: true });
    expect(await storage.settings.getAll()).toMatchObject({ onboardingStep: 'voice', voiceId: 'com.apple.voice.es-MX.Paulina', modelDeclined: true });
    await storage.settings.set('voiceId', null);
    expect(await storage.settings.get('voiceId')).toBeNull();
    await storage.settings.update({ allowNetworkRecognition: true, progressResetPending: true });
    expect(await storage.settings.getAll()).toMatchObject({ allowNetworkRecognition: true, progressResetPending: true });
    await expect(storage.settings.set('onboardingStep', 'tour' as never)).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('voiceId', '   ')).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('modelDeclined', 'yes' as never)).rejects.toBeInstanceOf(InvalidSettingError);
    // A damaged stored value reads as the default.
    await storage.db.run("UPDATE settings SET value = '\"later\"' WHERE key = 'onboardingStep'");
    expect(await storage.settings.get('onboardingStep')).toBe('welcome');
  });

  it('resets one setting or all of them', async () => {
    await storage.settings.update({ onboarded: true, register: 'street' });
    await storage.settings.reset('register');
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, register: 'neutral' });
    await storage.settings.reset();
    expect(await storage.settings.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});
