import { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSettings } from '../src/appState/AppStateProvider';
import { AppBootstrap } from '../src/bootstrap/AppBootstrap';
import { useModelAutoDownload } from '../src/features/profile/useModelAutoDownload';
import { AppProviders } from '../src/providers/AppProviders';
import { isOnboarded } from '../src/storage/repos/settings';
import { colors, useAppFonts } from '../src/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** The splash never stays longer than this, even if startup hangs (the loading state shows instead). */
const SPLASH_MAX_MS = 5000;

const hideSplash = () => void SplashScreen.hideAsync().catch(() => undefined);

/**
 * Fonts (web only; native embeds them), then AppProviders (services, packs, i18n), then
 * AppBootstrap (storage, settings, learner) holding the splash, then the root stack. Share-in
 * (expo-share-intent, src/adapters/share) is not in this build: no share extension, no bridge.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);
  const onSettled = useCallback(() => hideSplash(), []);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <AppProviders>
        <StatusBar style="dark" />
        <AppBootstrap onSettled={onSettled}>
          <RootStack />
        </AppBootstrap>
      </AppProviders>
    </GestureHandlerRootView>
  );
}

/**
 * Until onboarding is done (in its current version: isOnboarded) only the onboarding screens exist
 * (every other URL redirects to them); afterwards onboarding redirects to the Story tab, and the
 * language model downloads in the background on Wi-Fi (useModelAutoDownload).
 */
function RootStack() {
  const { settings } = useSettings();
  useModelAutoDownload();
  const onboarded = isOnboarded(settings);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Protected guard={onboarded} redirectTo="/onboarding">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        {/* Brought text (articles, transcripts): app/text/_layout.tsx. */}
        <Stack.Screen name="text" />
      </Stack.Protected>
      <Stack.Protected guard={!onboarded} redirectTo="/">
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
