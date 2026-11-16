import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';

export interface SegmentOption<V extends string> {
  value: V;
  /** Translated label. */
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Translated name of the choice ("Story text"), for screen readers. */
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  testID?: string;
}

/**
 * One choice out of a few, as a row of pills (the selected one in ink). Screen readers hear a
 * radio group with each option a radio button and its checked state; every option is 44 dp tall.
 */
export function SegmentedControl<V extends string>({ label, options, value, onChange, testID }: SegmentedControlProps<V>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row} testID={testID}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            testID={testID ? `${testID}-${option.value}` : undefined}
            style={({ pressed }) => [styles.option, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <Text variant="pill" tone={selected ? 'onInk' : 'ink'} style={styles.center} numberOfLines={2} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs + 2 },
  option: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.control,
    borderWidth: borders.hairline,
    borderColor: colors.border,
  },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  pressed: { backgroundColor: colors.borderSoft },
  center: { textAlign: 'center' },
});
