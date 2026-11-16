/**
 * The device's locales, most preferred first, as BCP 47 tags ('es-MX', 'en-US'), from
 * expo-localization's getLocales(). The session controllers pass them on (deps.deviceLocales),
 * so a phone set to a Spanish region adds that region's recognizer and voice to the ones the
 * learner's slang regions pick (recognitionLocales). Empty when the platform reports none.
 */
import { getLocales } from 'expo-localization';

export function deviceLocales(): string[] {
  try {
    return getLocales()
      .map((l) => l.languageTag)
      .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  } catch {
    return [];
  }
}
