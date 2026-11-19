/**
 * Web twin of createNativeNetworkInfo.ts: the preview cannot tell Wi-Fi from mobile data, and its
 * model is the mock (ready at once), so the kind stays 'unknown' and expo-network stays out of
 * the web bundle.
 */
import { FixedNetworkInfo } from './FixedNetworkInfo';
import type { NetworkInfo } from './types';

export function createNativeNetworkInfo(): NetworkInfo {
  return new FixedNetworkInfo('unknown');
}
