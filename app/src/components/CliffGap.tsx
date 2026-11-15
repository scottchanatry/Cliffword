import { StyleSheet, View } from 'react-native';
import { useI18n } from '../i18n';
import { colors, radii, spacing } from '../theme';

/** The ink gap where the story stops mid-sentence (three dots), placed inline in text. */
export function CliffGap() {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityLabel={t('cliff.gap')}
      testID="cliff-gap"
      style={styles.gap}
    >
      <View style={styles.dot} />
      <View style={styles.dot} />
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    height: 30,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.tile + 1,
    backgroundColor: colors.ink,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.onInkDot,
  },
});
