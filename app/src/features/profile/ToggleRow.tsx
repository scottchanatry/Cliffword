import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { borders, colors, layout, radii, spacing } from '../../theme';
import { InterfaceText } from '../../ui';

export interface ToggleRowProps {
  /** Translated row title; also the switch's accessible name. */
  title: string;
  /** A line under the title (what on and off mean). */
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
  testID?: string;
}

/**
 * A settings row that is one switch: the whole row (at least 56 dp) toggles, and screen readers
 * hear a switch with its title and state. The track is drawn here, so it looks the same on iOS,
 * Android and the web.
 */
export function ToggleRow({ title, hint, value, onChange, disabled = false, divider, testID }: ToggleRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      testID={testID}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {title}
        </InterfaceText>
        {hint ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={testID ? `${testID}-hint` : undefined}>
            {hint}
          </InterfaceText>
        ) : null}
      </View>
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const TRACK_W = 46;
const TRACK_H = 28;
const KNOB = 22;

const styles = StyleSheet.create({
  row: {
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: borders.hairline, borderBottomColor: colors.borderSoft },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  text: { flex: 1, gap: spacing.xxs },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: radii.pill,
    justifyContent: 'center',
    paddingHorizontal: (TRACK_H - KNOB) / 2,
  },
  trackOn: { backgroundColor: colors.ink },
  trackOff: { backgroundColor: colors.track },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.card },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
});
