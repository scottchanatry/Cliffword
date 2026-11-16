import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';

/** Regions whose street speech the Caribbean pack covers (the toggle then says "Caribbean street"). */
const CARIBBEAN = new Set(['PR', 'DO', 'CU', 'CARIB']);

export interface RegisterToggleProps {
  register: 'neutral' | 'street';
  onChange: (register: 'neutral' | 'street') => void;
  /** settings.regions: names the street side ("Caribbean street" when every region is Caribbean). */
  regions?: readonly string[];
  testID?: string;
}

/** "Teach me to speak": Neutral | Caribbean street, two toggle buttons bound to the song's register (A3). */
export function RegisterToggle({ register, onChange, regions, testID = 'register-toggle' }: RegisterToggleProps) {
  const { t } = useI18n();
  const caribbean = !regions || regions.length === 0 || regions.every((r) => CARIBBEAN.has(r));
  const options = [
    { value: 'neutral' as const, label: t('slang.neutral') },
    { value: 'street' as const, label: caribbean ? t('register.caribbeanStreet') : t('slang.street') },
  ];
  return (
    <View style={styles.box} testID={testID}>
      <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('register.teachMe')}
      </Text>
      <View style={styles.row}>
        {options.map(({ value, label }) => {
          const on = register === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="togglebutton"
              accessibilityState={{ checked: on }}
              accessibilityLabel={label}
              onPress={() => {
                if (!on) onChange(value);
              }}
              testID={`register-${value}`}
              style={({ pressed }) => [styles.option, on ? styles.on : styles.off, pressed && !on && styles.pressed]}
            >
              <Text style={[styles.label, on && styles.labelOn]} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  option: { flex: 1, minHeight: layout.minTouch, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.control },
  off: { borderWidth: borders.hairline, borderColor: colors.border },
  on: { backgroundColor: colors.ink },
  pressed: { backgroundColor: colors.borderSoft },
  label: { fontFamily: fontFamilies.interfaceMedium, fontSize: 15, lineHeight: 20, color: colors.ink, textAlign: 'center' },
  labelOn: { fontFamily: fontFamilies.interfaceSemiBold, color: colors.onInk },
});
