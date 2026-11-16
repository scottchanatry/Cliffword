import { Stack } from 'expo-router';
import { colors } from '../../src/theme';

/** Profile, settings, licenses and the hidden model self-test: a stack inside the profile modal. */
export const unstable_settings = {
  // A link straight to /profile/settings still has the profile under it, so Back leads there.
  anchor: 'index',
};

export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />;
}
