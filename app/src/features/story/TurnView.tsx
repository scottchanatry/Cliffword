import { StyleSheet, View } from 'react-native';
import type { StoryScreen } from '@cliffword/engine';
import { HoldButton } from '../../components/voice/HoldButton';
import { ListenStatus } from '../../components/voice/ListenStatus';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { HeatLegend, HeatSentence } from '../../components/words/HeatSentence';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, InterfaceText, Text } from '../../ui';
import { SpeakerPrompt } from './SpeakerPrompt';
import { MetaRow, SpokenTodayChip } from './StoryHeader';
import type { KindViewProps } from './types';
import { UpNextCard } from './UpNextView';
import { VoiceDock } from './VoiceDock';

/** "Marta asks you": a character's question for the learner to answer aloud. */
export function TurnView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'turn'>) {
  const { t } = useI18n();
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={t(screen.ui.key, screen.ui.params)} eyebrow busy={vm.busy} right={<SpokenTodayChip ms={vm.spokenTodayMs} />} />
      <SpeakerPrompt line={screen.prompt.line} onPlay={actions.replay} playLabel={t('turn.play', { speaker: screen.prompt.speaker })} />
      {screen.native ? <NativeNote native={screen.native} /> : null}
      <View style={styles.spacer} />
      <VoiceDock
        title={t('hold.answer')}
        subtitle={t('turn.subtitle')}
        listen={vm.listen}
        onToggle={toggleListen}
        commands={['again', 'slower', 'dont_know']}
        onCommand={(c) => actions.command(c)}
        onType={openTyping}
      />
    </>
  );
}

/** The learner's turn after an answer (A2): what they said with surprise shading, and the repair card. */
export function RepairView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'repair'>) {
  const { t } = useI18n();
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'}
        text={t('story.asks', { speaker: screen.prompt.speaker })}
        eyebrow
        busy={vm.busy}
        right={<SpokenTodayChip ms={vm.spokenTodayMs} />}
      />
      <SpeakerPrompt line={screen.prompt.line} onPlay={actions.replay} playLabel={t('turn.play', { speaker: screen.prompt.speaker })} />
      <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('repair.youSaid')}
      </Text>
      {screen.said.length > 0 ? <HeatSentence said={screen.said} highlight={screen.highlight} /> : null}
      {screen.said.length > 0 ? <HeatLegend /> : null}
      {screen.native ? <NativeNote native={screen.native} /> : null}
      <RepairCard screen={screen} vm={vm} actions={actions} toggleListen={toggleListen} openTyping={openTyping} />
      <View style={styles.spacer} />
      <UpNextCard />
    </>
  );
}

/**
 * The repair card by phase. hinted: only "Expected: ..." (no fix wording, no explanation).
 * prompt_repair: "One word surprised me", Say it again / Show me the answer. show_answer: the
 * fix and the rule's explanation, then say it again. ok / repaired: on to what comes next.
 */
export function RepairCard({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'repair'>) {
  const { t, plural } = useI18n();
  const ui = screen.ui ? t(screen.ui.key, screen.ui.params) : null;
  const next = <Button variant="outline" label={t('command.next.say')} accessibilityLabel={t('story.continue')} onPress={actions.next} testID="repair-next" />;
  const sayAgain = <HoldButton label={t('action.sayAgain')} listen={vm.listen} onToggle={toggleListen} testID="repair-say-again" />;
  const typeLink = <Button variant="ghost" muted label={t('action.typeInstead')} onPress={openTyping} testID="type-instead" />;
  const attempts =
    screen.attempts > 0 ? (
      <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="repair-attempts">
        {plural('repair.attempts', screen.attempts)}
      </Text>
    ) : null;
  switch (screen.phase) {
    case 'prompt_repair':
      return (
        <Card testID="repair-card">
          <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {plural('repair.surprised', 1)}
          </InterfaceText>
          <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="repair-body">
            {t('repair.tryAgain')}
          </InterfaceText>
          <ListenStatus listen={vm.listen} />
          {sayAgain}
          <Button variant="outline" label={t('action.showAnswer')} onPress={() => actions.command('dont_know')} testID="repair-show-answer" />
        </Card>
      );
    case 'hinted':
      return (
        <Card testID="repair-card">
          <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('repair.closeTitle')}
          </InterfaceText>
          {ui ? (
            <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="repair-expected">
              {ui}
            </Text>
          ) : null}
          {next}
        </Card>
      );
    case 'show_answer':
      return (
        <Card testID="repair-card">
          <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('repair.answerTitle')}
          </InterfaceText>
          {ui ? (
            <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="repair-fix">
              {ui}
            </Text>
          ) : null}
          {screen.explanation ? (
            <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="repair-explanation">
              {screen.explanation}
            </InterfaceText>
          ) : null}
          {attempts}
          <ListenStatus listen={vm.listen} />
          {sayAgain}
          <View style={styles.row}>
            {typeLink}
            {next}
          </View>
        </Card>
      );
    case 'ok':
    case 'repaired':
      return (
        <Card testID="repair-card">
          <InterfaceText variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {screen.phase === 'ok' ? t('repair.ok') : t('repair.repaired')}
          </InterfaceText>
          {attempts}
          {next}
        </Card>
      );
    default:
      return (
        <Card testID="repair-card">
          <ListenStatus listen={vm.listen} />
          {sayAgain}
          {typeLink}
        </Card>
      );
  }
}

/** "You said “tired” in English. Say: cansado" on a learner turn. */
function NativeNote({ native }: { native: NonNullable<Extract<StoryScreen, { kind: 'turn' }>['native']> }) {
  const { t } = useI18n();
  return (
    <Card tone="soft" testID="turn-native">
      <Text variant="hint" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('native.heard', { heard: native.heard })}
      </Text>
      {native.target ? (
        <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {native.target}
        </Text>
      ) : (
        <Text variant="hint" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('native.noTarget')}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
});
