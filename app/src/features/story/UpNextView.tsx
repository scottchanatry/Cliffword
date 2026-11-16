import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { AdvancedTask } from '@cliffword/engine';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, Text } from '../../ui';
import { chapterLine, MetaRow, SpokenRight } from './StoryHeader';
import type { KindViewProps } from './types';

/** "Up next: retell this scene aloud in 60 seconds, then 45, then 30." (A2's grey panel). */
export function UpNextCard({ testID = 'up-next' }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <Card tone="soft" testID={testID} style={styles.panel}>
      <Text variant="eyebrow" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('upNext.label')}
      </Text>
      <Text variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('upNext.retell')}
      </Text>
    </Card>
  );
}

/**
 * The chapter is done: the retell comes next (Start the retell). At the top of the frequency
 * list the advanced tasks are offered too: switching register here, songs in the Music tab.
 */
export function UpNextView({ screen, vm, actions }: KindViewProps<'upNext'>) {
  const { t } = useI18n();
  const offers = screen.advanced.filter((a): a is Exclude<AdvancedTask, 'brought_text'> => a !== 'brought_text');
  return (
    <>
      <MetaRow canned={vm.modelMode === 'canned'} text={chapterLine(t, screen.meta)} busy={vm.busy} right={<SpokenRight ms={vm.spokenTodayMs} />} />
      <Text variant="title" accessibilityRole="header" testID="up-next-title">
        {t('upNext.title')}
      </Text>
      <UpNextCard />
      <Button label={t('upNext.startRetell')} onPress={actions.next} testID="up-next-start" />
      {offers.length > 0 ? (
        <View style={styles.offers} testID="up-next-advanced">
          <Text variant="eyebrow" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('upNext.orTry')}
          </Text>
          {offers.map((task) =>
            task === 'register_switch' ? (
              <Button key={task} variant="outline" label={t('upNext.register')} onPress={actions.startRegisterTask} testID="up-next-register" />
            ) : (
              <Button key={task} variant="outline" label={t('upNext.lyrics')} onPress={() => router.navigate('/music')} testID="up-next-lyrics" />
            ),
          )}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.xs },
  offers: { gap: spacing.sm },
});
