/**
 * Dev gallery of the story views: renders one fixture (src/features/story/fixtures.ts) by name
 * (src/preview/Gallery.tsx lists them all). The actions keep a little local state (text mode, meaning sheet,
 * notice, type instead, the report's thanks) so the screens can be tried by hand; everything else does nothing.
 * Reached only through the guarded (dev) route.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tKey } from '../../i18n';
import type { StoryActions, StoryViewModel } from '../../session/contract';
import { sharedMockModel } from '../../services/defaults';
import { useServices } from '../../services/ServicesProvider';
import { colors } from '../../theme';
import { isStoryFixtureName, storyFixtures, type StoryFixtures } from './fixtures';
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

  if (!isStoryFixtureName(name)) return null;
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
      openEpisode: () => setVm((v) => ({ ...v, view: 'episode' })),
      closeEpisode: () => setVm((v) => ({ ...v, view: 'home' })),
      replayEpisode: () => setVm((v) => ({ ...v, view: 'episode' })),
      micTap: () =>
        setVm((v) =>
          v.listen.phase === 'listening'
            ? { ...v, listen: { phase: 'idle' }, micLatched: false }
            : { ...v, listen: { phase: 'listening', level: 0.6, partial: '' }, micLatched: true },
        ),
      // As the app offers it; the gallery shows the thanks notice instead of opening mail.
      reportSentence: () => setVm((v) => ({ ...v, notice: { key: tKey('story.notice.reported') } })),
    };
  }, []);
  return <StoryView vm={vm} actions={actions} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  wait: { flex: 1 },
});
