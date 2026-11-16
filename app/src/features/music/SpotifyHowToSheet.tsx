import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n } from '../../i18n';
import { colors, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';

/** The steps of sharing a song from Spotify (share-in only: its API is closed to new apps). */
export const SPOTIFY_STEPS = [tKey('spotify.howTo.step1'), tKey('spotify.howTo.step2'), tKey('spotify.howTo.step3'), tKey('spotify.howTo.step4')] as const;

export interface SpotifyHowToSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** "Show me" on the Spotify row: how to share a song from Spotify into Cliffword, step by step. */
export function SpotifyHowToSheet({ visible, onClose }: SpotifyHowToSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID="spotify-sheet">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} accessibilityRole="button" testID="spotify-backdrop" />
      <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]} accessibilityViewIsModal>
        <Text variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('spotify.howTo.title')}
        </Text>
        <View style={styles.steps} accessibilityRole="list">
          {SPOTIFY_STEPS.map((key, i) => (
            <View key={key} style={styles.step} testID={`spotify-step-${i + 1}`} accessible accessibilityLabel={t('spotify.howTo.stepA11y', { n: i + 1, step: t(key) })}>
              <View style={styles.number}>
                <Text variant="pillStrong" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                  {String(i + 1)}
                </Text>
              </View>
              <Text variant="body" style={styles.stepText} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t(key)}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('spotify.howTo.note')}
        </Text>
        <Button label={t('common.done')} onPress={onClose} testID="spotify-close" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(22, 24, 29, 0.35)' },
  sheet: {
    gap: spacing.lg,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.card,
  },
  steps: { gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  stepText: { flex: 1, paddingTop: 2 },
});
