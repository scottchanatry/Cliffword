import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { isListening } from '../../components/voice/useListenToggle';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { colors, radii, spacing } from '../../theme';
import { Text } from '../../ui';

const TAP_HINT_MS = 2500;

export interface SingItButtonProps {
  /** "Sing it", "Say it street": drawn in Anton, uppercase. */
  label: string;
  listen: ListenState;
  /** Starts or stops listening: the screen-reader activate action. */
  onToggle: () => void;
  /** 68 (C1) or 64 (C2). */
  height?: number;
  testID?: string;
}

/**
 * The big ink "SING IT" button of the Tarima look (C1, C2). Like every hold control, holding
 * it is holding anywhere (the screen's root gesture); a quick tap shows how to hold. While
 * listening it turns live orange and shows what is heard. For screen readers its activate
 * action toggles listening.
 */
export function SingItButton({ label, listen, onToggle, height = 68, testID = 'sing-it' }: SingItButtonProps) {
  const { t } = useI18n();
  const [tapHint, setTapHint] = useState(false);
  useEffect(() => {
    if (!tapHint) return;
    const timer = setTimeout(() => setTapHint(false), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [tapHint]);
  const on = isListening(listen);
  const partial = listen.phase === 'listening' ? listen.partial.trim() : '';
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
        style={({ pressed }) => [styles.button, { height, minHeight: height }, on && styles.live, pressed && !on && styles.pressed]}
      >
        <MicGlyph color={on ? colors.ink : colors.onInk} />
        <Text variant="musicButton" tone={on ? 'ink' : 'onInk'} numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.label}>
          {shown}
        </Text>
      </Pressable>
      {listen.phase === 'error' ? (
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
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.list,
    backgroundColor: colors.ink,
  },
  live: { backgroundColor: colors.live },
  pressed: { opacity: 0.85 },
  label: { flexShrink: 1 },
  hint: { textAlign: 'center' },
});
