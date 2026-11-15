/**
 * Font family names. Each face is its own family, named by the font file's PostScript name,
 * so the same string works on every platform and no style ever sets fontWeight:
 *
 * - iOS: the expo-font config plugin embeds the files (app.json "ios.fonts"); React Native
 *   finds a face by its PostScript name.
 * - Android: the plugin's XML font families (app.json "android.fonts") register each face
 *   under exactly this name.
 * - Web: useAppFonts (useAppFonts.web.ts) loads the bundled files under these names.
 *
 * The files come from @expo-google-fonts (Newsreader, Inter, Anton; OFL). There is no
 * runtime download on any platform. src/theme/fonts.test.ts checks that app.json embeds
 * every family listed here.
 */
export const fontFamilies = {
  /** Newsreader: story text and other content. */
  content: 'Newsreader-Regular',
  contentMedium: 'Newsreader-Medium',
  contentSemiBold: 'Newsreader-SemiBold',
  /** Inter: interface. */
  interface: 'Inter-Regular',
  interfaceMedium: 'Inter-Medium',
  interfaceSemiBold: 'Inter-SemiBold',
  interfaceBold: 'Inter-Bold',
  /** Anton: Music headings, always uppercase. */
  music: 'Anton-Regular',
} as const;

export type FontRole = keyof typeof fontFamilies;
export type FontFamilyName = (typeof fontFamilies)[FontRole];

export const allFontFamilies: readonly FontFamilyName[] = Object.values(fontFamilies);
