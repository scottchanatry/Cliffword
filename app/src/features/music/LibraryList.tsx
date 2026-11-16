import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey, type Translator } from '../../i18n';
import { colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { regionLabel } from './regionNames';
import type { LibrarySongRow, SlangAmount, SongSummary } from './types';

const AMOUNT: Readonly<Record<Exclude<SlangAmount, 'none'>, CatalogKey>> = {
  lots: tKey('music.slang.lots'),
  some: tKey('music.slang.some'),
  little: tKey('music.slang.little'),
};

/** "Rayo K. · Puerto Rico · lots of slang"; "Vera Sol · neutral Spanish · little slang"; "Brisa 809 · waiting for lyrics". */
export function songRowMeta(t: Translator['t'], artist: string, summary: SongSummary | null): string {
  const who = artist.trim();
  if (!summary) return who ? t('music.library.waiting', { artist: who }) : t('music.library.waitingNoArtist');
  const region = summary.region ? regionLabel(t, summary.region) : t('music.neutralSpanish');
  const vars = { artist: who, region };
  if (summary.slang === 'none') return who ? t('music.library.metaShort', vars) : region;
  const slang = t(AMOUNT[summary.slang]);
  return who ? t('music.library.meta', { ...vars, slang }) : t('music.library.metaShort', { artist: region, region: slang });
}

/** The monogram squares cycle through the previews' three looks: ink with amber, muted, accent. */
const MONOGRAM_LOOKS = [
  { backgroundColor: colors.ink, color: colors.heat2 },
  { backgroundColor: colors.muted, color: colors.onInk },
  { backgroundColor: colors.accentText, color: colors.onInk },
] as const;

/** A 44 dp square with one or two letters in Anton (decorative). */
export function Monogram({ letters, index }: { letters: string; index: number }) {
  const look = MONOGRAM_LOOKS[index % MONOGRAM_LOOKS.length] ?? MONOGRAM_LOOKS[0];
  return (
    <View style={[styles.monogram, { backgroundColor: look.backgroundColor }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.monogramText, { color: look.color }]} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {letters}
      </Text>
    </View>
  );
}

export interface ListRowProps {
  title: string;
  meta: string;
  /** The square or icon on the left. */
  leading?: ReactNode;
  /** A button on the right (Add); otherwise the whole row is the button. */
  trailing?: ReactNode;
  onPress?: () => void;
  hint?: string;
  divider?: boolean;
  testID?: string;
}

/** A row in a white list card (C3): square, title, meta line. The row opens on tap unless it has its own button. */
export function ListRow({ title, meta, leading, trailing, onPress, hint, divider = false, testID }: ListRowProps) {
  const body = (
    <>
      {leading}
      <View style={styles.text}>
        <Text variant="rowTitle" numberOfLines={2} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </Text>
        {meta ? (
          <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID ? `${testID}-meta` : undefined}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );
  if (onPress && !trailing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={meta ? `${title}, ${meta}` : title}
        accessibilityHint={hint}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, divider && styles.divider]} testID={testID}>
      {body}
    </View>
  );
}

/** "From your library": the stored songs with their monogram and what their lyrics hold. */
export function LibraryList({ songs, onOpen }: { songs: readonly LibrarySongRow[]; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.card} testID="library-list">
      {songs.map((song, i) => (
        <ListRow
          key={song.id}
          title={song.title}
          meta={songRowMeta(t, song.artist, song.summary)}
          leading={<Monogram letters={song.monogram} index={i} />}
          onPress={() => onOpen(song.id)}
          hint={t('music.library.openHint')}
          divider={i < songs.length - 1}
          testID={`library-song-${song.id}`}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, borderRadius: radii.list, backgroundColor: colors.card },
  row: { minHeight: layout.minTouch, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md - 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: spacing.xxs },
  monogram: { width: layout.minTouch, height: layout.minTouch, borderRadius: radii.tile + 1, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: fontFamilies.music, fontSize: 18, lineHeight: 24 },
});
