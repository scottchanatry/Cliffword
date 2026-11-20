import { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useAppState } from '../../src/appState/AppStateProvider';
import { useModelFile } from '../../src/features/profile/useModelFile';
import type { ModelLine } from '../../src/features/story/library/StoryHomeView';
import { StoryView } from '../../src/features/story/StoryView';
import { useStoryController } from '../../src/session/story/useStoryController';
import { colors } from '../../src/theme';

/**
 * The Story tab: the story controller (src/session/story), restored or started on mount and
 * suspended on unmount and app background, rendered by StoryView. In library mode (an
 * experience) the route adds what lives in the settings: the experience picked on the home
 * (trackId and its choices; the controller follows), the first-episode guide (guideSeen) and
 * the language model's line, and the learner's picture beside their replies. Android's back button
 * closes an open episode.
 */
export default function StoryTab() {
  const { vm, actions } = useStoryController();
  const { settings, updateSettings } = useAppState();
  const model = useModelFile();
  const episodeOpen = vm.library != null && vm.view === 'episode';

  useEffect(() => {
    if (!episodeOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      actions.closeEpisode();
      return true;
    });
    return () => sub.remove();
  }, [episodeOpen, actions]);

  const line: ModelLine =
    model.availability === 'ready'
      ? { kind: 'ready' }
      : model.availability === 'downloading' || model.availability === 'verifying' || model.availability === 'loading'
        ? { kind: 'downloading', percent: Math.round(100 * (model.file.progress.fraction ?? 0)) }
        : model.availability === 'missing' && !settings.modelDeclined
          ? { kind: 'wifi' }
          : { kind: 'off' };

  return (
    <View style={styles.root} testID="story-screen">
      <StoryView
        vm={vm}
        actions={actions}
        library={{
          onPickExperience: (trackId, choices) => {
            const kept = settings.trackChoices[trackId] ?? {};
            void updateSettings({ trackId, trackChoices: { ...settings.trackChoices, [trackId]: { ...kept, ...choices } } }).catch((e: unknown) =>
              console.warn('[story] experience not saved', e),
            );
          },
          guideSeen: settings.guideSeen,
          onGuideDone: () => void updateSettings({ guideSeen: true }).catch((e: unknown) => console.warn('[story] guide not saved', e)),
          model: line,
          you: settings.picture,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
