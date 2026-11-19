/** The device's NetworkInfo (expo-network). Web twin: createNativeNetworkInfo.web.ts. */
import { ExpoNetworkInfo } from './ExpoNetworkInfo';
import type { NetworkInfo } from './types';

export function createNativeNetworkInfo(): NetworkInfo {
  return new ExpoNetworkInfo();
}
