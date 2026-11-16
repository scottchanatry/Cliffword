import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { SPEECH_RATE_BIAS_LIMIT } from '../../storage/repos/settings';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';

/** One press changes the speech rate bias by this much (10 % of the voice's normal rate). */
export const RATE_STEP = 0.1;

/** The bias one step slower or faster, kept inside the stored range and on the 0.1 grid. */
export function stepRate(bias: number, direction: -1 | 1): number {
  const next = Math.round((bias + direction * RATE_STEP) * 10) / 10;
  return Math.max(-SPEECH_RATE_BIAS_LIMIT, Math.min(SPEECH_RATE_BIAS_LIMIT, next));
}

/** The rate as a percentage of the voice's normal speed (bias 0 is 100 %). */
export function ratePercent(bias: number): number {
  return Math.round((1 + bias) * 100);
}

export interface RateStepperProps {
  /** settings.speechRateBias, -0.5 to 0.5. */
  bias: number;
  onChange: (bias: number) => void;
  testID?: string;
}

/** "Slower  100 %  Faster": the story voice's speed, in 10 % steps from 50 % to 150 %. */
export function RateStepper({ bias, onChange, testID = 'rate-stepper' }: RateStepperProps) {
  const { t } = useI18n();
  const percent = ratePercent(bias);
  const atMin = bias <= -SPEECH_RATE_BIAS_LIMIT + 1e-9;
  const atMax = bias >= SPEECH_RATE_BIAS_LIMIT - 1e-9;
  const value = t('settings.speechRate.value', { percent });
  return (
    <View style={styles.row} testID={testID}>
      <StepButton label={t('settings.speechRate.slower')} glyph="−" disabled={atMin} onPress={() => onChange(stepRate(bias, -1))} testID={`${testID}-slower`} />
      <Text
        variant="contentTitle"
        style={styles.value}
        accessibilityLabel={t('settings.speechRate.a11y', { value })}
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        testID={`${testID}-value`}
      >
        {value}
      </Text>
      <StepButton label={t('settings.speechRate.faster')} glyph="+" disabled={atMax} onPress={() => onChange(stepRate(bias, 1))} testID={`${testID}-faster`} />
    </View>
  );
}

function StepButton({ label, glyph, disabled, onPress, testID }: { label: string; glyph: string; disabled: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.step, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text variant="cardTitle" accessibilityElementsHidden importantForAccessibility="no" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {glyph}
      </Text>
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  value: { flex: 1, textAlign: 'center' },
  step: {
    minWidth: 88,
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.panel,
    borderWidth: borders.hairline,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.borderSoft },
  disabled: { opacity: 0.4 },
});
