import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../../theme';
import { InterfaceText } from '../../ui';

export interface SettingsRowProps {
  title: string;
  value?: string;
  hint?: string;
  divider?: boolean;
  testID?: string;
}

/** A label and value row inside a settings card. */
export function SettingsRow({ title, value, hint, divider, testID }: SettingsRowProps) {
  return (
    <View style={[styles.row, divider && styles.divider]} testID={testID}>
      <View style={styles.top}>
        <InterfaceText variant="rowTitle" style={styles.title}>
          {title}
        </InterfaceText>
        {value ? (
          <InterfaceText variant="body" tone="muted">
            {value}
          </InterfaceText>
        ) : null}
      </View>
      {hint ? (
        <InterfaceText variant="caption" tone="muted">
          {hint}
        </InterfaceText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.md, gap: spacing.xxs },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  title: { flex: 1 },
});
