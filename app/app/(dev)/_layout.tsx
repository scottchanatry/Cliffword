import { Stack } from 'expo-router';
import { PREVIEW_ENABLED } from '../../src/preview/enabled';
import { colors } from '../../src/theme';

/**
 * Dev-only screens (the fixture gallery). Guarded: in a store build PREVIEW_ENABLED is false,
 * so the group has no screens and nothing here can be opened.
 */
export default function DevLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
      <Stack.Protected guard={PREVIEW_ENABLED} redirectTo="/">
        <Stack.Screen name="preview/[screen]" />
      </Stack.Protected>
    </Stack>
  );
}
