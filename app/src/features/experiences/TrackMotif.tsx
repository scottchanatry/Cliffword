import { StyleSheet, View, type DimensionValue } from 'react-native';
import type { LibraryDialect } from '@cliffword/engine';
import { motifColors, radii } from '../../theme';

/** Where the shapes sit, per variety, so each card looks its own (a sun, a wave, a dot). */
const LAYOUTS: Readonly<Record<LibraryDialect, { sun: [DimensionValue, number, number]; wave: [number, number]; dot: [DimensionValue, number, number] }>> = {
  pr: { sun: ['72%', 14, 54], wave: [-18, 0], dot: ['18%', 22, 16] },
  co: { sun: ['10%', 18, 48], wave: [-10, -8], dot: ['66%', 30, 22] },
  ar: { sun: ['60%', 26, 40], wave: [-22, 6], dot: ['14%', 18, 26] },
  mx: { sun: ['30%', 10, 58], wave: [-14, -4], dot: ['80%', 36, 18] },
  pe: { sun: ['76%', 20, 46], wave: [-6, 4], dot: ['8%', 34, 20] },
  cr: { sun: ['44%', 16, 50], wave: [-20, -6], dot: ['86%', 16, 14] },
};

export interface TrackMotifProps {
  dialect: LibraryDialect | null;
  /** Coming soon: drawn faded. */
  muted?: boolean;
  height?: number;
}

/**
 * The colored motif at the top of an experience card: a ground color, a sun, a wave and a dot in
 * the variety's colors (theme motifColors). No flags, no photos. Decorative: hidden from screen
 * readers.
 */
export function TrackMotif({ dialect, muted = false, height = 104 }: TrackMotifProps) {
  const key: LibraryDialect = dialect ?? 'pr';
  const c = motifColors[key];
  const l = LAYOUTS[key];
  const [sunLeft, sunTop, sunSize] = l.sun;
  const [waveBottom, waveRotate] = l.wave;
  const [dotLeft, dotTop, dotSize] = l.dot;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { height, backgroundColor: c.ground }, muted && styles.muted]}
      testID={`motif-${key}`}
    >
      <View style={[styles.round, { left: sunLeft, top: sunTop, width: sunSize, height: sunSize, backgroundColor: c.a }]} />
      <View style={[styles.wave, { bottom: waveBottom, backgroundColor: c.b, transform: [{ rotate: `${waveRotate}deg` }] }]} />
      <View style={[styles.round, { left: dotLeft, top: dotTop, width: dotSize, height: dotSize, backgroundColor: c.a, opacity: 0.85 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  muted: { opacity: 0.45 },
  round: { position: 'absolute', borderRadius: radii.pill },
  wave: { position: 'absolute', left: -40, right: -40, height: 48, borderRadius: radii.pill },
});
