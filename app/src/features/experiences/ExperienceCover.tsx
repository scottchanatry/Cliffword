import { Image, StyleSheet } from 'react-native';
import type { LibraryDialect } from '@cliffword/engine';
import { ILLUSTRATION_ASPECT, coverForTrack, seriesKeyOf } from '../../illustrations';
import { radii } from '../../theme';
import { TrackMotif } from './TrackMotif';

export interface ExperienceCoverProps {
  /** LibraryTrack.id: the cover is the series' (by its neutral key, src/illustrations). */
  trackId: string;
  /** For the motif drawn when the series has no cover. */
  dialect: LibraryDialect | null;
  /** Coming soon: drawn faded. */
  muted?: boolean;
  /** Height of the motif fallback (the cover keeps its 2:1 shape). */
  motifHeight?: number;
}

/**
 * The picture across the top of an experience card: the series' cover, or the colored motif
 * (TrackMotif) for a series without one. Decorative: hidden from screen readers.
 */
export function ExperienceCover({ trackId, dialect, muted = false, motifHeight }: ExperienceCoverProps) {
  const cover = coverForTrack(trackId);
  if (!cover) return <TrackMotif dialect={dialect} muted={muted} {...(motifHeight !== undefined ? { height: motifHeight } : {})} />;
  return (
    <Image
      source={cover}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      resizeMode="cover"
      style={[styles.cover, muted && styles.muted]}
      testID={`cover-${seriesKeyOf(trackId) ?? trackId}`}
    />
  );
}

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: ILLUSTRATION_ASPECT.covers, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  muted: { opacity: 0.45 },
});
