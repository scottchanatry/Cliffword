import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, spacing } from '../../theme';
import { InterfaceText, Text } from '../../ui';

export interface DangerRowProps {
  /** Translated action ("Reset progress"); also the button's name. */
  title: string;
  /** What it deletes and what stays. */
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  divider?: boolean;
  testID?: string;
}

/** A destructive settings row: the whole row is one button, its title in the accent color. */
export function DangerRow({ title, hint, onPress, disabled = false, divider, testID }: DangerRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <Text variant="rowTitle" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </Text>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {hint}
        </InterfaceText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: layout.primaryHeight, justifyContent: 'center', paddingVertical: spacing.md },
  divider: { borderBottomWidth: borders.hairline, borderBottomColor: colors.borderSoft },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  text: { gap: spacing.xxs },
});
