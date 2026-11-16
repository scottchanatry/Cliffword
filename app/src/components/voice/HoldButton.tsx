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
  /** "Hold to speak", "Say it again", "Sing it". */
  label: string;
  listen: ListenState;
  /** Starts or stops listening: the screen-reader activate action. */
  onToggle: () => void;
  /**
   * ink: the Ink look's button (Main, A2). tarima: the Music tab's big Anton button (C1 "SING
   * IT"), which also shows what is heard while listening and a speech-in error under it.
   */
  look?: 'ink' | 'tarima';
  /** tarima only: the button height, 68 (C1) or 64 (C2). */
  height?: number;
  testID?: string;
}

/**
 * The ink hold button. Holding it is holding anywhere (the screen's root gesture, HoldAnywhere);
 * a quick tap shows how to hold. While listening it turns live orange. For screen readers its
 * activate action toggles listening (they cannot hold anywhere).
 */
export function HoldButton({ label, listen, onToggle, look = 'ink', height = 68, testID = 'hold-button' }: HoldButtonProps) {
  const { t } = useI18n();
  const [tapHint, setTapHint] = useState(false);
  useEffect(() => {
    if (!tapHint) return;
    const timer = setTimeout(() => setTapHint(false), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [tapHint]);

  const tarima = look === 'tarima';
  const on = isListening(listen);
  const partial = tarima && listen.phase === 'listening' ? listen.partial.trim() : '';
  const shown = on ? partial || t('hold.listening') : listen.phase === 'finishing' ? t('hold.finishing') : label;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? t('hold.a11y.stop') : label}
        accessibilityHint={on ? undefined : t('hold.a11y.hint')}
        accessibilityState={{ busy: listen.phase === 'finishing' }}
        accessibilityActions={[{ name: 'activate', label: on ? t('hold.a11y.stop') : t('hold.a11y.start') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onToggle();
        }}
        onPress={() => setTapHint(true)}
        testID={testID}
        style={({ pressed }) => [
          styles.button,
          tarima ? [styles.tarima, { height, minHeight: height }] : styles.ink,
          on && styles.live,
          pressed && !on && styles.pressed,
        ]}
      >
        <MicGlyph color={on ? colors.ink : colors.onInk} />
        <Text
          variant={tarima ? 'musicButton' : 'buttonPrimary'}
          tone={on ? 'ink' : 'onInk'}
          numberOfLines={tarima ? 1 : undefined}
          maxFontSizeMultiplier={CHROME_MAX_SCALE}
          style={tarima ? styles.tarimaLabel : undefined}
        >
          {shown}
        </Text>
      </Pressable>
      {tarima && listen.phase === 'error' ? (
        <Text variant="caption" tone="accent" style={styles.hint} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-error`}>
          {t(listen.messageKey)}
        </Text>
      ) : tapHint && !on ? (
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.ink,
  },
  ink: { minHeight: layout.primaryHeight, gap: spacing.sm + 2, borderRadius: radii.button },
  tarima: { gap: spacing.md, borderRadius: radii.list },
  tarimaLabel: { flexShrink: 1 },
  live: { backgroundColor: colors.live },
  pressed: { opacity: 0.85 },
  hint: { textAlign: 'center' },
});
