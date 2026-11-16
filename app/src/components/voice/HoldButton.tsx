import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { colors, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE } from '../words/fontScale';
import { MicGlyph } from './MicGlyph';
import { isListening } from './useListenToggle';

const TAP_HINT_MS = 2500;

export interface HoldButtonProps {
  /** "Hold to speak", "Say it again". */
  label: string;
  listen: ListenState;
  /** Starts or stops listening: the screen-reader activate action. */
  onToggle: () => void;
  testID?: string;
}

/**
 * The ink "Hold to speak" button of the Ink look (Main, A2). Holding it is holding anywhere
 * (the root gesture); a quick tap shows how to hold. While listening it turns live orange.
 * For screen readers its activate action toggles listening.
 */
export function HoldButton({ label, listen, onToggle, testID = 'hold-button' }: HoldButtonProps) {
  const { t } = useI18n();
  const [tapHint, setTapHint] = useState(false);
  useEffect(() => {
    if (!tapHint) return;
    const timer = setTimeout(() => setTapHint(false), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [tapHint]);
  const on = isListening(listen);
  const shown = on ? t('hold.listening') : listen.phase === 'finishing' ? t('hold.finishing') : label;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? t('hold.a11y.stop') : label}
        accessibilityHint={on ? undefined : t('action.holdToSpeak.hint')}
        accessibilityState={{ busy: listen.phase === 'finishing' }}
        accessibilityActions={[{ name: 'activate', label: on ? t('hold.a11y.stop') : t('hold.a11y.start') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onToggle();
        }}
        onPress={() => setTapHint(true)}
        testID={testID}
        style={({ pressed }) => [styles.button, on && styles.live, pressed && !on && styles.pressed]}
      >
        <MicGlyph color={on ? colors.ink : colors.onInk} />
        <Text variant="buttonPrimary" tone={on ? 'ink' : 'onInk'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {shown}
        </Text>
      </Pressable>
      {tapHint && !on ? (
        <Text variant="caption" tone="muted" style={styles.hint} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('action.holdToSpeak.hint')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  button: {
    minHeight: layout.primaryHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
  },
  live: { backgroundColor: colors.live },
  pressed: { opacity: 0.85 },
  hint: { textAlign: 'center' },
});
