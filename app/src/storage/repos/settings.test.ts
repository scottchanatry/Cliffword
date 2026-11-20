import { openTestStorage } from '../testing/openTestStorage';
import { YOU_AVATAR_IDS } from '../../illustrations';
import {
  DEFAULT_PICTURE,
  DEFAULT_SETTINGS,
  InvalidSettingError,
  isOnboarded,
  normalizePicture,
  ONBOARDED,
  ONBOARDING_VERSION,
  SPEECH_RATE_BIAS_LIMIT,
  type AppSettings,
} from './settings';

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
      onboardingVersion: 0,
      trackId: null,
      address: 'm',
      level: 0,
      trackChoices: {},
      guideSeen: false,
      picture: { kind: 'character', id: 'you' },
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
    await storage.settings.set('onboardingStep', 'picture');
    expect(await storage.settings.get('onboardingStep')).toBe('picture');
    await storage.settings.update({ onboardingStep: 'address', voiceId: 'com.apple.voice.es-MX.Paulina', modelDeclined: true });
    expect(await storage.settings.getAll()).toMatchObject({ onboardingStep: 'address', voiceId: 'com.apple.voice.es-MX.Paulina', modelDeclined: true });
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

  it('checks the experience settings: track, address, level, track choices, the guide', async () => {
    await storage.settings.update({
      trackId: 'en-es.track.living',
      address: 'f',
      level: 4.4,
      trackChoices: { 'en-es.track.dating': { partner: 'valentina' } },
      guideSeen: true,
    });
    expect(await storage.settings.getAll()).toMatchObject({
      trackId: 'en-es.track.living',
      address: 'f',
      level: 4,
      trackChoices: { 'en-es.track.dating': { partner: 'valentina' } },
      guideSeen: true,
    });
    await storage.settings.set('level', 9);
    expect(await storage.settings.get('level')).toBe(5);
    await expect(storage.settings.set('address', 'x' as never)).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('trackId', 'no spaces allowed')).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('trackChoices', { t: { partner: 3 } } as never)).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(storage.settings.set('level', Number.NaN)).rejects.toBeInstanceOf(InvalidSettingError);
    // The earlier onboarding's steps read as the welcome screen.
    await storage.db.run("UPDATE settings SET value = '\"slang\"' WHERE key = 'onboardingStep'");
    expect(await storage.settings.get('onboardingStep')).toBe('welcome');
  });

  it("stores the learner's picture: any of the nine characters, or a photo file", async () => {
    expect(DEFAULT_PICTURE).toEqual({ kind: 'character', id: 'you' });
    for (const id of YOU_AVATAR_IDS) {
      await storage.settings.set('picture', { kind: 'character', id });
      expect(await storage.settings.get('picture')).toEqual({ kind: 'character', id });
    }
    const uri = 'file:///var/mobile/Containers/Data/Application/ABC/Documents/avatar/1763164800000.jpg';
    const after = await storage.settings.update({ picture: { kind: 'photo', uri } });
    expect(after.picture).toEqual({ kind: 'photo', uri });
    expect(Object.isFrozen(after.picture)).toBe(true);
    // Only the picture's own fields are kept.
    await storage.settings.set('picture', { kind: 'character', id: 'you-chef', uri: 'file:///x.jpg' } as never);
    expect(await storage.settings.getAll()).toMatchObject({ picture: { kind: 'character', id: 'you-chef' } });
    expect(await storage.settings.get('picture')).not.toHaveProperty('uri');
  });

  it('rejects an invalid picture and leaves the stored one', async () => {
    await storage.settings.set('picture', { kind: 'character', id: 'you-teen' });
    const invalid: unknown[] = [
      null,
      'you-teen',
      ['you-teen'],
      {},
      { kind: 'character' },
      { kind: 'character', id: 'you-pirate' },
      { kind: 'character', id: '__proto__' },
      { kind: 'photo' },
      { kind: 'photo', uri: '' },
      { kind: 'photo', uri: 'https://example.com/me.jpg' },
      { kind: 'photo', uri: 'file:///has space.jpg' },
      { kind: 'photo', uri: `file:///${'a'.repeat(2100)}.jpg` },
      { kind: 'sticker', id: 'you' },
    ];
    for (const value of invalid) {
      expect(normalizePicture(value)).toBeUndefined();
      await expect(storage.settings.set('picture', value as never)).rejects.toBeInstanceOf(InvalidSettingError);
    }
    expect(await storage.settings.get('picture')).toEqual({ kind: 'character', id: 'you-teen' });
  });

  it('reads an existing install (no picture stored) and unknown or damaged stored pictures as the default character', async () => {
    // An install from before the picture setting: settings rows, none for the picture.
    await storage.settings.update({ onboarded: true, address: 'f', level: 2 });
    expect(await storage.db.get("SELECT value FROM settings WHERE key = 'picture'")).toBeNull();
    expect((await storage.settings.getAll()).picture).toEqual(DEFAULT_PICTURE);
    const stored = [
      'not json',
      '"you-chef"',
      '{"kind":"character","id":"you-astronaut"}',
      '{"kind":"photo","uri":"content://media/external/images/1"}',
      '{"kind":"photo"}',
      'null',
      '[]',
    ];
    for (const value of stored) {
      await storage.db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES ('picture', ?, 0)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [value],
      );
      expect(await storage.settings.get('picture')).toEqual(DEFAULT_PICTURE);
      expect((await storage.settings.getAll()).picture).toEqual(DEFAULT_PICTURE);
    }
    // A later valid write replaces the damaged row.
    await storage.settings.set('picture', { kind: 'character', id: 'you-captain' });
    expect((await storage.settings.getAll()).picture).toEqual({ kind: 'character', id: 'you-captain' });
  });

  it('counts a learner as onboarded only for the current onboarding', async () => {
    await storage.settings.update({ onboarded: true, onboardingStep: 'done' });
    expect(isOnboarded(await storage.settings.getAll())).toBe(false);
    await storage.settings.update(ONBOARDED);
    expect(await storage.settings.get('onboardingVersion')).toBe(ONBOARDING_VERSION);
    expect(isOnboarded(await storage.settings.getAll())).toBe(true);
  });

  it('resets one setting or all of them', async () => {
    await storage.settings.update({ onboarded: true, register: 'street' });
    await storage.settings.reset('register');
    expect(await storage.settings.getAll()).toMatchObject({ onboarded: true, register: 'neutral' });
    await storage.settings.reset();
    expect(await storage.settings.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});
