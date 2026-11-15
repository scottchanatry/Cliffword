/**
 * Which recognition locale to use, and whether recognition can run on the device.
 *
 * - recognitionLocales(target, regions, deviceLocales): the preference list for a pair's target
 *   language: the learner's slang regions first (Puerto Rico -> es-PR, then es-US), then the
 *   device's own locales in that language, then the language's defaults. Region data lives in
 *   RECOGNITION_LOCALES, not in code.
 * - matchLocale(wanted, available): the first wanted locale the recognizer has, else another
 *   region of the same language.
 * - planRecognition(wanted, onDeviceRequired, facts): the locale and on-device decision for a
 *   session, or the status that stops it ('language-not-supported', 'on-device-unavailable').
 */

/** 'es_MX' and 'ES-mx' both become 'es-mx'. */
export function normalizeLocale(locale: string): string {
  return locale.trim().replace(/_/g, '-').toLowerCase();
}

/** The language part of a locale: 'es-MX' -> 'es'. */
export function baseLanguage(locale: string): string {
  return normalizeLocale(locale).split('-')[0] ?? '';
}

/**
 * Recognition locales per language: `regions` maps a slang region code (the learner's regions
 * setting) to the locales that suit it, best first; `defaults` is the order for everyone else.
 * es-US is the Caribbean fallback: US Spanish recognizers are trained on a lot of Caribbean
 * speech, and neither iOS nor Android lists es-PR, es-DO or es-CU everywhere.
 */
export const RECOGNITION_LOCALES: Readonly<
  Record<string, { regions: Readonly<Record<string, readonly string[]>>; defaults: readonly string[] }>
> = {
  es: {
    regions: {
      PR: ['es-PR', 'es-US'],
      DO: ['es-DO', 'es-US'],
      CU: ['es-CU', 'es-US'],
      CO: ['es-CO', 'es-419'],
      CARIB: ['es-US'],
      MX: ['es-MX'],
      ES: ['es-ES'],
    },
    defaults: ['es-US', 'es-MX', 'es-419', 'es-ES'],
  },
  en: { regions: {}, defaults: ['en-US', 'en-GB'] },
};

/**
 * Locales to try for recognizing `target` (a BCP 47 language such as 'es'), best first: the
 * regions' locales, the device's locales in that language (expo-localization's languageTag
 * values), the language's defaults, and the bare language. Never empty.
 */
export function recognitionLocales(
  target: string,
  regions: readonly string[] = [],
  deviceLocales: readonly string[] = [],
): string[] {
  const lang = baseLanguage(target);
  const table = RECOGNITION_LOCALES[lang];
  const out: string[] = [];
  const add = (locale: string) => {
    const key = normalizeLocale(locale);
    if (key && !out.some((l) => normalizeLocale(l) === key)) out.push(locale.trim().replace(/_/g, '-'));
  };
  if (target.includes('-') || target.includes('_')) add(target);
  for (const region of regions) for (const locale of table?.regions[region] ?? []) add(locale);
  for (const locale of deviceLocales) if (baseLanguage(locale) === lang && locale.includes('-')) add(locale);
  for (const locale of table?.defaults ?? []) add(locale);
  add(lang);
  return out;
}

/**
 * The locale to use from `available` (spelled as `available` has it): the first of `wanted`
 * that it lists exactly, else (for a bare language or no exact match) the first available locale
 * of the first wanted language. null when the recognizer has none of the wanted languages.
 */
export function matchLocale(wanted: readonly string[], available: readonly string[]): string | null {
  const byKey = new Map(available.map((a) => [normalizeLocale(a), a] as const));
  for (const w of wanted) {
    const exact = byKey.get(normalizeLocale(w));
    if (exact) return exact;
  }
  for (const w of wanted) {
    const lang = baseLanguage(w);
    const sameLanguage = available.filter((a) => baseLanguage(a) === lang).sort();
    if (sameLanguage[0]) return sameLanguage[0];
  }
  return null;
}

/** What the recognizer told us about itself (ExpoSpeechIn gathers these from the module). */
export interface RecognizerFacts {
  platform: 'ios' | 'android';
  /** Android API level (Platform.Version); ignored on iOS. */
  androidApiLevel?: number;
  /** Locales the recognizer supports (online or on-device), or null when unknown. */
  locales: readonly string[] | null;
  /** Android: locales whose on-device model is installed. iOS lists every supported locale here. */
  installedLocales: readonly string[] | null;
  /** iOS: the default-locale recognizer runs on device; Android: an on-device recognizer exists. */
  onDeviceRecognizer: boolean;
  /** iOS: on-device support for one locale (needs the module patch); undefined when unknown. */
  onDeviceFor?: (locale: string) => boolean | undefined;
}

export type RecognitionPlan =
  | { ok: true; locale: string; onDevice: boolean }
  | {
      ok: false;
      code: 'language-not-supported' | 'on-device-unavailable';
      /** The locale that would have been used, when one is supported. */
      locale: string | null;
      /** The on-device model can be downloaded (Android 13+, supported but not installed). */
      canDownload: boolean;
    };

/** Android API level from which expo-speech-recognition can force on-device recognition
 * (SpeechRecognizer.createOnDeviceSpeechRecognizer; below it only "prefer offline" exists). */
export const ANDROID_ON_DEVICE_API = 33;

/**
 * The locale and on-device decision for a session. On-device is used whenever it is available.
 * When it is not, `onDeviceRequired` (the default; network recognition off in settings) stops
 * the session with 'on-device-unavailable'; otherwise the platform's server recognizer is used.
 */
export function planRecognition(wanted: readonly string[], onDeviceRequired: boolean, facts: RecognizerFacts): RecognitionPlan {
  const first = wanted[0] ?? '';
  const known = facts.locales && facts.locales.length > 0 ? facts.locales : null;
  const supported = known ? matchLocale(wanted, known) : null;
  const network = (locale: string | null): RecognitionPlan =>
    onDeviceRequired
      ? { ok: false, code: 'on-device-unavailable', locale, canDownload: false }
      : { ok: true, locale: locale ?? first, onDevice: false };

  if (facts.platform === 'ios') {
    if (known && !supported) return { ok: false, code: 'language-not-supported', locale: null, canDownload: false };
    const locale = supported ?? first;
    const forLocale = facts.onDeviceFor?.(locale);
    const onDevice = forLocale ?? facts.onDeviceRecognizer;
    return onDevice ? { ok: true, locale, onDevice: true } : network(locale);
  }

  // Android
  const api = facts.androidApiLevel ?? 0;
  if (api < ANDROID_ON_DEVICE_API || !facts.onDeviceRecognizer) return network(supported);
  if (!known) {
    // The support check failed: try on-device and let the recognizer report a missing model.
    return onDeviceRequired ? { ok: true, locale: first, onDevice: true } : { ok: true, locale: first, onDevice: false };
  }
  if (!supported) {
    return onDeviceRequired
      ? { ok: false, code: 'language-not-supported', locale: null, canDownload: false }
      : { ok: true, locale: first, onDevice: false };
  }
  const installed = facts.installedLocales ? matchLocale(wanted, facts.installedLocales) : null;
  if (installed) return { ok: true, locale: installed, onDevice: true };
  return onDeviceRequired
    ? { ok: false, code: 'on-device-unavailable', locale: supported, canDownload: true }
    : { ok: true, locale: supported, onDevice: false };
}
