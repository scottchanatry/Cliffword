import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borders, colors, layout, radii, spacing } from '../theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'outline' | 'ghost';

export interface ButtonProps {
  /** Translated label; also the accessibility label unless one is given. */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** primary: ink fill (Hold to speak). outline: hairline border. ghost: text only. */
  variant?: ButtonVariant;
  /** Ghost buttons can be muted (Skip). */
  muted?: boolean;
  disabled?: boolean;
  /** Decorative icon before the label; hidden from screen readers. */
  icon?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A button with at least a 44 x 44 touch target, announced as a button. */
export function Button({
  label,
  onPress,
  onLongPress,
  variant = 'primary',
  muted = false,
  disabled = false,
  icon,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const labelTone = variant === 'primary' ? 'onInk' : muted ? 'muted' : 'ink';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !disabled && pressedStyles[variant],
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      ) : null}
      <Text variant={variant === 'primary' ? 'buttonPrimary' : 'button'} tone={labelTone}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.minTouch,
    minWidth: layout.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
  },
  primary: {
    minHeight: layout.primaryHeight,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
  },
  outline: {
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    borderWidth: borders.hairline,
    borderColor: colors.border,
  },
  ghost: {
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control,
  },
  disabled: {
    opacity: 0.4,
  },
});

const pressedStyles = StyleSheet.create({
  primary: { opacity: 0.85 },
  outline: { backgroundColor: colors.borderSoft },
  ghost: { backgroundColor: colors.borderSoft },
});
