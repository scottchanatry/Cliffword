import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { borders, colors, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../words/fontScale';
import { ListeningRings } from './ListeningRings';
import { isListening } from './useListenToggle';

/** How long the "keep holding" reminder shows after a quick tap. */
const TAP_HINT_MS = 2500;

export interface HoldAreaProps {
  /** "Hold anywhere and say it". */
  title: string;
  /** "What comes next? Any natural answer counts." */
  subtitle: string;
  listen: ListenState;
  /** Starts or stops listening (useListenToggle): the screen-reader activate action. */
  onToggle: () => void;
  /** 190 on a cliff (B1), 150 on a landing (B2). */
  height?: number;
  /** Rings width: 120 (B1) or 96 (B2). */
  ringsWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The dashed white area of the Voice look: rings, a title and a subtitle. The hold itself is
 * the screen's root gesture (HoldAnywhere), so this area only shows where to hold and what
 * is heard. A quick tap reminds the learner to hold. For screen readers it is a button
 * whose activate action toggles listening.
 */
export function HoldArea({ title, subtitle, listen, onToggle, height = 190, ringsWidth = 120, style, testID = 'hold-area' }: HoldAreaProps) {
  const { t } = useI18n();
  const [tapHint, setTapHint] = useState(false);
  useEffect(() => {
    if (!tapHint) return;
    const timer = setTimeout(() => setTapHint(false), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [tapHint]);

  const on = isListening(listen);
  const partial = listen.phase === 'listening' ? listen.partial.trim() : '';
  let shownTitle = title;
  let shownSubtitle = tapHint ? t('action.holdToSpeak.hint') : subtitle;
  if (on) {
    shownTitle = partial || t('hold.listening');
    shownSubtitle = t('hold.letGo');
  } else if (listen.phase === 'finishing') {
    shownSubtitle = t('hold.finishing');
  } else if (listen.phase === 'error') {
    shownSubtitle = t(listen.messageKey);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? t('hold.a11y.stop') : title}
      accessibilityHint={on ? undefined : t('hold.a11y.hint')}
      accessibilityState={{ busy: listen.phase === 'finishing' }}
      accessibilityActions={[{ name: 'activate', label: on ? t('hold.a11y.stop') : t('hold.a11y.start') }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') onToggle();
      }}
      onPress={() => setTapHint(true)}
      testID={testID}
      style={[styles.area, { minHeight: height }, on && styles.areaLive, style]}
    >
      <ListeningRings level={listen.phase === 'listening' ? listen.level : 0} active={on} width={ringsWidth} stroke={ringsWidth < 110 ? 2.5 : 2} />
      <Text
        variant="contentTitle"
        style={[styles.center, ringsWidth < 110 && styles.titleSmall]}
        numberOfLines={3}
        maxFontSizeMultiplier={CONTENT_MAX_SCALE}
        accessibilityLiveRegion={on ? 'polite' : 'none'}
      >
        {shownTitle}
      </Text>
      <Text variant="hint" tone={listen.phase === 'error' ? 'accent' : 'muted'} style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {shownSubtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: borders.hairline,
    borderStyle: 'dashed',
    borderColor: colors.borderDashed,
    borderRadius: radii.holdArea,
    backgroundColor: colors.card,
  },
  areaLive: { borderColor: colors.live },
  center: { textAlign: 'center' },
  titleSmall: { fontSize: 20, lineHeight: 26 },
});
