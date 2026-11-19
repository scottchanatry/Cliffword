/**
 * NetworkInfo with a kind set by hand: the web preview ('unknown': its model is the mock, ready
 * at once, so nothing downloads) and tests (set('wifi') to start the download).
 */
import { Listeners, type Unsubscribe } from '../listeners';
import type { ConnectionKind, NetworkInfo } from './types';

export class FixedNetworkInfo implements NetworkInfo {
  private readonly listeners = new Listeners<ConnectionKind>();

  constructor(private current: ConnectionKind = 'unknown') {}

  async kind(): Promise<ConnectionKind> {
    return this.current;
  }

  onChange(listener: (kind: ConnectionKind) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  /** Change the connection and tell the listeners. */
  set(kind: ConnectionKind): void {
    if (kind === this.current) return;
    this.current = kind;
    this.listeners.emit(kind);
  }
}
