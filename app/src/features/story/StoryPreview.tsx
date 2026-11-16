/**
 * Dev gallery of the story views: renders one fixture (src/features/story/fixtures.ts) by name,
 * or the list of names. The actions keep a little local state (text mode, meaning sheet,
 * notice, type instead) so the screens can be tried by hand; everything else does nothing.
 * Reached only through the guarded (dev) route.
 */
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import type { StoryActions, StoryViewModel } from '../../session/contract';
import { sharedMockModel } from '../../services/defaults';
import { useServices } from '../../services/ServicesProvider';
import { colors, layout, spacing } from '../../theme';
import { Text } from '../../ui';
import { isStoryFixtureName, STORY_FIXTURE_NAMES, storyFixtures, type StoryFixtures } from './fixtures';
import { StoryView } from './StoryView';

export function StoryPreview({ name }: { name: string }) {
  const { packs } = useServices();
  const [fixtures, setFixtures] = useState<StoryFixtures | null>(null);
  useEffect(() => {
    let live = true;
    void storyFixtures({ lang: packs.lang, pair: packs.pair, model: sharedMockModel() }).then((f) => {
      if (live) setFixtures(f);
    });
    return () => {
      live = false;
    };
  }, [packs]);

  if (!isStoryFixtureName(name)) return <PreviewIndex />;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']} testID="story-preview">
      {fixtures ? <PreviewStory key={name} initial={fixtures[name]} /> : <ActivityIndicator style={styles.wait} color={colors.muted} />}
    </SafeAreaView>
  );
}

function PreviewStory({ initial }: { initial: StoryViewModel }) {
  const [vm, setVm] = useState(initial);
  const actions = useMemo<StoryActions>(() => {
    const none = () => undefined;
    return {
      holdBegin: none,
      holdStart: () => setVm((v) => ({ ...v, listen: { phase: 'listening', level: 0.6, partial: '' } })),
      holdEnd: () => setVm((v) => ({ ...v, listen: { phase: 'idle' } })),
      holdCancel: () => setVm((v) => (v.listen.phase === 'listening' ? v : { ...v, listen: { phase: 'idle' } })),
      typeAnswer: none,
      command: none,
      pickOption: none,
      closeMeaning: () => setVm((v) => ({ ...v, meaning: null })),
      dismissNotice: () => setVm((v) => ({ ...v, notice: null })),
      start: none,
      next: none,
      hearWord: (index) => setVm((v) => ({ ...v, speakingWord: v.speakingWord === index ? null : index })),
      revealWord: none,
      replay: none,
      setTextMode: (textMode) => setVm((v) => ({ ...v, textMode })),
      startRegisterTask: none,
    };
  }, []);
  return <StoryView vm={vm} actions={actions} />;
}

function PreviewIndex() {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.root} testID="story-preview-index">
      <ScrollView contentContainerStyle={styles.list}>
        <Text variant="title" accessibilityRole="header">
          {t('preview.title')}
        </Text>
        <View style={styles.links}>
          {STORY_FIXTURE_NAMES.map((n) => (
            <Link key={n} href={`/preview/${n}`} style={styles.link}>
              <Text variant="rowTitle">{n}</Text>
            </Link>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  wait: { flex: 1 },
  list: { padding: layout.screenPaddingX, gap: spacing.lg },
  links: { gap: spacing.xs },
  link: { minHeight: layout.minTouch, paddingVertical: spacing.sm },
});
