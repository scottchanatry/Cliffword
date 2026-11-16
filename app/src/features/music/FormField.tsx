import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  /** The translated label above the field (also the field's accessible name). */
  label: string;
  /** content: Newsreader, for pasted lyrics or text. */
  content?: boolean;
  testID?: string;
}

/** A labelled text field on a white card (paste, share, brought text). */
export function FormField({ label, content = false, multiline, testID, ...rest }: FormFieldProps) {
  return (
    <View style={styles.box}>
      <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, content ? styles.content : styles.ui, multiline && styles.multiline]}
        testID={testID}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs + 2 },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.control,
    backgroundColor: colors.card,
    color: colors.ink,
  },
  ui: { fontFamily: fontFamilies.interface, fontSize: 16 },
  content: { fontFamily: fontFamilies.content, fontSize: 18, lineHeight: 26 },
  multiline: { minHeight: 180 },
});
