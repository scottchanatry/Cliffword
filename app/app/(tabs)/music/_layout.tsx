import { Stack } from 'expo-router';
import { LyricControllersProvider } from '../../../src/session/lyric/useLyricController';
import { colors } from '../../../src/theme';

/**
 * The Music tab's stack: the library (C3), a song page (A3 / C1 / B4 by the session's screen),
 * the two registers (C2), time it while you listen, and the paste and share-confirm sheets.
 * Routes of the same song share one lyric controller (LyricControllersProvider).
 */
export default function MusicLayout() {
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
