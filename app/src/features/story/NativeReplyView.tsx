import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { UnderstoodLine } from '../../components/words/UnderstoodLine';
import { WordFlow } from '../../components/words/WordFlow';
import { useI18n } from '../../i18n';
import { borders, colors, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { lookOf } from './CliffView';
import { SpeakerPrompt } from './SpeakerPrompt';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';
import { VoiceDock } from './VoiceDock';

/**
 * The learner answered in their own language: what was heard, the target words to say
 * instead (with a play button), each phrase's translation, then the repeat's alignment.
 */
export function NativeReplyView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'nativeReply'>) {
  const { t } = useI18n();
  const look = screen.sentence ? lookOf(vm, screen.sentence) : 'ink';
  const landed = screen.repeat !== undefined && screen.repeat.total > 0 && screen.repeat.understood === screen.repeat.total;
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      {screen.sentence ? <WordFlow sentence={screen.sentence} look={look} speakingWord={vm.speakingWord} onHear={actions.hearWord} onReveal={actions.revealWord} /> : null}
      <Card testID="native-card">
        <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-heard">
          {t('native.heard', { heard: screen.heard })}
        </Text>
        {screen.target ? (
          <>
            <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
              {t('native.sayInstead')}
            </Text>
            <SpeakerPrompt line={screen.target} onPlay={actions.replay} playLabel={t('native.play')} large testID="native-target" />
          </>
        ) : (
          <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-none">
            {t('native.noTarget')}
          </Text>
        )}
        {screen.phrases.length > 0 ? (
          <View style={styles.phrases} testID="native-phrases">
            {screen.phrases.map((p, i) => (
              <View key={`${i}-${p.native}`} style={styles.phrase}>
                <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.native}>
                  {p.native}
                </Text>
                <Text variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                  {t('native.arrow')}
                </Text>
                <Text variant="bodyStrong" maxFontSizeMultiplier={CONTENT_MAX_SCALE} style={styles.target}>
                  {p.target ?? t('native.unknown')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {screen.ui ? (
          <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="native-ui">
            {t(screen.ui.key, screen.ui.params)}
          </Text>
        ) : null}
        {screen.repeat ? <UnderstoodLine alignment={screen.repeat} /> : null}
        {landed || !screen.target ? <Button label={t('command.next.say')} accessibilityLabel={t('story.continue')} onPress={actions.next} testID="native-next" /> : null}
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
  phrases: { gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: borders.hairline, borderTopColor: colors.borderSoft },
  phrase: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  native: { fontStyle: 'normal' },
  target: { color: colors.ink },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
