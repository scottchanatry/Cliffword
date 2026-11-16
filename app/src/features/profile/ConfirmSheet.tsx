import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';

export interface ConfirmSheetProps {
  visible: boolean;
  /** Translated question ("Reset your progress?"). */
  title: string;
  /** What will happen and what stays. */
  body: string;
  /** The destructive action's label ("Reset progress"). */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** The action is running: both buttons wait. */
  busy?: boolean;
  testID?: string;
}

/**
 * A confirm dialog as a bottom sheet (a Modal, so it also works on the web, where Alert does
 * nothing). Cancel is the first focus and the backdrop cancels too.
 */
export function ConfirmSheet({ visible, title, body, confirmLabel, onConfirm, onCancel, busy = false, testID = 'confirm-sheet' }: ConfirmSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} testID={testID}>
      <View style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel={t('common.cancel')} testID={`${testID}-backdrop`} />
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]} accessibilityViewIsModal>
          <Text variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {title}
          </Text>
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {body}
          </Text>
          <Button label={confirmLabel} onPress={onConfirm} disabled={busy} testID={`${testID}-confirm`} style={styles.danger} />
          <Button variant="outline" label={t('common.cancel')} onPress={onCancel} disabled={busy} testID={`${testID}-cancel`} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(22, 24, 29, 0.35)' },
  sheet: {
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.card,
  },
  danger: { backgroundColor: colors.accentText },
});
