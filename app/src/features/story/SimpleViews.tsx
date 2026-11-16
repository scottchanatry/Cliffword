import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { colors, spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';

/** Placement is the first story: when it stalls, the level is set. No test screen. */
export function PlacementDoneView({ screen, vm, actions }: KindViewProps<'placementDone'>) {
  const { t } = useI18n();
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <View style={styles.spacer} />
      <Card testID="placement-done">
        <Text variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {t('placement.title')}
        </Text>
        <Text variant="headline" tone="accent" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="placement-vocabulary">
          {t('placement.vocabularyValue', { n: screen.vocabulary })}
        </Text>
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('placement.body')}
        </Text>
        <Button label={t('common.continue')} onPress={actions.next} testID="placement-continue" />
      </Card>
      <View style={styles.spacer} />
    </>
  );
}

/** No sentence could be made: the engine's message and Try again (the next step tries again). */
export function ErrorView({ screen, vm, actions }: KindViewProps<'error'>) {
  const { t } = useI18n();
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} />
      <View style={styles.spacer} />
      <Card testID="story-error">
        <Text variant="cardTitle" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('story.error.title')}
        </Text>
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} accessibilityLiveRegion="polite">
          {t(screen.ui.key, screen.ui.params)}
        </Text>
        <Button label={t('common.retry')} onPress={actions.next} testID="story-retry" />
      </Card>
      <View style={styles.spacer} />
    </>
  );
}

/** Before the first story: what happens, and Start. */
export function IdleView({ actions }: KindViewProps<'idle'>) {
  const { t } = useI18n();
  return (
    <>
      <View style={styles.spacer} />
      <Card testID="story-idle">
        <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {t('story.empty.title')}
        </Text>
        <Text variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('story.empty.body')}
        </Text>
        <Button label={t('story.start')} onPress={actions.start} testID="story-start" />
      </Card>
      <View style={styles.spacer} />
    </>
  );
}

/** The controller is restoring or making the first step: calm, no spinner wall. */
export function LoadingView() {
  const { t } = useI18n();
  return (
    <View style={styles.loading} testID="story-loading" accessible accessibilityRole="progressbar" accessibilityLabel={t('boot.loading')}>
      <ActivityIndicator color={colors.muted} />
      <Text variant="hint" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('boot.loading')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  loading: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
});
