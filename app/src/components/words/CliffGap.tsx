import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';

export interface CliffGapProps {
  /** ink: the Ink look's dark pill inside text (Main). live: the Voice look's dashed orange tile (B1). */
  variant?: 'ink' | 'live';
  /** live only: the tile width (from the hidden words' spoken length). */
  width?: number;
  testID?: string;
}

/** The place where the story stops mid-sentence: three dots, announced as a gap. */
export function CliffGap({ variant = 'ink', width, testID = 'cliff-gap' }: CliffGapProps) {
  const { t } = useI18n();
  const live = variant === 'live';
  return (
    <View
      accessible
      accessibilityLabel={t('cliff.gap')}
      testID={testID}
      style={[styles.gap, live ? [styles.live, width ? { width } : null] : styles.ink]}
    >
      <View style={[styles.dot, live ? styles.dotLive : styles.dotInk]} />
      <View style={[styles.dot, live ? styles.dotLive : styles.dotInk]} />
      <View style={[styles.dot, live ? styles.dotLive : styles.dotInk]} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 1,
  },
  ink: {
    height: 30,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.tile + 1,
    backgroundColor: colors.ink,
  },
  live: {
    height: 32,
    minWidth: 60,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.tile,
    borderWidth: borders.strong,
    borderStyle: 'dashed',
    borderColor: colors.live,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotInk: { backgroundColor: colors.onInkDot },
  dotLive: { backgroundColor: colors.live },
});
