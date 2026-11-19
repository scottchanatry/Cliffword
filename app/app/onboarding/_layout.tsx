import { Stack } from 'expo-router';
import { OnboardingResumeProvider } from '../../src/features/onboarding/useOnboarding';
import { colors } from '../../src/theme';

/**
 * Onboarding: welcome, the experience picker, the level, the form of address, the experience's
 * choices (when it has some), the microphone. No header; the first screen has no back gesture.
 * The resume provider lets the welcome screen forward once to the stored step.
 */
export default function OnboardingLayout() {
  return (
    <OnboardingResumeProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        <Stack.Screen name="index" options={{ gestureEnabled: false }} />
        <Stack.Screen name="experience" />
        <Stack.Screen name="level" />
        <Stack.Screen name="address" />
        <Stack.Screen name="choices" />
        <Stack.Screen name="mic" />
      </Stack>
    </OnboardingResumeProvider>
  );
}
