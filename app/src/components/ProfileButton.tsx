import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useI18n } from '../i18n';
import { DEFAULT_PICTURE, type LearnerPicture } from '../storage/repos/settings';
import { borders, colors, layout, radii } from '../theme';
import { LearnerAvatar } from './LearnerAvatar';

/** The picture inside the 44 pt button, leaving the hairline ring visible. */
const AVATAR = layout.minTouch - 6;

/**
 * The corner button in the tab header that opens the profile and settings modal. It shows the
 * learner's picture (settings.picture: their character, or their photo as a circle).
 */
export function ProfileButton({ picture = DEFAULT_PICTURE }: { picture?: LearnerPicture }) {
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
      <LearnerAvatar picture={picture} size={AVATAR} testID="profile-button-avatar" />
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
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.borderSoft, opacity: 0.85 },
});
