/**
 * Pure helpers around expo-share-intent 9 (no package import, so routes and the web bundle can
 * use them).
 *
 * - The iOS share extension stores the payload in the App Group and opens
 *   `cliffword://dataUrl=cliffwordShareKey?nonce=<uuid>#weburl` (or #text). That is not a route:
 *   app/+native-intent.tsx sends it to SHARE_ROUTE with shareRouteFor().
 * - shareIntentToInput() turns the hook's ShareIntent into the inbox's { url, text }. Files are
 *   not for this app (the plugin only accepts text and links).
 */
import type { ShareInput } from './types';

/** The app scheme (app.json `scheme`); the extension key is `${scheme}ShareKey`. */
export const SHARE_SCHEME = 'cliffword';

/** The App Group key the share extension writes to and the deep link names. */
export const SHARE_EXTENSION_KEY = `${SHARE_SCHEME}ShareKey`;

/** Where a share opens the app: the Music tab, which reads the share inbox. */
export const SHARE_ROUTE = '/music';

/** The route for a system path that is a share-extension deep link, or null for any other path. */
export function shareRouteFor(path: string): string | null {
  return path.includes(`dataUrl=${SHARE_EXTENSION_KEY}`) ? SHARE_ROUTE : null;
}

/** The parts of expo-share-intent's ShareIntent this app reads. */
export interface ShareIntentLike {
  text?: string | null;
  webUrl?: string | null;
  files?: readonly unknown[] | null;
  type?: string | null;
}

/**
 * The inbox input for a share: webUrl as `url`, and `text` unless it is only that same link (iOS
 * link shares repeat the link as text; so does Spotify's "Copy link" text on Android). Null
 * when the share has neither (files).
 */
export function shareIntentToInput(intent: ShareIntentLike): ShareInput | null {
  const url = intent.webUrl?.trim() || undefined;
  const rawText = intent.text?.trim() || undefined;
  const text = rawText && rawText !== url ? rawText : undefined;
  if (!url && !text) return null;
  return { ...(url ? { url } : {}), ...(text ? { text } : {}) };
}
