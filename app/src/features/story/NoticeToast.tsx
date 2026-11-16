import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { UiText } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, layout, radii, spacing } from '../../theme';
import { Text } from '../../ui';

/** A notice dismisses itself after this long. */
export const NOTICE_MS = 6000;

/** A non-fatal problem shown once (TTS unavailable, ...): a small ink toast; tap or wait to dismiss. */
export function NoticeToast({ notice, onDismiss }: { notice: UiText | null; onDismiss: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(notice.key, notice.params)}
        accessibilityHint={t('notice.dismissHint')}
        accessibilityLiveRegion="polite"
        onPress={onDismiss}
        testID="story-notice"
        style={styles.toast}
      >
        <Text variant="body" tone="onInk" style={styles.text} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(notice.key, notice.params)}
        </Text>
        <Text variant="caption" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('common.close')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: spacing.sm },
  toast: {
    minHeight: layout.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.panel,
    backgroundColor: colors.ink,
  },
  text: { flex: 1 },
});
