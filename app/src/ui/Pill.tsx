import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borders, colors, layout, radii, spacing } from '../theme';
import { Text } from './Text';

export interface PillProps {
  /** Translated label. */
  label: string;
  /** Makes the pill a button (44 dp tall). Without it the pill is a static chip. */
  onPress?: () => void;
  /** For toggle pills (region choice): filled ink when true, announced as checked. */
  selected?: boolean;
  /**
   * Button pills: quiet (hairline grey border, "Show text") or strong (2 dp ink border,
   * region choices). Static chips: soft (grey, "Spoken today") or heat (amber, gloss).
   */
  variant?: 'quiet' | 'strong' | 'soft' | 'heat';
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A rounded pill: a toggle or action button when onPress is given, otherwise a chip. */
export function Pill({
  label,
  onPress,
  selected,
  variant = onPress ? 'quiet' : 'soft',
  accessibilityLabel,
  testID,
  style,
}: PillProps) {
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.chip, variant === 'heat' ? styles.heat : styles.soft, style]}>
        <Text variant="caption" tone="chip">
          {label}
        </Text>
      </View>
    );
  }
  const isToggle = selected !== undefined;
  return (
    <Pressable
      accessibilityRole={isToggle ? 'togglebutton' : 'button'}
      accessibilityState={isToggle ? { checked: selected } : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        variant === 'strong' ? styles.strong : styles.quiet,
        selected && styles.selected,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text variant={variant === 'strong' ? 'pillStrong' : 'pill'} tone={selected ? 'onInk' : 'ink'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  soft: { backgroundColor: colors.borderSoft },
  heat: { backgroundColor: colors.heat1 },
  button: {
    minHeight: layout.minTouch,
    minWidth: layout.minTouch,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg - 2,
    borderRadius: radii.pill,
  },
  quiet: { borderWidth: borders.hairline, borderColor: colors.border },
  strong: { borderWidth: borders.strong, borderColor: colors.ink },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  pressed: { opacity: 0.8 },
});
