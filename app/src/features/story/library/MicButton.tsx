import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ListeningRings } from '../../../components/voice/ListeningRings';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { useI18n } from '../../../i18n';
import type { ListenState, StoryActions } from '../../../session/contract';
import { colors, layout, radii, spacing } from '../../../theme';
import { ContentText, InterfaceText, QuietLink } from '../../../ui';

/** Press longer than this and it is push-to-talk (release sends). */
const HOLD_DELAY_MS = 350;
const SIZE = 84;

export interface MicButtonProps {
  listen: ListenState;
  /** Tap mode is on (a tap started listening; it stops by itself or on the next tap). */
  latched: boolean;
  actions: Pick<StoryActions, 'micTap' | 'holdBegin' | 'holdStart' | 'holdEnd' | 'holdCancel'>;
  /** "Type instead" opens the typing sheet; absent: no link. */
  onType?: () => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * The one big round microphone at the bottom center. A quick tap starts listening and a second
 * tap stops it (it also stops after about 1.5 s of silence); press and hold is push-to-talk,
 * release to send. While listening the rings follow the voice and the partial transcript shows
 * above it. For screen readers it is one button whose double tap starts and stops listening.
 */
export function MicButton({ listen, latched, actions, onType, disabled = false, testID = 'mic-button' }: MicButtonProps) {
  const { t } = useI18n();
  const holding = useRef(false);
  const on = listen.phase === 'warming' || listen.phase === 'listening';
  const finishing = listen.phase === 'finishing';
  const partial = listen.phase === 'listening' ? listen.partial.trim() : '';
  const label = on ? (latched ? t('mic.listeningTap') : t('mic.holding')) : finishing ? t('hold.finishing') : t('mic.tap');

  return (
    <View style={styles.dock} testID={`${testID}-dock`}>
      <View style={styles.partialRow} accessibilityLiveRegion="polite">
        {partial ? (
          <ContentText variant="prompt" style={styles.partial} numberOfLines={2} maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID={`${testID}-partial`}>
            {partial}
          </ContentText>
        ) : null}
      </View>
      <View style={styles.ringBox}>
        <View style={styles.rings} pointerEvents="none">
          <ListeningRings level={listen.phase === 'listening' ? listen.level : 0} active={listen.phase === 'listening'} width={176} stroke={3} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={on ? t('mic.a11y.stop') : t('mic.a11y.start')}
          accessibilityHint={on ? undefined : t('mic.a11y.hint')}
          accessibilityState={{ disabled, busy: finishing, selected: on }}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'activate' && !disabled) actions.micTap();
          }}
          disabled={disabled || finishing}
          delayLongPress={HOLD_DELAY_MS}
          onPress={() => {
            if (!holding.current) actions.micTap();
          }}
          onLongPress={() => {
            if (on) return;
            holding.current = true;
            actions.holdBegin();
            actions.holdStart();
          }}
          onPressOut={() => {
            if (!holding.current) return;
            holding.current = false;
            actions.holdEnd();
          }}
          testID={testID}
          style={({ pressed }) => [styles.button, on && styles.live, pressed && !on && styles.pressed, (disabled || finishing) && styles.disabled]}
        >
          <BigMic color={on ? colors.ink : colors.onInk} />
        </Pressable>
      </View>
      <InterfaceText variant="bodyStrong" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-label`}>
        {label}
      </InterfaceText>
      {listen.phase === 'error' ? (
        <InterfaceText variant="caption" tone="accent" style={styles.center} accessibilityRole="alert" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-error`}>
          {t(listen.messageKey)}
        </InterfaceText>
      ) : !on ? (
        <InterfaceText variant="caption" tone="muted" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('mic.orHold')}
        </InterfaceText>
      ) : null}
      {onType ? <QuietLink role="button" label={t('action.typeInstead')} onPress={onType} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID={`${testID}-type`} /> : null}
    </View>
  );
}

/** A large microphone drawn with views (decorative). */
function BigMic({ color }: { color: string }) {
  return (
    <View style={styles.mic} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.head, { borderColor: color }]} />
      <View style={[styles.cup, { borderColor: color }]} />
      <View style={[styles.stand, { backgroundColor: color }]} />
      <View style={[styles.base, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { alignItems: 'center', gap: spacing.xs },
  partialRow: { minHeight: 28, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end' },
  partial: { color: colors.accentText, textAlign: 'center' },
  ringBox: { width: SIZE + 40, height: SIZE + 16, alignItems: 'center', justifyContent: 'center' },
  rings: { position: 'absolute', bottom: SIZE / 2 + 8, alignItems: 'center' },
  button: {
    width: SIZE,
    height: SIZE,
    minWidth: layout.minTouch,
    minHeight: layout.minTouch,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  live: { backgroundColor: colors.live },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  center: { textAlign: 'center' },
  mic: { alignItems: 'center', width: 34, height: 40 },
  head: { width: 14, height: 22, borderRadius: 7, borderWidth: 3 },
  cup: { position: 'absolute', top: 11, width: 26, height: 17, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, borderLeftWidth: 3, borderRightWidth: 3, borderBottomWidth: 3 },
  stand: { width: 3, height: 7, marginTop: 6 },
  base: { width: 14, height: 3, borderRadius: 2 },
});
