/**
 * Makes an opened Storage available to screens. Opening is the caller's job (the root layout
 * opens it once with openStorage(); tests pass one from openTestStorage()).
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Storage } from './storage';

const StorageContext = createContext<Storage | null>(null);

export function StorageProvider({ storage, children }: { storage: Storage; children: ReactNode }) {
  return <StorageContext.Provider value={storage}>{children}</StorageContext.Provider>;
}

/** The app's storage. Must be inside StorageProvider. */
export function useStorage(): Storage {
  const storage = useContext(StorageContext);
  if (!storage) throw new Error('useStorage must be used inside <StorageProvider>');
  return storage;
}
