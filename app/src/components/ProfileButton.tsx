import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../i18n';
import { borders, colors, layout, radii } from '../theme';

/** The corner button in the tab header that opens the profile and settings modal. */
export function ProfileButton() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('menu.open')}
      onPress={() => router.push('/profile')}
      testID="profile-button"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.head} />
      <View style={styles.shoulders} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: layout.minTouch,
    height: layout.minTouch,
    borderRadius: radii.pill,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.borderSoft },
  head: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: borders.strong,
    borderColor: colors.ink,
  },
  shoulders: {
    width: 18,
    height: 8,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderWidth: borders.strong,
    borderBottomWidth: 0,
    borderColor: colors.ink,
  },
});
