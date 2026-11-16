import { Pressable, StyleSheet, View } from 'react-native';
import type { SpokenCommand } from '@cliffword/engine';
import { COMMAND_TEXT } from '../../components/voice/CommandChips';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';

export interface CommandPracticeProps {
  commands: readonly SpokenCommand[];
  /** The ones already said (ticked). */
  practised: readonly SpokenCommand[];
  /** Tap: hear the command said by the story voice. */
  onHear: (command: SpokenCommand) => void;
  testID?: string;
}

/**
 * The six spoken commands as a 3 x 2 grid: what to say (pair.ui first) and what it does, ticked
 * once the learner has said it. Tapping one plays it.
 */
export function CommandPractice({ commands, practised, onHear, testID = 'command-practice' }: CommandPracticeProps) {
  const { t } = useI18n();
  return (
    <View style={styles.grid} testID={testID}>
      {commands.map((command) => {
        const say = t(COMMAND_TEXT[command].say);
        const gloss = t(COMMAND_TEXT[command].gloss);
        const done = practised.includes(command);
        return (
          <Pressable
            key={command}
            accessibilityRole="button"
            accessibilityLabel={done ? t('onboarding.practice.itemDone', { say, gloss }) : t('onboarding.practice.item', { say, gloss })}
            accessibilityHint={t('onboarding.practice.itemHint')}
            onPress={() => onHear(command)}
            testID={`practice-${command}`}
            style={({ pressed }) => [styles.item, done && styles.itemDone, pressed && styles.pressed]}
          >
            {done ? (
              <View style={styles.tick} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.tickMark} />
              </View>
            ) : null}
            <Text style={styles.say} numberOfLines={2} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {say}
            </Text>
            <Text variant="gloss" tone="muted" numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {gloss}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.card,
  },
  itemDone: { borderColor: colors.ink, borderWidth: borders.strong },
  pressed: { backgroundColor: colors.borderSoft },
  say: { fontFamily: fontFamilies.contentSemiBold, fontSize: 16, lineHeight: 20, textAlign: 'center', color: colors.ink },
  tick: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  tickMark: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.onInk },
});
