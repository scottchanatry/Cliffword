import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';

export interface CliffGapProps {
  /**
   * ink: the Ink look's dark pill inside text (Main). live: the Voice look's dashed orange tile
   * (B1). song: the Tarima look's big ink pill on the 40 dp Anton line of a song (C1).
   */
  variant?: 'ink' | 'live' | 'song';
  /** live only: the tile width (from the hidden words' spoken length). */
  width?: number;
  /** song only: how many words are missing (a longer pill for more). */
  words?: number;
  testID?: string;
}

/** The place where the story or the song stops mid-line: three dots, announced as a gap. */
export function CliffGap({ variant = 'ink', width, words = 1, testID = 'cliff-gap' }: CliffGapProps) {
  const { t } = useI18n();
  const live = variant === 'live';
  const song = variant === 'song';
  const dot = [styles.dot, live ? styles.dotLive : styles.dotInk, song && styles.dotSong];
  return (
    <View
      accessible
      accessibilityLabel={t('cliff.gap')}
      testID={testID}
      style={[
        styles.gap,
        live ? [styles.live, width ? { width } : null] : song ? [styles.song, words > 1 && { paddingHorizontal: spacing.xl + spacing.sm * (words - 1) }] : styles.ink,
      ]}
    >
      <View style={dot} />
      <View style={dot} />
      <View style={dot} />
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
  song: {
    height: 44,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 10,
    backgroundColor: colors.ink,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotSong: { width: 8, height: 8, borderRadius: 4 },
  dotInk: { backgroundColor: colors.onInkDot },
  dotLive: { backgroundColor: colors.live },
});
