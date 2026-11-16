import { Pressable, StyleSheet, View } from 'react-native';
import type { Register } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { InterfaceText } from '../../ui';

const CHOICES: readonly { value: Register; title: CatalogKey; hint: CatalogKey }[] = [
  { value: 'neutral', title: tKey('register.neutral.label'), hint: tKey('onboarding.slang.neutral.hint') },
  { value: 'street', title: tKey('onboarding.slang.street'), hint: tKey('onboarding.slang.street.hint') },
];

export interface RegisterChoiceProps {
  value: Register;
  onChange: (register: Register) => void;
}

/** Neutral or street: two cards, a radio group for screen readers. */
export function RegisterChoice({ value, onChange }: RegisterChoiceProps) {
  const { t } = useI18n();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.register')} style={styles.list} testID="register-choice">
      {CHOICES.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={t(choice.title)}
            accessibilityHint={t(choice.hint)}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(choice.value)}
            testID={`register-${choice.value}`}
            style={({ pressed }) => [styles.card, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <View style={[styles.radio, selected && styles.radioOn]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {selected ? <View style={styles.dot} /> : null}
            </View>
            <View style={styles.text}>
              <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t(choice.title)}
              </InterfaceText>
              <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t(choice.hint)}
              </InterfaceText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const RADIO = 22;

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: {
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.list,
    borderWidth: borders.strong,
    borderColor: colors.card,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.ink },
  pressed: { backgroundColor: colors.borderSoft },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: RADIO / 2,
    borderWidth: borders.strong,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.ink },
  dot: { width: RADIO / 2, height: RADIO / 2, borderRadius: RADIO / 4, backgroundColor: colors.ink },
  text: { flex: 1, gap: spacing.xxs },
});
