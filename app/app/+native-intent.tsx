/**
 * System paths that are not routes. expo-router calls redirectSystemPath for every deep link on
 * iOS and Android (not on the web). The iOS share extension (expo-share-intent) opens
 * `cliffword://dataUrl=cliffwordShareKey?nonce=…#weburl`, which is sent to the Music tab, where
 * the share inbox shows the item; ShareIntentBridge reads the payload. Every other path is left
 * as it is.
 */
import { shareRouteFor } from '../src/adapters/share/shareIntent';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return shareRouteFor(path) ?? path;
  } catch {
    return '/';
  }
}
