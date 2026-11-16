import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, Screen, Text } from '../../ui';
import { FormField } from '../music/FormField';
import type { TextPasteProps } from '../music/types';

/**
 * Bring a text (an article, a transcript, a message): a title, the text, how many sentences
 * and slang words were found, and a note when the model is not ready (the text then opens
 * with simple cliffs and no shading).
 */
export function TextPasteView(props: TextPasteProps) {
  const { t, plural } = useI18n();
  return (
    <Screen scroll testID="text-paste-screen" contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('textPaste.title')}
      </Text>
      <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('textPaste.body')}
      </Text>
      <FormField label={t('textPaste.titleField')} value={props.title} onChangeText={props.onChangeTitle} testID="text-paste-title" />
      <FormField
        label={t('textPaste.textField')}
        placeholder={t('textPaste.placeholder')}
        value={props.text}
        onChangeText={props.onChangeText}
        multiline
        content
        autoCorrect={false}
        testID="text-paste-text"
      />
      {props.preview ? (
        <Card style={styles.counts} testID="text-paste-preview">
          <Text variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {plural('textPaste.sentences', props.preview.sentences)}
          </Text>
          {props.preview.slang > 0 ? (
            <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {plural('textPaste.slang', props.preview.slang)}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {props.modelReady ? null : (
        <Card tone="soft" testID="text-paste-no-model">
          <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('textPaste.noModel')}
          </Text>
        </Card>
      )}
      {props.errorKey ? (
        <Text variant="body" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="text-paste-error" accessibilityLiveRegion="polite">
          {t(props.errorKey)}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <Button label={props.saving ? t('paste.saving') : t('textPaste.save')} onPress={props.onSave} disabled={!props.canSave || props.saving} testID="text-paste-save" />
      <Button variant="ghost" muted label={t('common.cancel')} onPress={props.onCancel} testID="text-paste-cancel" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  counts: { gap: spacing.xs },
  spacer: { flexGrow: 1, minHeight: spacing.sm },
});
