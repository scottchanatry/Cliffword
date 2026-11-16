import { Stack } from 'expo-router';
import { OnboardingResumeProvider } from '../../src/features/onboarding/useOnboarding';
import { colors } from '../../src/theme';

/**
 * Onboarding (OUTLINE 5.3): welcome, model, voice, slang. No header; the first screen has no back
 * gesture. The resume provider lets the welcome screen forward once to the stored step.
 */
export default function OnboardingLayout() {
  return (
    <OnboardingResumeProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        <Stack.Screen name="index" options={{ gestureEnabled: false }} />
        <Stack.Screen name="model" />
        <Stack.Screen name="voice" />
        <Stack.Screen name="slang" />
      </Stack>
    </OnboardingResumeProvider>
  );
}
