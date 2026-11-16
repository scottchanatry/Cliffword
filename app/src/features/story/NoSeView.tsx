import { StyleSheet, View } from 'react-native';
import type { NoSeStep } from '@cliffword/engine';
import { answerSpan } from '../../components/words/answerSpan';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { UnderstoodLine } from '../../components/words/UnderstoodLine';
import { WordFlow } from '../../components/words/WordFlow';
import { useI18n, type CatalogKey } from '../../i18n';
import { useServices } from '../../services/ServicesProvider';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { lookOf } from './CliffView';
import { SpeakerPrompt } from './SpeakerPrompt';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';
import { VoiceDock } from './VoiceDock';

const STEPS: readonly { id: 'hear' | 'say' | 'check'; label: CatalogKey }[] = [
  { id: 'hear', label: 'noSe.step.hear' },
  { id: 'say', label: 'noSe.step.say' },
  { id: 'check', label: 'noSe.step.check' },
];

/** Which of the three steps is current: hear the answer, say it, see what landed. */
function currentStep(step: NoSeStep, repeated: boolean): number {
  if (step === 'play_answer') return 0;
  if (step === 'prompt_repeat') return repeated ? 2 : 1;
  return 2;
}

/**
 * "No sé" always works: the learner hears the answer, says it out loud, and sees how much of
 * it was understood. Three steps, the answer large with a play button, the alignment of the
 * repeat, and Siguiente once done.
 */
export function NoSeView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'noSe'>) {
  const { t } = useI18n();
  const { packs } = useServices();
  const look = lookOf(vm, screen.sentence);
  const span = answerSpan(packs.lang, screen.sentence, screen.answer);
  const current = currentStep(screen.step, screen.repeat !== undefined);
  const done = screen.step === 'done';
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <WordFlow sentence={screen.sentence} look={look} speakingWord={vm.speakingWord} highlight={span} onHear={actions.hearWord} onReveal={actions.revealWord} />
      <Card testID="nose-card">
        <View style={styles.steps} accessibilityRole="list">
          {STEPS.map((s, i) => (
            <View key={s.id} style={styles.step} testID={`nose-step-${s.id}`} accessibilityState={{ selected: i === current }}>
              <View style={[styles.stepDot, i < current && styles.stepDone, i === current && !done && styles.stepNow]} />
              <Text variant="caption" tone={i === current && !done ? 'accent' : 'muted'} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t(s.label)}
              </Text>
            </View>
          ))}
        </View>
        <SpeakerPrompt line={screen.answer} onPlay={actions.replay} playLabel={t('noSe.play')} large testID="nose-answer" />
        {screen.ui ? (
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="nose-ui">
            {t(screen.ui.key, screen.ui.params)}
          </Text>
        ) : null}
        {screen.repeat ? <UnderstoodLine alignment={screen.repeat} /> : null}
        {done ? <Button label={t('command.next.say')} accessibilityLabel={t('story.continue')} onPress={actions.next} testID="nose-next" /> : null}
      </Card>
      <View style={styles.spacer} />
      <VoiceDock
        title={t('hold.sayIt')}
        subtitle={t('noSe.subtitle')}
        listen={vm.listen}
        onToggle={toggleListen}
        commands={['again', 'slower', 'next']}
        onCommand={(c) => actions.command(c)}
        onType={openTyping}
        height={150}
        ringsWidth={96}
      />
    </>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  stepDot: { width: 10, height: 10, borderRadius: 5, borderWidth: borders.hairline, borderColor: colors.borderDashed },
  stepDone: { backgroundColor: colors.ink, borderColor: colors.ink },
  stepNow: { backgroundColor: colors.live, borderColor: colors.live },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  pill: { borderRadius: radii.pill },
});
