/**
 * In-memory ShareInbox: the fake for tests and the inbox on web. receive() plays the share
 * sheet (and is what a native share bridge would call).
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import type { ShareInbox, SharedItem } from './types';

export class MemoryShareInbox implements ShareInbox {
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
  receive(input: { url?: string; text?: string }): SharedItem | null {
    const url = input.url?.trim() || undefined;
    const text = input.text?.trim() || undefined;
    if (!url && !text) return null;
    this.seq += 1;
    const receivedAt = this.clock.now();
    const item: SharedItem = { id: `share-${receivedAt}-${this.seq}`, receivedAt, ...(url ? { url } : {}), ...(text ? { text } : {}) };
    this.items.push(item);
    this.listeners.emit(item);
    return item;
  }
}
