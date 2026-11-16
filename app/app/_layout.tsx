import { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ShareIntentBridge } from '../src/adapters/share/ShareIntentBridge';
import { useSettings } from '../src/appState/AppStateProvider';
import { AppBootstrap } from '../src/bootstrap/AppBootstrap';
import { AppProviders } from '../src/providers/AppProviders';
import { colors, useAppFonts } from '../src/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** The splash never stays longer than this, even if startup hangs (the loading state shows instead). */
const SPLASH_MAX_MS = 5000;

const hideSplash = () => void SplashScreen.hideAsync().catch(() => undefined);

/**
 * Fonts (web only; native embeds them), then AppProviders (services, packs, i18n), then
 * ShareIntentBridge (items shared from other apps go to the share inbox; nothing on the web),
 * then AppBootstrap (storage, settings, learner) holding the splash, then the root stack.
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
        <ShareIntentBridge>
          <StatusBar style="dark" />
          <AppBootstrap onSettled={onSettled}>
            <RootStack />
          </AppBootstrap>
        </ShareIntentBridge>
      </AppProviders>
    </GestureHandlerRootView>
  );
}

/**
 * Until onboarding is done only the onboarding screen exists (every other URL redirects to it);
 * afterwards onboarding redirects to the Story tab.
 */
function RootStack() {
  const { settings } = useSettings();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Protected guard={settings.onboarded} redirectTo="/onboarding">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!settings.onboarded} redirectTo="/">
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
