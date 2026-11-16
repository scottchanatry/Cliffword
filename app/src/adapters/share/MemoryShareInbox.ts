/**
 * In-memory ShareInbox: the fake for tests and the inbox on web. receive() plays the share
 * sheet. Like ExpoShareInbox, a repeat of a pending item (same url and text) returns the pending
 * item and notifies nobody.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import type { ShareInbox, ShareInput, ShareReceiver, SharedItem } from './types';

export class MemoryShareInbox implements ShareInbox, ShareReceiver {
  private items: SharedItem[] = [];
  private seq = 0;
  private readonly listeners = new Listeners<SharedItem>();

  constructor(private readonly clock: Clock = systemClock) {}

  pending(): SharedItem[] {
    return [...this.items];
  }

  clear(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
  }

  onShare(listener: (item: SharedItem) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  /** Adds a shared item and notifies listeners. Blank input (no url, no text) is ignored: null. */
  receive(input: ShareInput): SharedItem | null {
    const url = input.url?.trim() || undefined;
    const text = input.text?.trim() || undefined;
    if (!url && !text) return null;
    const repeat = this.items.find((item) => item.url === url && item.text === text);
    if (repeat) return repeat;
    this.seq += 1;
    const receivedAt = this.clock.now();
    const item: SharedItem = { id: `share-${receivedAt}-${this.seq}`, receivedAt, ...(url ? { url } : {}), ...(text ? { text } : {}) };
    this.items.push(item);
    this.listeners.emit(item);
    return item;
  }
}
