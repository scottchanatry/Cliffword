/**
 * The active pair pack for the app. The engine never picks a language itself; the app
 * builds packs here and passes them down. Only Spanish for English speakers exists now.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { createDefaultPairPack, type PairPack } from '@cliffword/engine';

let defaultPair: PairPack | undefined;

/** The en-es pair pack, built once on first use. */
export function getDefaultPairPack(): PairPack {
  defaultPair ??= createDefaultPairPack();
  return defaultPair;
}

const PacksContext = createContext<PairPack | null>(null);

export function PacksProvider({ pair, children }: { pair: PairPack; children: ReactNode }) {
  return <PacksContext.Provider value={pair}>{children}</PacksContext.Provider>;
}

/** The active pair pack. Must be inside PacksProvider. */
export function usePairPack(): PairPack {
  const pair = useContext(PacksContext);
  if (!pair) throw new Error('usePairPack must be used inside <PacksProvider>');
  return pair;
}
