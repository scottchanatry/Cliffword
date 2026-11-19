import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { ContentText, InterfaceText } from '../../ui';

export interface ChoiceCardProps {
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** A sample in the target language, shown as a quote (content, not interface text). */
  sample?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Drawn left of the text (decorative). */
  icon?: ReactNode;
  testID?: string;
}

/**
 * A big tappable answer card for onboarding's questions ("Brand new", "As a woman"): one tap
 * chooses and moves on. A radio for screen readers, with its state.
 */
export function ChoiceCard({ title, subtitle, sample, selected = false, disabled = false, onPress, icon, testID }: ChoiceCardProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[title, subtitle, sample].filter(Boolean).join('. ')}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.card, selected && styles.selected, pressed && !disabled && styles.pressed]}
    >
      {icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      ) : null}
      <View style={styles.text}>
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </InterfaceText>
        {subtitle ? (
          <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {subtitle}
          </InterfaceText>
        ) : null}
        {sample ? (
          <ContentText variant="prompt" style={styles.sample} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {sample}
          </ContentText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: layout.primaryHeight + 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.card,
    borderWidth: borders.strong,
    borderColor: colors.card,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.ink },
  pressed: { backgroundColor: colors.borderSoft },
  text: { flex: 1, gap: spacing.xs },
  sample: { color: colors.accentText, paddingTop: spacing.xs },
});
