import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router, Stack } from 'expo-router';
import { MUSIC_ENABLED } from '../../src/config/features';
import { useI18n } from '../../src/i18n';
import { borders, colors, layout, radii } from '../../src/theme';
import { Text } from '../../src/ui';

function HeaderTitle() {
  const { t } = useI18n();
  return (
    <Text variant="brand" accessibilityRole="header">
      {t('app.name')}
    </Text>
  );
}

/** Back to where the text was opened from (the Music tab when there is nothing below). */
function BackButton() {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/music'))}
      testID="text-back"
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <View style={styles.chevron} />
    </Pressable>
  );
}

/**
 * Brought text: paste an article or a transcript (a sheet), then read it with cliffs and surprise
 * shading. Outside the tabs, so the stack draws the header (the wordmark, the safe area and a
 * back button). Brought text belongs to Music: while Music is off it goes to the Story tab.
 */
export default function TextLayout() {
  if (!MUSIC_ENABLED) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: () => <HeaderTitle />,
        headerTitleAlign: 'left',
        headerLeft: () => <BackButton />,
        headerBackVisible: false,
        headerStyle: { backgroundColor: colors.ground },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      <Stack.Screen name="paste" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[textId]" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  back: {
    width: layout.minTouch,
    height: layout.minTouch,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  pressed: { backgroundColor: colors.borderSoft },
  chevron: {
    width: 12,
    height: 12,
    marginLeft: 5,
    borderLeftWidth: borders.strong,
    borderBottomWidth: borders.strong,
    borderColor: colors.ink,
    transform: [{ rotate: '45deg' }],
  },
});
