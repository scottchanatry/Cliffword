import type { ComponentType } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { PREVIEW_ENABLED } from '../../../src/preview/enabled';

/**
 * The gallery (src/preview/Gallery.tsx), required only when previews are on. The condition is
 * written out here rather than imported: in a store build `__DEV__` is false and
 * EXPO_PUBLIC_PREVIEW is inlined as undefined, so constant folding removes the require before
 * Metro collects dependencies, and no fixture or preview code reaches the bundle.
 */
const Gallery: ComponentType<{ name: string }> | null =
  __DEV__ || process.env.EXPO_PUBLIC_PREVIEW === '1'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../../src/preview/Gallery') as typeof import('../../../src/preview/Gallery')).PreviewGallery
    : null;

/**
 * /preview/main, /preview/b1, ... (story), /preview/a3, /preview/c1, ... (music) and
 * /preview/onboarding-welcome, /preview/profile, ... (onboarding and profile): one fixture full
 * screen, for screenshots; any other name lists them all. Development builds and preview exports
 * only (src/preview/enabled.ts); otherwise it redirects home.
 */
export default function PreviewScreen() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  if (!PREVIEW_ENABLED || !Gallery) return <Redirect href="/" />;
  return <Gallery name={String(screen ?? '')} />;
}
