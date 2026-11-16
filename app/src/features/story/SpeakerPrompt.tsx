import { Pressable, StyleSheet, View } from 'react-native';
import { CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, layout, spacing } from '../../theme';
import { Text } from '../../ui';

export interface SpeakerPromptProps {
  /** The line to hear (target language). */
  line: string;
  /** Plays it again. */
  onPlay: () => void;
  /** Spoken label of the play button: "Play Marta's question". */
  playLabel: string;
  /** Larger line for an answer to repeat. */
  large?: boolean;
  testID?: string;
}

/** A round ink play button and the line it plays (A2: "¿Y tú? ¿Qué hiciste ayer?"). */
export function SpeakerPrompt({ line, onPlay, playLabel, large = false, testID = 'speaker-prompt' }: SpeakerPromptProps) {
  return (
    <View style={styles.row} testID={testID}>
      <PlayButton label={playLabel} onPress={onPlay} />
      <Text variant={large ? 'headline' : 'prompt'} style={styles.line} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {line}
      </Text>
    </View>
  );
}

/** A 44 dp ink circle with a play triangle. */
export function PlayButton({ label, onPress, testID = 'play' }: { label: string; onPress: () => void; testID?: string }) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('play.hint')}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.play, pressed && styles.pressed]}
    >
      <View style={styles.triangle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { flex: 1 },
  play: {
    width: layout.minTouch,
    height: layout.minTouch,
    minHeight: layout.minTouch,
    borderRadius: layout.minTouch / 2,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  triangle: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.onInk,
  },
});
