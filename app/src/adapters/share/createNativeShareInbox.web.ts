/**
 * Web twin of createNativeShareInbox.ts: nothing is shared into the web preview, so the inbox
 * stays in memory (MemoryShareInbox, whose receive() a preview can still call).
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import type { ShareStorage } from './createNativeShareInbox';
import { MemoryShareInbox } from './MemoryShareInbox';
import type { ShareInbox } from './types';

export function createNativeShareInbox(_storage: ShareStorage, clock: Clock = systemClock): ShareInbox {
  return new MemoryShareInbox(clock);
}
