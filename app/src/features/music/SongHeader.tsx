import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { LyricMeta } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, spacing } from '../../theme';
import { MusicHeading, Text } from '../../ui';
import { regionLabel } from './regionNames';

export interface SongHeaderProps {
  meta: LyricMeta;
  /** Where most of the song's slang is heard (region code), or null. */
  region?: string | null;
  /** The eyebrow above the title ("From your library"); none when omitted. */
  eyebrow?: string;
  /** Replaces the artist line ("Rayo K. · playing in Apple Music"). */
  subtitle?: string;
  /** Title size: page (A3, 28) or small (B4, 20). */
  size?: 'page' | 'small';
  busy?: boolean;
  testID?: string;
}

/** "Luna de Santurce" in Newsreader with "Rayo K. · Puerto Rico" under it (A3, B4). */
export function SongHeader({ meta, region = null, eyebrow, subtitle, size = 'page', busy = false, testID = 'song-header' }: SongHeaderProps) {
  const { t } = useI18n();
  const parts = [meta.artist.trim(), region ? regionLabel(t, region) : ''].filter((p) => p.length > 0);
  const line = subtitle ?? (parts.length > 1 ? t('music.songMeta', { artist: parts[0] ?? '', region: parts[1] ?? '' }) : parts[0] ?? '');
  const title = meta.title.trim() || t(meta.source === 'text' ? 'text.untitled' : 'music.untitled');
  return (
    <View style={styles.box} testID={testID}>
      {eyebrow ? (
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {eyebrow}
        </Text>
      ) : null}
      <View style={styles.titleRow}>
        <Text
          variant="title"
          accessibilityRole="header"
          style={size === 'page' ? styles.pageTitle : styles.smallTitle}
          maxFontSizeMultiplier={CONTENT_MAX_SCALE}
          testID={`${testID}-title`}
        >
          {title}
        </Text>
        {busy ? <ActivityIndicator size="small" color={colors.muted} accessibilityLabel={t('story.busy')} testID="song-busy" /> : null}
      </View>
      {line ? (
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-meta`}>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

export interface MusicTitleProps {
  title: string;
  /** "Rayo K. · line 2 of 24". */
  subtitle?: string;
  busy?: boolean;
  testID?: string;
}

/** The Tarima look's song title (C1): Anton, uppercase, 46 dp, with the line count under it. */
export function MusicTitle({ title, subtitle, busy = false, testID = 'music-title' }: MusicTitleProps) {
  const { t } = useI18n();
  return (
    <View style={styles.musicBox} testID={testID}>
      <MusicHeading variant="musicDisplay" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {title}
      </MusicHeading>
      {subtitle ? (
        <View style={styles.titleRow}>
          <Text variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-sub`}>
            {subtitle}
          </Text>
          {busy ? <ActivityIndicator size="small" color={colors.muted} accessibilityLabel={t('story.busy')} testID="song-busy" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pageTitle: { fontSize: 28, lineHeight: 32, flexShrink: 1 },
  smallTitle: { fontSize: 20, lineHeight: 26, flexShrink: 1 },
  musicBox: { gap: spacing.xs + 2 },
});
