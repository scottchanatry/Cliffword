import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Button, InterfaceText } from '../../ui';
import { ONBOARDING_SCREENS, stepNumber, type OnboardingScreenStep } from './flow';

export interface StepHeaderProps {
  step: OnboardingScreenStep;
  /** Back to the previous step; none on the welcome screen. */
  onBack?: () => void;
}

/** "Back" and "Step 2 of 4", with four short bars showing how far onboarding is. */
export function StepHeader({ step, onBack }: StepHeaderProps) {
  const { t } = useI18n();
  const n = stepNumber(step);
  const total = ONBOARDING_SCREENS.length;
  return (
    <View style={styles.row}>
      {onBack ? <Button variant="outline" label={t('common.back')} onPress={onBack} style={styles.back} testID="onboarding-back" /> : <View style={styles.backSpace} />}
      <View style={styles.progress} accessible accessibilityRole="text" accessibilityLabel={t('onboarding.step', { n, total })} testID="onboarding-step">
        <InterfaceText variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.step', { n, total })}
        </InterfaceText>
        <View style={styles.bars}>
          {ONBOARDING_SCREENS.map((s, i) => (
            <View key={s} style={[styles.bar, i < n ? styles.barDone : styles.barTodo]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: layout.minTouch },
  back: { borderRadius: radii.pill, borderWidth: borders.hairline, borderColor: colors.border, paddingHorizontal: spacing.lg },
  backSpace: { height: layout.minTouch },
  progress: { alignItems: 'flex-end', gap: spacing.xs + 2 },
  bars: { flexDirection: 'row', gap: spacing.xs },
  bar: { width: 22, height: 4, borderRadius: radii.pill },
  barDone: { backgroundColor: colors.ink },
  barTodo: { backgroundColor: colors.track },
});
