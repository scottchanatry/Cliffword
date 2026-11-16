import { Redirect, useLocalSearchParams } from 'expo-router';
import { isMusicFixtureName } from '../../../src/features/music/fixtures';
import { MusicPreview } from '../../../src/features/music/MusicPreview';
import { isAccountFixtureName } from '../../../src/features/profile/accountFixtures';
import { AccountPreview } from '../../../src/features/profile/AccountPreview';
import { StoryPreview } from '../../../src/features/story/StoryPreview';
import { PREVIEW_ENABLED } from '../../../src/preview/enabled';

/**
 * /preview/main, /preview/b1, ... (story) and /preview/a3, /preview/c1, /preview/c2, /preview/b4,
 * /preview/c3, /preview/paste, /preview/text, ... (music) and /preview/onboarding-welcome,
 * /preview/profile, /preview/settings, ... (onboarding and profile, ACCOUNT_FIXTURE_NAMES): one
 * fixture full screen, for screenshots (dev and preview exports only).
 */
export default function PreviewScreen() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  if (!PREVIEW_ENABLED) return <Redirect href="/" />;
  const name = String(screen ?? '');
  if (isMusicFixtureName(name)) return <MusicPreview name={name} />;
  if (isAccountFixtureName(name)) return <AccountPreview name={name} />;
  return <StoryPreview name={name} />;
}
