import { matchLocale, normalizeLocale, planRecognition, recognitionLocales, type RecognizerFacts } from './locales';

describe('recognitionLocales', () => {
  it('puts the learner regions first, then the device locale, then the language defaults', () => {
    expect(recognitionLocales('es', ['PR', 'CARIB'])).toEqual(['es-PR', 'es-US', 'es-MX', 'es-419', 'es-ES', 'es']);
    expect(recognitionLocales('es', ['CO'], ['en-US', 'es-ES'])).toEqual(['es-CO', 'es-419', 'es-ES', 'es-US', 'es-MX', 'es']);
    expect(recognitionLocales('es-MX', [])).toEqual(['es-MX', 'es-US', 'es-419', 'es-ES', 'es']);
    expect(recognitionLocales('ja', ['PR'], ['ja-JP'])).toEqual(['ja-JP', 'ja']);
  });
});

describe('matchLocale', () => {
  it('takes the first wanted locale the recognizer has, spelled its way, else the same language', () => {
    expect(matchLocale(['es-PR', 'es-US'], ['en-US', 'es_US', 'es-ES'])).toBe('es_US');
    expect(matchLocale(['es-PR'], ['es-MX', 'es-ES'])).toBe('es-ES');
    expect(matchLocale(['es'], ['en-US', 'es-MX'])).toBe('es-MX');
    expect(matchLocale(['es-US'], ['en-US', 'fr-FR'])).toBeNull();
    expect(normalizeLocale(' ES_mx ')).toBe('es-mx');
  });
});

describe('planRecognition', () => {
  const ios: RecognizerFacts = {
    platform: 'ios',
    locales: ['en-US', 'es-ES', 'es-MX', 'es-US'],
    installedLocales: ['en-US', 'es-ES', 'es-MX', 'es-US'],
    onDeviceRecognizer: true,
  };
  const android: RecognizerFacts = {
    platform: 'android',
    androidApiLevel: 34,
    locales: ['en-US', 'es-ES', 'es-US'],
    installedLocales: ['en-US', 'es-ES'],
    onDeviceRecognizer: true,
  };
  const wanted = ['es-PR', 'es-US', 'es-ES'];

  it('iOS: on device for a supported locale; per-locale support (patched module) decides when known', () => {
    expect(planRecognition(wanted, true, ios)).toEqual({ ok: true, locale: 'es-US', onDevice: true });
    const perLocale = { ...ios, onDeviceFor: (l: string) => l !== 'es-US' };
    expect(planRecognition(wanted, true, perLocale)).toEqual({
      ok: false,
      code: 'on-device-unavailable',
      locale: 'es-US',
      canDownload: false,
    });
    expect(planRecognition(wanted, false, perLocale)).toEqual({ ok: true, locale: 'es-US', onDevice: false });
    expect(planRecognition(['es-US'], true, { ...ios, locales: ['en-US'] })).toMatchObject({ ok: false, code: 'language-not-supported' });
    // Unknown locale list: trust the first choice.
    expect(planRecognition(wanted, true, { ...ios, locales: null })).toEqual({ ok: true, locale: 'es-PR', onDevice: true });
  });

  it('Android 13+: an installed locale runs on device; a missing pack can be downloaded', () => {
    expect(planRecognition(wanted, true, android)).toEqual({ ok: true, locale: 'es-ES', onDevice: true });
    const notInstalled = { ...android, installedLocales: ['en-US'] };
    expect(planRecognition(wanted, true, notInstalled)).toEqual({
      ok: false,
      code: 'on-device-unavailable',
      locale: 'es-US',
      canDownload: true,
    });
    expect(planRecognition(wanted, false, notInstalled)).toEqual({ ok: true, locale: 'es-US', onDevice: false });
    expect(planRecognition(wanted, true, { ...android, locales: ['en-US'] })).toMatchObject({ code: 'language-not-supported' });
    expect(planRecognition(wanted, false, { ...android, locales: ['en-US'] })).toEqual({ ok: true, locale: 'es-PR', onDevice: false });
    expect(planRecognition(wanted, true, { ...android, locales: [] })).toEqual({ ok: true, locale: 'es-PR', onDevice: true });
  });

  it('Android without a forced on-device recognizer: only with network allowed', () => {
    for (const facts of [{ ...android, androidApiLevel: 32 }, { ...android, onDeviceRecognizer: false }]) {
      expect(planRecognition(wanted, true, facts)).toMatchObject({ ok: false, code: 'on-device-unavailable', canDownload: false });
      expect(planRecognition(wanted, false, facts)).toMatchObject({ ok: true, onDevice: false });
    }
  });
});
