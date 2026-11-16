import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { colors, spacing } from '../../theme';

/**
 * The lyric cliff (C1): the ink pill with three dots where the song stops, sized for the
 * 40 dp Anton line (44 tall). Announced as a gap.
 */
export function LyricGap({ words = 1, testID = 'lyric-gap' }: { words?: number; testID?: string }) {
  const { t } = useI18n();
  return (
    <View accessible accessibilityLabel={t('cliff.gap')} testID={testID} style={[styles.gap, words > 1 && { paddingHorizontal: spacing.xl + spacing.sm * (words - 1) }]}>
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
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: 10,
    backgroundColor: colors.ink,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onInkDot },
});
