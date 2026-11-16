import { StyleSheet, View } from 'react-native';
import type { SpokenCommand } from '@cliffword/engine';
import { CommandChips } from '../../components/voice/CommandChips';
import { HoldArea } from '../../components/voice/HoldArea';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import type { ListenState } from '../../session/contract';
import { spacing } from '../../theme';
import { Button, Text } from '../../ui';

export interface VoiceDockProps {
  title: string;
  subtitle: string;
  listen: ListenState;
  onToggle: () => void;
  commands: readonly SpokenCommand[];
  onCommand: (command: SpokenCommand) => void;
  /** Opens the "Type instead" sheet. */
  onType: () => void;
  /** 190 (B1) or 150 (B2). */
  height?: number;
  ringsWidth?: number;
}

/**
 * The bottom of a Voice screen (B1, B2): the hold area, then "Or just say" with the command
 * chips, and "Type instead" for when speaking is not possible.
 */
export function VoiceDock({ title, subtitle, listen, onToggle, commands, onCommand, onType, height, ringsWidth }: VoiceDockProps) {
  const { t } = useI18n();
  return (
    <View style={styles.dock} testID="voice-dock">
      <HoldArea title={title} subtitle={subtitle} listen={listen} onToggle={onToggle} height={height} ringsWidth={ringsWidth} />
      <View style={styles.labelRow}>
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('commands.orJustSay')}
        </Text>
        <Button variant="ghost" muted label={t('action.typeInstead')} onPress={onType} testID="type-instead" style={styles.type} />
      </View>
      <CommandChips commands={commands} onCommand={onCommand} label={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  type: { marginRight: -spacing.sm },
});
