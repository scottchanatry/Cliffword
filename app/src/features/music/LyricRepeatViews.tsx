import { StyleSheet, View } from 'react-native';
import type { NoSeStep } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { UnderstoodLine } from '../../components/words/UnderstoodLine';
import { useI18n, type CatalogKey } from '../../i18n';
import { borders, colors, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { SpeakerPrompt } from '../story/SpeakerPrompt';
import { VoiceDock } from '../story/VoiceDock';
import { lineOf } from './LyricCliffView';
import { SongHeader } from './SongHeader';
import type { LyricKindProps } from './viewTypes';

const STEPS: readonly { id: 'hear' | 'say' | 'check'; label: CatalogKey }[] = [
  { id: 'hear', label: 'noSe.step.hear' },
  { id: 'say', label: 'noSe.step.say' },
  { id: 'check', label: 'noSe.step.check' },
];

function currentStep(step: NoSeStep, repeated: boolean): number {
  if (step === 'play_answer') return 0;
  if (step === 'prompt_repeat') return repeated ? 2 : 1;
  return 2;
}

/**
 * "No sé" on a lyric cliff: the hidden words are played, the learner sings or says them back
 * and sees how many landed. Three steps, the answer with a play button (Otra vez), the
 * alignment of the repeat, and Siguiente.
 */
export function LyricNoSeView({ screen, vm, actions, toggleListen, openTyping }: LyricKindProps<'noSe'>) {
  const { t } = useI18n();
  const current = currentStep(screen.step, screen.repeat !== undefined);
  const done = screen.step === 'done';
  return (
    <>
      <SongHeader meta={screen.meta} subtitle={lineOf(t, screen.meta, screen.lineIndex)} size="small" busy={vm.busy} />
      <Card testID="lyric-nose-card">
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
        <SpeakerPrompt line={screen.answer} onPlay={() => actions.command('again')} playLabel={t('noSe.play')} large testID="nose-answer" />
        {screen.ui ? (
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="nose-ui">
            {t(screen.ui.key, screen.ui.params)}
          </Text>
        ) : null}
        {screen.repeat ? <UnderstoodLine alignment={screen.repeat} /> : null}
        {done ? <Button label={t('command.next.say')} accessibilityLabel={t('music.nextLine')} onPress={actions.next} testID="nose-next" /> : null}
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

/**
 * The learner answered a lyric cliff in their own language: what was heard, the Spanish to
 * say instead (played), and how much of the repeat landed.
 */
export function LyricNativeReplyView({ screen, vm, actions, toggleListen, openTyping }: LyricKindProps<'nativeReply'>) {
  const { t } = useI18n();
  return (
    <>
      <SongHeader meta={screen.meta} subtitle={lineOf(t, screen.meta, screen.lineIndex)} size="small" busy={vm.busy} />
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-heard">
        {t('native.heard', { heard: screen.heard })}
      </Text>
      <Card testID="lyric-native-card">
        <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('native.sayInstead')}
        </Text>
        {screen.target ? (
          <SpeakerPrompt line={screen.target} onPlay={() => actions.command('again')} playLabel={t('native.play')} large testID="native-target" />
        ) : (
          <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-no-target">
            {t('native.noTarget')}
          </Text>
        )}
        {screen.ui ? (
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-ui">
            {t(screen.ui.key, screen.ui.params)}
          </Text>
        ) : null}
        {screen.repeat ? <UnderstoodLine alignment={screen.repeat} /> : null}
        <Button variant="outline" label={t('command.next.say')} accessibilityLabel={t('music.nextLine')} onPress={actions.next} testID="native-next" />
      </Card>
      <View style={styles.spacer} />
      <VoiceDock
        title={t('hold.sayIt')}
        subtitle={t('native.subtitle')}
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
});
