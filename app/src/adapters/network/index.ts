export type { ConnectionKind, NetworkInfo } from './types';
export { FixedNetworkInfo } from './FixedNetworkInfo';
// ExpoNetworkInfo and createNativeNetworkInfo stay out of this barrel: expo-network must not
// reach the web bundle (createNativeNetworkInfo.web.ts is the twin).
