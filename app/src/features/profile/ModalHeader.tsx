import { StyleSheet, View } from 'react-native';
import { CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Button, ContentText } from '../../ui';

export interface ModalHeaderProps {
  /** Translated screen title (the screen's first heading). */
  title: string;
  /** Close (the profile) or Back (settings, licenses, self-test). */
  actionLabel: string;
  onAction: () => void;
  /** 'leading' puts the action before the title (Back), 'trailing' after it (Close). */
  placement?: 'leading' | 'trailing';
  actionTestID?: string;
}

/** The Ink header of the profile screens: a Newsreader title and one quiet pill button. */
export function ModalHeader({ title, actionLabel, onAction, placement = 'trailing', actionTestID }: ModalHeaderProps) {
  const action = (
    <Button variant="outline" label={actionLabel} onPress={onAction} testID={actionTestID} style={styles.action} />
  );
  return (
    <View style={styles.row}>
      {placement === 'leading' ? action : null}
      <ContentText variant="title" accessibilityRole="header" style={styles.title} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {title}
      </ContentText>
      {placement === 'trailing' ? action : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.minTouch },
  title: { flex: 1 },
  action: { borderRadius: radii.pill, borderWidth: borders.hairline, borderColor: colors.border, paddingHorizontal: spacing.lg },
});
