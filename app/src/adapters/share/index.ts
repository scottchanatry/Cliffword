export type { ShareInbox, ShareInput, ShareReceiver, SharedItem } from './types';
export { isShareReceiver } from './types';
export { parseSongArtist, parseSpotifyShare } from './parseSpotifyShare';
export type { SpotifyShare } from './parseSpotifyShare';
export { MemoryShareInbox } from './MemoryShareInbox';
export { ExpoShareInbox } from './ExpoShareInbox';
export type { ShareInboxLog, ShareInboxStore, StoredShare } from './ExpoShareInbox';
export { SHARE_EXTENSION_KEY, SHARE_ROUTE, SHARE_SCHEME, shareIntentToInput, shareRouteFor } from './shareIntent';
export type { ShareIntentLike } from './shareIntent';
// ShareIntentBridge (expo-share-intent) and createNativeShareInbox stay out of this barrel: they
// have .web twins, and the bridge's package must not reach the web bundle.
