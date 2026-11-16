import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, Screen, Text } from '../../ui';
import type { NeedsLyricsProps } from './types';

/** A song without lyrics yet (shared, or added from Apple Music): its title and the way to paste them. */
export function NeedsLyricsView({ title, artist, onPaste, onBack }: NeedsLyricsProps) {
  const { t } = useI18n();
  return (
    <Screen testID="needs-lyrics-screen" contentStyle={styles.content}>
      <View style={styles.head}>
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('needsLyrics.title')}
        </Text>
        <Text variant="title" accessibilityRole="header" style={styles.title} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {title || t('music.untitled')}
        </Text>
        {artist ? (
          <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {artist}
          </Text>
        ) : null}
      </View>
      <Card tone="soft">
        <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('needsLyrics.body')}
        </Text>
      </Card>
      <View style={styles.spacer} />
      <Button label={t('paste.title')} onPress={onPaste} testID="needs-lyrics-paste" />
      {onBack ? <Button variant="ghost" muted label={t('music.backToLibrary')} onPress={onBack} testID="needs-lyrics-back" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  head: { gap: spacing.xs },
  title: { fontSize: 28, lineHeight: 32 },
  spacer: { flexGrow: 1 },
});
