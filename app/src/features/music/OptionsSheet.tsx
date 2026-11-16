import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CliffOption } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';

export interface OptionsSheetProps {
  visible: boolean;
  /** The rung's options (CliffOption), in the engine's seeded order. */
  options: readonly CliffOption[];
  /** The rung's prompt, already translated ("Pick the one that fits."). */
  title: string;
  onPick: (index: number) => void;
  onClose: () => void;
}

/**
 * "Stuck? Show three options" (C1): the options of the options rung as large buttons. Tapping
 * one is the same as singing it; the sheet closes.
 */
export function OptionsSheet({ visible, options, title, onPick, onClose }: OptionsSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID="options-sheet">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.close')} accessibilityRole="button" testID="options-backdrop" />
      <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]} accessibilityViewIsModal>
        <Text variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </Text>
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('cliff.option.hint')}
        </Text>
        {options.map((o) => (
          <Pressable
            key={o.index}
            accessibilityRole="button"
            accessibilityLabel={o.text}
            onPress={() => {
              onClose();
              onPick(o.index);
            }}
            testID={`lyric-option-${o.index}`}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
              {o.text}
            </Text>
          </Pressable>
        ))}
        <Button variant="ghost" muted label={t('common.close')} onPress={onClose} testID="options-close" />
      </View>
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
  option: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: borders.strong,
    borderColor: colors.ink,
    borderRadius: radii.panel,
  },
  pressed: { backgroundColor: colors.borderSoft },
});
