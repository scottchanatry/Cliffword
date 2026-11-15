/**
 * Web fallback for embedded fonts: the config plugin does nothing on web, so the same font
 * files are bundled as assets and registered under the names in fonts.ts. No CDN request.
 */
import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton/400Regular';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader/600SemiBold';
import { fontFamilies, type FontFamilyName } from './fonts';

const webFonts: Record<FontFamilyName, number> = {
  [fontFamilies.content]: Newsreader_400Regular,
  [fontFamilies.contentMedium]: Newsreader_500Medium,
  [fontFamilies.contentSemiBold]: Newsreader_600SemiBold,
  [fontFamilies.interface]: Inter_400Regular,
  [fontFamilies.interfaceMedium]: Inter_500Medium,
  [fontFamilies.interfaceSemiBold]: Inter_600SemiBold,
  [fontFamilies.interfaceBold]: Inter_700Bold,
  [fontFamilies.music]: Anton_400Regular,
};

export function useAppFonts(): [boolean, Error | null] {
  return useFonts(webFonts);
}
