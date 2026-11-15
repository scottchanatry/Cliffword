import { StyleSheet, View } from 'react-native';
import { colors, layout, radii, spacing } from '../../theme';
import { Button, InterfaceText } from '../../ui';

export interface SourceRowProps {
  title: string;
  hint: string;
  actionLabel: string;
  onAction?: () => void;
  /** Primary action (Paste) is filled; the others are outlined. */
  primary?: boolean;
  /** Draw the divider below the row. */
  divider?: boolean;
  testID?: string;
}

/** A row in the "Your music" card: source name, status line and one action. */
export function SourceRow({ title, hint, actionLabel, onAction, primary, divider, testID }: SourceRowProps) {
  return (
    <View style={[styles.row, divider && styles.divider]} testID={testID}>
      <View style={styles.text}>
        <InterfaceText variant="rowTitle">{title}</InterfaceText>
        <InterfaceText variant="caption" tone="muted">
          {hint}
        </InterfaceText>
      </View>
      <Button
        variant={primary ? 'primary' : 'outline'}
        label={actionLabel}
        onPress={onAction}
        style={primary ? styles.primaryAction : undefined}
      />
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
  primaryAction: { minHeight: layout.minTouch, paddingHorizontal: spacing.lg - 2, borderRadius: radii.control },
});
