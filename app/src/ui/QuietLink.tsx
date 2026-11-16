import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { layout, spacing } from '../theme';
import { Text } from './Text';

export interface QuietLinkProps {
  /** Translated label; also the accessibility label unless one is given. */
  label: string;
  onPress: () => void;
  /** link: opens a page in another app (the privacy policy); button: an action (report a sentence). */
  role?: 'link' | 'button';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Upper bound for Dynamic Type (chrome caps at 1.2x). */
  maxFontSizeMultiplier?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A small muted text link (13 dp caption, underlined) for footers: the welcome screen's privacy
 * policy, "Report this sentence" under a story screen. Small to look at, but the target is still
 * 44 dp tall and at least 44 dp wide.
 */
export function QuietLink({ label, onPress, role = 'link', accessibilityLabel, accessibilityHint, maxFontSizeMultiplier, testID, style }: QuietLinkProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={spacing.xs}
      testID={testID}
      style={({ pressed }) => [styles.base, pressed && styles.pressed, style]}
    >
      <Text variant="caption" tone="muted" style={styles.label} maxFontSizeMultiplier={maxFontSizeMultiplier}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.minTouch,
    minWidth: layout.minTouch,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  label: { textDecorationLine: 'underline', textAlign: 'center' },
});
