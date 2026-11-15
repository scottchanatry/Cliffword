/**
 * Native (iOS, Android): the fonts are embedded at build time by the expo-font config plugin
 * (see app.json), so there is nothing to load. Web uses useAppFonts.web.ts.
 *
 * Returns [loaded, error] like expo-font's useFonts.
 */
export function useAppFonts(): [boolean, Error | null] {
  return [true, null];
}
