import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, MusicHeading, Text } from '../../ui';
import { playClock } from './NowPlayingBar';
import type { LyricKindProps } from './viewTypes';

/** The end of the song: cliffs answered, how many landed fully, time spoken; back to the song page or the library. */
export function SongDoneView({ screen, actions, nav }: LyricKindProps<'done'>) {
  const { t, plural } = useI18n();
  return (
    <>
      <MusicHeading variant="musicHeading" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="done-title">
        {screen.meta.source === 'text' ? t('text.done.title') : t('music.done.title')}
      </MusicHeading>
      <Card testID="done-stats">
        <Text variant="headline" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {plural('music.done.answered', screen.answered)}
        </Text>
        {screen.answered > 0 ? (
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="done-full">
            {t('music.done.full', { n: screen.full, m: screen.answered })}
          </Text>
        ) : null}
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="done-spoken">
          {t('music.done.spoken', { time: playClock(t, screen.meta.spokenMs) })}
        </Text>
      </Card>
      <View style={styles.spacer} />
      <Button label={screen.meta.source === 'text' ? t('text.done.again') : t('music.done.again')} onPress={actions.showSong} testID="done-show-song" />
      {nav?.onBack ? <Button variant="ghost" label={t('music.backToLibrary')} onPress={nav.onBack} testID="done-back" /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
