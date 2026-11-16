import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MeaningView } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, radii, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';

export interface MeaningSheetProps {
  meaning: MeaningView | null;
  onClose: () => void;
}

/**
 * "¿Qué significa?": the word, its gloss, a false-friend warning when the pair pack has one,
 * and the sentence in the learner's language when known. Closing it calls closeMeaning.
 */
export function MeaningSheet({ meaning, onClose }: MeaningSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={meaning !== null} transparent animationType="slide" onRequestClose={onClose} testID="meaning-sheet">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} accessibilityRole="button" testID="meaning-backdrop" />
      {meaning ? (
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]} accessibilityViewIsModal>
          <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('meaning.title')}
          </Text>
          {meaning.key ? (
            <Text variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="meaning-word">
              {meaning.word}
            </Text>
          ) : null}
          {meaning.key ? (
            <Text variant="prompt" tone={meaning.gloss ? 'ink' : 'muted'} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="meaning-gloss">
              {meaning.gloss ?? t('meaning.noGloss')}
            </Text>
          ) : null}
          {meaning.falseFriend ? (
            <Card tone="soft" testID="meaning-false-friend">
              <Text variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('falseFriend.title')}
              </Text>
              <Text variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {meaning.falseFriend}
              </Text>
            </Card>
          ) : null}
          {meaning.translation ? (
            <View style={styles.translation} testID="meaning-translation">
              <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('meaning.sentence')}
              </Text>
              {!meaning.key ? (
                <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                  {meaning.word}
                </Text>
              ) : null}
              <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {meaning.translation}
              </Text>
            </View>
          ) : null}
          <Button label={t('common.close')} onPress={onClose} testID="meaning-close" />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(22, 24, 29, 0.35)' },
  sheet: {
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.card,
  },
  translation: { gap: spacing.xs },
});
