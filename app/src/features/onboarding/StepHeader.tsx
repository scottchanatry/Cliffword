import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Button, InterfaceText } from '../../ui';
import { stepPosition, type FlowContext, type OnboardingScreenStep } from './flow';

export interface StepHeaderProps {
  step: OnboardingScreenStep;
  /** The steps this learner goes through (an experience with choices adds one). */
  ctx?: FlowContext;
  /** Back to the previous step; none on the welcome screen. */
  onBack?: () => void;
}

/** "Back" and "Step 2 of 5", with a short bar per step showing how far onboarding is. */
export function StepHeader({ step, ctx = { hasChoices: false }, onBack }: StepHeaderProps) {
  const { t } = useI18n();
  const { n, total } = stepPosition(step, ctx);
  return (
    <View style={styles.row}>
      {onBack ? <Button variant="outline" label={t('common.back')} onPress={onBack} style={styles.back} testID="onboarding-back" /> : <View style={styles.backSpace} />}
      <View style={styles.progress} accessible accessibilityRole="text" accessibilityLabel={t('onboarding.step', { n, total })} testID="onboarding-step">
        <InterfaceText variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.step', { n, total })}
        </InterfaceText>
        <View style={styles.bars}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.bar, i < n ? styles.barDone : styles.barTodo]} />
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
