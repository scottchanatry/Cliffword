import { StyleSheet, View } from 'react-native';
import type { Register } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { UnderstoodLine } from '../../components/words/UnderstoodLine';
import { useI18n, type CatalogKey } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { SpeakerPrompt } from './SpeakerPrompt';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';
import { VoiceDock } from './VoiceDock';

const SAY_IN: Record<Register, CatalogKey> = { neutral: 'register.sayNeutral', street: 'register.sayStreet' };
const REGISTER_NAME: Record<Register, string> = { neutral: 'slang.neutral', street: 'slang.street' };

/**
 * Switching register (advanced): a line in one register, said back in the other ("Say it
 * street"), with the words that change, and after the answer how much of the expected line
 * was understood and the line itself.
 */
export function RegisterView({ screen, vm, actions, toggleListen, openTyping }: KindViewProps<'register'>) {
  const { t } = useI18n();
  const { task } = screen;
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="register-from-to">
        {t('register.fromTo', { from: t(REGISTER_NAME[task.from]), to: t(REGISTER_NAME[task.to]) })}
      </Text>
      <SpeakerPrompt line={task.prompt} onPlay={actions.replay} playLabel={t('register.play')} testID="register-prompt" />
      <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="register-title">
        {t(SAY_IN[task.to])}
      </Text>
      {task.swaps.length > 0 ? (
        <Card testID="register-swaps">
          <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('register.swaps')}
          </Text>
          {task.swaps.map((s, i) => (
            <View key={`${i}-${s.from}`} style={styles.swap} testID={`register-swap-${i}`}>
              <View style={styles.swapFrom}>
                <Text variant="bodyStrong" tone="muted" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                  {s.from}
                </Text>
              </View>
              <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
                {t('native.arrow')}
              </Text>
              <View style={styles.swapTo}>
                <Text variant="bodyStrong" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                  {s.to}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
      {task.result ? (
        <Card testID="register-result">
          <UnderstoodLine alignment={task.result} />
          <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('register.expected')}
          </Text>
          <Text variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE} testID="register-expected">
            {task.expected}
          </Text>
          <Button variant="outline" label={t('command.next.say')} accessibilityLabel={t('story.continue')} onPress={actions.next} testID="register-next" />
        </Card>
      ) : null}
      <View style={styles.spacer} />
      <VoiceDock
        title={t(SAY_IN[task.to])}
        subtitle={t('register.holdSubtitle')}
        listen={vm.listen}
        onToggle={toggleListen}
        commands={['again', 'dont_know', 'next']}
        onCommand={(c) => actions.command(c)}
        onType={openTyping}
        height={150}
        ringsWidth={96}
      />
    </>
  );
}

const styles = StyleSheet.create({
  swap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  swapFrom: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.tile, borderWidth: borders.hairline, borderColor: colors.border },
  swapTo: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.tile, backgroundColor: colors.heat1 },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
