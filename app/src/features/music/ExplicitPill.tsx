import { Pressable, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';

export interface ExplicitPillProps {
  /** settings.showExplicit. */
  show: boolean;
  /** Turns explicit lyrics off or on. Without it the pill is a static chip. */
  onToggle?: (show: boolean) => void;
  testID?: string;
}

/** "Explicit · on" (C1): reads the explicit-lyrics setting; a toggle button when it can change it. */
export function ExplicitPill({ show, onToggle, testID = 'explicit-pill' }: ExplicitPillProps) {
  const { t } = useI18n();
  const label = show ? t('music.explicit.pill') : t('music.explicit.pillOff');
  const text = (
    <Text variant="pillStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
      {label}
    </Text>
  );
  if (!onToggle) {
    return (
      <View style={[styles.pill, styles.chip]} testID={testID} accessible accessibilityLabel={label}>
        {text}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="togglebutton"
      accessibilityState={{ checked: show }}
      accessibilityLabel={t('music.explicit.title')}
      accessibilityHint={show ? t('music.explicit.onHint') : t('music.explicit.offHint')}
      onPress={() => onToggle(!show)}
      testID={testID}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      {text}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: layout.minTouch,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
  },
  chip: { minHeight: 0, height: 36 },
  pressed: { backgroundColor: colors.borderSoft },
});
