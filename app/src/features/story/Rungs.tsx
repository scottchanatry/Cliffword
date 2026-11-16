import { Pressable, StyleSheet, View } from 'react-native';
import type { CliffOption, CliffPrompt } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type Translator } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';
import { Text } from '../../ui';

/**
 * The line under "Say what comes next" for the cliff's rung: options "Pick the one that
 * fits.", hint "It starts with “le”." (both the engine's UiText), free "Any natural answer
 * counts. One to three words, out loud." (longer for a multi-word cliff).
 */
export function rungLine(t: Translator['t'], plural: Translator['plural'], cliff: CliffPrompt): string {
  if (cliff.rung === 'free') return t('cliff.freeLine', { anyAnswer: t('cliff.anyAnswer'), wordsOut: plural('cliff.wordsOut', cliff.length) });
  return t(cliff.ui.key, cliff.ui.params);
}

export interface OptionsRungProps {
  options: readonly CliffOption[];
  onPick: (index: number) => void;
  /** The option being read aloud, lit while it plays. */
  speakingOption?: number | null;
}

/** Two or three spoken options as buttons (tap one, or say it). */
export function OptionsRung({ options, onPick, speakingOption = null }: OptionsRungProps) {
  const { t } = useI18n();
  return (
    <View style={styles.options} testID="cliff-options">
      {options.map((o) => (
        <Pressable
          key={o.index}
          accessibilityRole="button"
          accessibilityLabel={o.text}
          accessibilityHint={t('cliff.option.hint')}
          testID={`option-${o.index}`}
          onPress={() => onPick(o.index)}
          style={({ pressed }) => [styles.option, speakingOption === o.index && styles.lit, pressed && styles.pressed]}
        >
          <Text variant="prompt" style={styles.optionText} numberOfLines={2} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {o.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The hint rung: the first sound of the answer, large. */
export function HintRung({ hint }: { hint: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.hint} testID="cliff-hint" accessible accessibilityLabel={t('cliff.hint', { sound: hint })}>
      <Text variant="headline" tone="accent" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {hint}
      </Text>
      <View style={styles.hintDots}>
        <View style={styles.hintDot} />
        <View style={styles.hintDot} />
        <View style={styles.hintDot} />
      </View>
    </View>
  );
}

/** "You can answer in English": answers in the native language get the target words to repeat. */
export function NativeAllowedChip() {
  const { t } = useI18n();
  return (
    <View style={styles.native} testID="native-allowed">
      <Text variant="caption" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('cliff.answerInEnglish')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    flexGrow: 1,
    minHeight: 52,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.card,
  },
  lit: { borderColor: colors.live, borderWidth: borders.strong, backgroundColor: colors.heat1 },
  pressed: { backgroundColor: colors.borderSoft },
  optionText: { textAlign: 'center' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  hintDots: { flexDirection: 'row', gap: 4, paddingTop: 8 },
  hintDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live },
  native: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.heat1,
  },
});
