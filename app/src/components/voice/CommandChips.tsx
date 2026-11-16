import { Pressable, StyleSheet, View } from 'react-native';
import type { SpokenCommand } from '@cliffword/engine';
import { tKey, useI18n, type CatalogKey } from '../../i18n';
import { borders, colors, fontFamilies, radii, spacing } from '../../theme';
import { Text } from '../../ui';
import { CHROME_MAX_SCALE } from '../words/fontScale';

/** Catalog keys per command: what to say (target language, pair.ui first) and its gloss. */
export const COMMAND_TEXT: Readonly<Record<SpokenCommand, { say: CatalogKey; gloss: CatalogKey }>> = {
  again: { say: tKey('command.again.say'), gloss: tKey('command.again.gloss') },
  slower: { say: tKey('command.slower.say'), gloss: tKey('command.slower.gloss') },
  dont_know: { say: tKey('command.dontKnow.say'), gloss: tKey('command.dontKnow.gloss') },
  next: { say: tKey('command.next.say'), gloss: tKey('command.next.gloss') },
  done: { say: tKey('command.done.say'), gloss: tKey('command.done.gloss') },
  meaning: { say: tKey('command.meaning.say'), gloss: tKey('command.meaning.gloss') },
};

export interface CommandChipsProps {
  /** The commands to show, in order (the previews show three). */
  commands: readonly SpokenCommand[];
  onCommand: (command: SpokenCommand) => void;
  /** Show the "Or just say" label above the chips. */
  label?: boolean;
  testID?: string;
}

/**
 * "Or just say": the spoken commands as buttons, each with the phrase to say and its meaning
 * ("Otra vez / again"). Tapping one does what saying it does.
 */
export function CommandChips({ commands, onCommand, label = true, testID = 'command-chips' }: CommandChipsProps) {
  const { t } = useI18n();
  return (
    <View style={styles.box} testID={testID}>
      {label ? (
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('commands.orJustSay')}
        </Text>
      ) : null}
      <View style={styles.row}>
        {commands.map((command) => {
          const say = t(COMMAND_TEXT[command].say);
          const gloss = t(COMMAND_TEXT[command].gloss);
          return (
            <Pressable
              key={command}
              accessibilityRole="button"
              accessibilityLabel={t('command.chipLabel', { say, gloss })}
              testID={`command-${command}`}
              onPress={() => onCommand(command)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
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
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: borders.hairline,
    borderColor: colors.border,
    borderRadius: radii.panel,
  },
  pressed: { backgroundColor: colors.borderSoft },
  say: { fontFamily: fontFamilies.interfaceSemiBold, fontSize: 15, lineHeight: 19, textAlign: 'center', color: colors.ink },
});
