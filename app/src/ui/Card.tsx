import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme';

export interface CardProps extends ViewProps {
  /** white: cards (default). soft: grey panels such as "Up next". */
  tone?: 'white' | 'soft';
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A white card (radius 20, padding 20) or a soft grey panel (radius 14). */
export function Card({ tone = 'white', style, children, ...rest }: CardProps) {
  return (
    <View {...rest} style={[styles.base, tone === 'soft' ? styles.soft : styles.white, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    gap: spacing.md,
  },
  white: {
    padding: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  soft: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.panel,
    backgroundColor: colors.borderSoft,
  },
});
