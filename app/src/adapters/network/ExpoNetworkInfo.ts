/**
 * NetworkInfo over expo-network (iOS, Android): getNetworkStateAsync for the kind now and
 * addNetworkStateListener for changes. Wi-Fi and Ethernet count as 'wifi'; mobile data as
 * 'cellular'; no connection (or not connected) as 'none'; anything else as 'unknown'.
 * Imported only through createNativeNetworkInfo.ts, so expo-network stays out of the web bundle.
 */
import * as Network from 'expo-network';
import { Listeners, type Unsubscribe } from '../listeners';
import type { ConnectionKind, NetworkInfo } from './types';

/** The kind of an expo-network state. */
export function connectionKindOf(state: { type?: string; isConnected?: boolean } | null | undefined): ConnectionKind {
  if (!state) return 'unknown';
  if (state.isConnected === false || state.type === Network.NetworkStateType.NONE) return 'none';
  switch (state.type) {
    case Network.NetworkStateType.WIFI:
    case Network.NetworkStateType.ETHERNET:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    default:
      return 'unknown';
  }
}

export class ExpoNetworkInfo implements NetworkInfo {
  private readonly listeners = new Listeners<ConnectionKind>();
  private subscription: { remove(): void } | null = null;

  async kind(): Promise<ConnectionKind> {
    try {
      return connectionKindOf(await Network.getNetworkStateAsync());
    } catch {
      return 'unknown';
    }
  }

  onChange(listener: (kind: ConnectionKind) => void): Unsubscribe {
    if (!this.subscription) {
      try {
        this.subscription = Network.addNetworkStateListener((event) => this.listeners.emit(connectionKindOf(event)));
      } catch {
        // A binary without the module: no change events (kind() still answers 'unknown').
      }
    }
    const off = this.listeners.add(listener);
    return () => {
      off();
      if (this.listeners.size === 0) {
        this.subscription?.remove();
        this.subscription = null;
      }
    };
  }
}
