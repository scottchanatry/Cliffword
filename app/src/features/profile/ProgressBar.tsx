import { StyleSheet, View } from 'react-native';
import { colors, radii } from '../../theme';

export interface ProgressBarProps {
  /** 0 to 1. */
  fraction: number;
  /** Translated "{done} of {total}", announced with the bar. */
  label: string;
  testID?: string;
}

/** A thin progress track (download and check of the model file), announced as a progress bar. */
export function ProgressBar({ fraction, label, testID }: ProgressBarProps) {
  const value = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.floor(value * 100) }}
      style={styles.track}
      testID={testID}
    >
      <View style={[styles.fill, { width: `${value * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.ink },
});
