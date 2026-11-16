import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, Screen, Text } from '../../ui';
import { FormField } from './FormField';
import type { ShareConfirmProps } from './types';

/**
 * A song shared into Cliffword (a Spotify link, "Song - Artist"): what arrived, the title and
 * artist to check or fix, then "Add the song" (its lyrics are pasted next) or "Not this one".
 * A Spotify album or playlist link says so instead.
 */
export function ShareConfirmView(props: ShareConfirmProps) {
  const { t } = useI18n();
  if (!props.shared) {
    return (
      <Screen testID="share-screen">
        <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {t('share.title')}
        </Text>
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="share-nothing">
          {t('share.nothing')}
        </Text>
        <Button variant="outline" label={t('common.back')} onPress={props.onDismiss} testID="share-dismiss" />
      </Screen>
    );
  }
  const what = props.shared.text?.trim() || props.shared.url || '';
  return (
    <Screen scroll testID="share-screen" contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('share.title')}
      </Text>
      <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('share.body')}
      </Text>
      {what ? (
        <Card tone="soft" testID="share-what">
          <Text variant="caption" tone="mutedStrong" numberOfLines={3} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('share.from', { text: what })}
          </Text>
        </Card>
      ) : null}
      {props.notASong ? (
        <Text variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="share-not-a-song">
          {t('share.notASong')}
        </Text>
      ) : (
        <>
          <FormField label={t('paste.songTitle')} value={props.title} onChangeText={props.onChangeTitle} autoCapitalize="words" testID="share-title" />
          <FormField label={t('paste.artist')} value={props.artist} onChangeText={props.onChangeArtist} autoCapitalize="words" testID="share-artist" />
        </>
      )}
      <View style={styles.spacer} />
      {props.notASong ? null : (
        <Button label={props.saving ? t('paste.saving') : t('share.confirm')} onPress={props.onConfirm} disabled={!props.canSave || props.saving} testID="share-confirm" />
      )}
      <Button variant="ghost" muted label={t('share.dismiss')} onPress={props.onDismiss} testID="share-dismiss" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  spacer: { flexGrow: 1, minHeight: spacing.sm },
});
