/**
 * The dev fixture gallery behind app/(dev)/preview/[screen].tsx: one fixture full screen by
 * name (story, music, onboarding and profile fixtures), or for any other name the list of all
 * of them. The route requires this module only in development builds and preview exports
 * (EXPO_PUBLIC_PREVIEW=1), so a store build bundles none of it (see the route).
 */
import { Link } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MUSIC_FIXTURE_NAMES, isMusicFixtureName } from '../features/music/fixtures';
import { MusicPreview } from '../features/music/MusicPreview';
import { ACCOUNT_FIXTURE_NAMES, isAccountFixtureName } from '../features/profile/accountFixtures';
import { AccountPreview } from '../features/profile/AccountPreview';
import { STORY_FIXTURE_NAMES, isStoryFixtureName } from '../features/story/fixtures';
import { StoryPreview } from '../features/story/StoryPreview';
import { useI18n } from '../i18n';
import { colors, layout, spacing } from '../theme';
import { Text } from '../ui';

export function PreviewGallery({ name }: { name: string }) {
  if (isStoryFixtureName(name)) return <StoryPreview name={name} />;
  if (isMusicFixtureName(name)) return <MusicPreview name={name} />;
  if (isAccountFixtureName(name)) return <AccountPreview name={name} />;
  return <PreviewIndex />;
}

/** Every fixture name, by area, each a link (the 44 dp row is the target). */
function PreviewIndex() {
  const { t } = useI18n();
  const groups = [STORY_FIXTURE_NAMES, MUSIC_FIXTURE_NAMES, ACCOUNT_FIXTURE_NAMES];
  return (
    <SafeAreaView style={styles.root} testID="story-preview-index">
      <ScrollView contentContainerStyle={styles.list}>
        <Text variant="title" accessibilityRole="header">
          {t('preview.title')}
        </Text>
        {groups.map((names) => (
          <View key={names[0]} style={styles.links}>
            {names.map((n) => (
              <Link key={n} href={`/preview/${n}`} style={styles.link} testID={`preview-link-${n}`}>
                <Text variant="rowTitle">{n}</Text>
              </Link>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  list: { padding: layout.screenPaddingX, gap: spacing.xl },
  links: { gap: spacing.xs },
  link: { minHeight: layout.minTouch, paddingVertical: spacing.sm },
});
