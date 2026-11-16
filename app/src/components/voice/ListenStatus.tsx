import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { spacing } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../words/fontScale';

/**
 * What the microphone is doing, in words: the live transcript while listening, "One moment"
 * while the answer is finished, the speech-in error (an i18n key) after a failure. Nothing
 * when idle. Announced politely to screen readers.
 */
export function ListenStatus({ listen, testID = 'listen-status' }: { listen: ListenState; testID?: string }) {
  const { t } = useI18n();
  if (listen.phase === 'idle') return null;
  let line: string;
  let content = false;
  let tone: 'ink' | 'muted' | 'accent' = 'muted';
  if (listen.phase === 'warming') line = t('hold.listening');
  else if (listen.phase === 'listening') {
    content = listen.partial.trim().length > 0;
    line = content ? listen.partial : t('hold.listening');
    tone = content ? 'ink' : 'accent';
  } else if (listen.phase === 'finishing') line = t('hold.finishing');
  else {
    line = t(listen.messageKey);
    tone = 'accent';
  }
  return (
    <View style={styles.box} testID={testID} accessibilityLiveRegion="polite">
      <Text
        variant={content ? 'prompt' : 'hint'}
        tone={tone}
        numberOfLines={3}
        maxFontSizeMultiplier={content ? CONTENT_MAX_SCALE : CHROME_MAX_SCALE}
        style={styles.center}
      >
        {line}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: spacing.sm },
  center: { textAlign: 'center' },
});
