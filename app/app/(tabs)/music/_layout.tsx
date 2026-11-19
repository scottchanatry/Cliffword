import { Redirect, Stack } from 'expo-router';
import { MUSIC_ENABLED } from '../../../src/config/features';
import { LyricControllersProvider } from '../../../src/session/lyric/useLyricController';
import { colors } from '../../../src/theme';

/**
 * The Music tab's stack: the library (C3), a song page (A3 / C1 / B4 by the session's screen),
 * the two registers (C2), time it while you listen, and the paste and share-confirm sheets.
 * Routes of the same song share one lyric controller (LyricControllersProvider). While Music is
 * off (MUSIC_ENABLED) every music URL goes to the Story tab.
 */
export default function MusicLayout() {
  if (!MUSIC_ENABLED) return <Redirect href="/" />;
  return (
    <LyricControllersProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[songId]" />
        <Stack.Screen name="registers" />
        <Stack.Screen name="time" />
        <Stack.Screen name="paste" options={{ presentation: 'modal' }} />
        <Stack.Screen name="share" options={{ presentation: 'modal' }} />
      </Stack>
    </LyricControllersProvider>
  );
}
