import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';

export interface ExplicitRowProps {
  /** settings.showExplicit (ON by default). */
  show: boolean;
  onToggle: () => void;
}

/** "Explicit lyrics · On: nothing is skipped · Turn off" (C3, and the onboarding slang step). */
export function ExplicitRow({ show, onToggle }: ExplicitRowProps) {
  const { t } = useI18n();
  return (
    <Card style={styles.card} testID="explicit-row">
      <View style={styles.text}>
        <Text variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('music.explicit.title')}
        </Text>
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="explicit-hint">
          {show ? t('music.explicit.onHint') : t('music.explicit.offHint')}
        </Text>
      </View>
      <Button
        variant="outline"
        label={show ? t('action.turnOff') : t('action.turnOn')}
        onPress={onToggle}
        style={styles.button}
        testID="toggle-explicit"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.list,
  },
  text: { flex: 1, gap: spacing.xxs },
  button: { borderWidth: borders.strong, borderColor: colors.ink, paddingHorizontal: spacing.lg },
});
