/**
 * Web twin of ShareIntentBridge.tsx: nothing is shared into the web preview, and Metro picks this
 * file for the web bundle, so expo-share-intent never reaches it.
 */
import type { ReactNode } from 'react';

export function ShareIntentBridge({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
