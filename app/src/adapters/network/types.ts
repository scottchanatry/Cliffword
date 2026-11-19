/**
 * NetworkInfo: what kind of connection the phone has now, so the 1.1 GB model downloads by
 * itself only on Wi-Fi (src/features/model/useModelAutoDownload.ts). Implementations:
 * - ExpoNetworkInfo (iOS, Android): expo-network's state and its change events, through
 *   createNativeNetworkInfo.ts (web twin: createNativeNetworkInfo.web.ts).
 * - FixedNetworkInfo (web, tests): a kind set by hand.
 */
import type { Unsubscribe } from '../listeners';

/** wifi: Wi-Fi or Ethernet (no data plan counts it); cellular: mobile data; none: offline. */
export type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface NetworkInfo {
  /** The connection now ('unknown' when the platform cannot tell). Never rejects. */
  kind(): Promise<ConnectionKind>;
  /** Called with the new kind whenever the connection changes. */
  onChange(listener: (kind: ConnectionKind) => void): Unsubscribe;
}
