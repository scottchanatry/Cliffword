import { Redirect, useLocalSearchParams } from 'expo-router';
import { StoryPreview } from '../../../src/features/story/StoryPreview';
import { PREVIEW_ENABLED } from '../../../src/preview/enabled';

/** /preview/main, /preview/b1, ...: one story fixture full screen, for screenshots (dev and preview exports only). */
export default function PreviewScreen() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  if (!PREVIEW_ENABLED) return <Redirect href="/" />;
  return <StoryPreview name={String(screen ?? '')} />;
}
