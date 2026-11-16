/**
 * The share inbox for iOS and Android: ExpoShareInbox over the app's database (the share_inbox
 * table), fed by ShareIntentBridge. Its .web.ts twin gives the in-memory inbox, since nothing is
 * shared into the web preview.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { ExpoShareInbox, type ShareInboxStore } from './ExpoShareInbox';
import type { ShareInbox } from './types';

/** The part of the container's StorageService the inbox needs. */
export interface ShareStorage {
  open(): Promise<{ shareInbox: ShareInboxStore }>;
}

export function createNativeShareInbox(storage: ShareStorage, clock: Clock = systemClock): ShareInbox {
  return new ExpoShareInbox(() => storage.open().then((opened) => opened.shareInbox), clock);
}
