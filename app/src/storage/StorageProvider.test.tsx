import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StorageProvider, useStorage } from './StorageProvider';
import { openTestStorage } from './testing/openTestStorage';

describe('StorageProvider', () => {
  it('hands the storage to hooks below it', async () => {
    const storage = await openTestStorage();
    const wrapper = ({ children }: { children: ReactNode }) => <StorageProvider storage={storage}>{children}</StorageProvider>;
    const { result } = await renderHook(() => useStorage(), { wrapper });
    expect(result.current).toBe(storage);
    await storage.close();
  });

  it('fails clearly outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useStorage())).rejects.toThrow(/inside <StorageProvider>/);
    spy.mockRestore();
  });
});
