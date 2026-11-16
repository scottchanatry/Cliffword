/**
 * Share-in on iOS and Android: expo-share-intent's ShareIntentProvider around the app, and a
 * feeder that hands each shared link or text to the container's share inbox
 * (useServices().share, an ExpoShareInbox on the device), then opens the Music tab.
 *
 * - Once the inbox has the item (stored in share_inbox), the native copy is cleared with
 *   resetShareIntent(), so the hook does not deliver it again when the app becomes active.
 * - The same item delivered twice is stored and announced once (the inbox dedupes).
 * - restore() runs once at mount, so items left unhandled by an earlier run show up.
 * - iOS opens the app with a share-extension deep link, which app/+native-intent.tsx already
 *   sends to the Music tab; Android delivers an ACTION_SEND intent with no URL, so the feeder
 *   navigates once the root navigator is ready (it waits while startup still shows the loading
 *   state). Before onboarding the guard redirects that to onboarding.
 *
 * Mount it inside AppProviders (it reads the services) and around everything else. Its .web.tsx
 * twin renders the children only, so expo-share-intent stays out of the web bundle
 * (__tests__/importGraph.test.ts checks it).
 */
import { useEffect, useEffectEvent, type ReactNode } from 'react';
import { router, useNavigationContainerRef } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useServices } from '../../services/ServicesProvider';
import { SHARE_ROUTE, shareIntentToInput } from './shareIntent';
import { isShareReceiver } from './types';

const warn = (message: string, error?: unknown) => {
  if (__DEV__) console.warn(`[share] ${message}`, error ?? '');
};

export function ShareIntentBridge({ children }: { children: ReactNode }) {
  return (
    <ShareIntentProvider>
      <ShareInboxFeeder />
      {children}
    </ShareIntentProvider>
  );
}

function ShareInboxFeeder() {
  const inbox = useServices().share;
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntentContext();
  const navigation = useNavigationContainerRef();

  // The hook makes a new reset function on every render; effect events see the latest.
  const clearNativeShare = useEffectEvent(() => resetShareIntent());

  const openShareRoute = useEffectEvent(() => {
    const go = () => {
      try {
        router.navigate(SHARE_ROUTE);
      } catch (e) {
        warn('could not open the Music tab for a share', e);
      }
    };
    if (navigation.isReady()) {
      go();
      return;
    }
    const off = navigation.addListener('state', () => {
      if (!navigation.isReady()) return;
      off();
      go();
    });
  });

  useEffect(() => {
    if (isShareReceiver(inbox) && inbox.restore) inbox.restore().catch((e: unknown) => warn('could not restore shared items', e));
  }, [inbox]);

  useEffect(() => {
    if (error) warn(`share intent error: ${error}`);
  }, [error]);

  useEffect(() => {
    if (!hasShareIntent) return;
    const input = shareIntentToInput(shareIntent);
    if (!input || !isShareReceiver(inbox)) {
      // Files, or an inbox that cannot take items: nothing to keep.
      clearNativeShare();
      return;
    }
    Promise.resolve(inbox.receive(input)).then(
      (item) => {
        clearNativeShare();
        if (item) openShareRoute();
      },
      (e: unknown) => warn('could not take a shared item', e),
    );
  }, [hasShareIntent, shareIntent, inbox]);

  return null;
}
