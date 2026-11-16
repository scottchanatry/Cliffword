import { StyleSheet, View } from 'react-native';
import { StoryView } from '../../src/features/story/StoryView';
import { useStoryController } from '../../src/session/story/useStoryController';
import { colors } from '../../src/theme';

/**
 * The Story tab: the story controller (src/session/story), restored or started on mount and
 * suspended on unmount and app background, rendered by StoryView.
 */
export default function StoryTab() {
  const { vm, actions } = useStoryController();
  return (
    <View style={styles.root} testID="story-screen">
      <StoryView vm={vm} actions={actions} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
});
