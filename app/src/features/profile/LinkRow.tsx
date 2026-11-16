import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, spacing } from '../../theme';
import { InterfaceText, Text } from '../../ui';

export interface LinkRowProps {
  /** Translated title; also the link's name. */
  title: string;
  hint?: string;
  /** A short value on the right ("Version 1.0.0"). */
  value?: string;
  onPress: () => void;
  divider?: boolean;
  testID?: string;
}

/** A row that opens another screen (Settings, Licenses): a link with a chevron. */
export function LinkRow({ title, hint, value, onPress, divider, testID }: LinkRowProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint={hint}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </InterfaceText>
        {hint ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {hint}
          </InterfaceText>
        ) : null}
      </View>
      {value ? (
        <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {value}
        </InterfaceText>
      ) : null}
      <View style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="cardTitle" tone="muted">
          {CHEVRON}
        </Text>
      </View>
    </Pressable>
  );
}

/** A glyph, not text: hidden from screen readers. */
const CHEVRON = '›';

const styles = StyleSheet.create({
  row: { minHeight: layout.primaryHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: borders.hairline, borderBottomColor: colors.borderSoft },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: spacing.xxs },
  chevron: { paddingLeft: spacing.xs },
});
