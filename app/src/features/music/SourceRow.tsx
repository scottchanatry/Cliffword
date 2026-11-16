import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { InterfaceText, Text } from '../../ui';

export interface SourceRowProps {
  title: string;
  hint: string;
  /** The action's label; without it the row only says its status. */
  actionLabel?: string;
  onAction?: () => void;
  /** Primary action (Paste) is filled; the others are outlined in ink. */
  primary?: boolean;
  /** Draw the divider below the row. */
  divider?: boolean;
  testID?: string;
}

/** A row in the "Your music" card (C3): source name, status line and one action. */
export function SourceRow({ title, hint, actionLabel, onAction, primary, divider, testID }: SourceRowProps) {
  return (
    <View style={[styles.row, divider && styles.divider]} testID={testID}>
      <View style={styles.text}>
        <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </InterfaceText>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID ? `${testID}-hint` : undefined}>
          {hint}
        </InterfaceText>
      </View>
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          testID={testID ? `${testID}-action` : undefined}
          style={({ pressed }) => [styles.action, primary ? styles.primary : styles.outline, pressed && styles.pressed]}
        >
          <Text variant="pillStrong" tone={primary ? 'onInk' : 'ink'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  text: { flex: 1, gap: spacing.xxs },
  action: { minHeight: layout.minTouch, minWidth: layout.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md + 2, borderRadius: radii.control },
  primary: { backgroundColor: colors.ink },
  outline: { borderWidth: borders.strong, borderColor: colors.ink },
  pressed: { opacity: 0.8 },
});
