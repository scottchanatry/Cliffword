import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Button, Text } from '../../ui';

export interface TypeAnswerSheetProps {
  visible: boolean;
  /** The typed answer (trimmed, never empty): the same path as a spoken one, without speaking credit. */
  onSubmit: (text: string) => void;
  onClose: () => void;
}

/** "Type instead": a text field for when speaking is not possible (no mic, a quiet room). */
export function TypeAnswerSheet({ visible, onSubmit, onClose }: TypeAnswerSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const answer = text.trim();
  const send = () => {
    if (!answer) return;
    setText('');
    onSubmit(answer);
  };
  const close = () => {
    setText('');
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} testID="type-sheet">
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.fill} onPress={close} accessibilityLabel={t('common.close')} accessibilityRole="button" testID="type-backdrop" />
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]} accessibilityViewIsModal>
          <Text variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('type.title')}
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            placeholder={t('type.placeholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('type.title')}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            maxFontSizeMultiplier={CHROME_MAX_SCALE}
            style={styles.input}
            testID="type-input"
          />
          <View style={styles.row}>
            <Button variant="ghost" muted label={t('common.cancel')} onPress={close} testID="type-cancel" />
            <Button label={t('type.send')} onPress={send} disabled={!answer} testID="type-send" style={styles.send} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: colors.card,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.control,
    fontFamily: fontFamilies.content,
    fontSize: 20,
    color: colors.ink,
    backgroundColor: colors.ground,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  send: { minHeight: 48, flexGrow: 0 },
});
