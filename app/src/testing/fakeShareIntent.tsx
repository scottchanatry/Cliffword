/**
 * Plays expo-share-intent for Jest (the package needs its native module and the share
 * extension). __mocks__/expo-share-intent.tsx exports this hook and provider, so every test that
 * renders ShareIntentBridge (the route tests too) gets them. A test delivers a share with
 * `fakeShareIntent.deliver({ text, webUrl })`, as the native module's onChange would, and reads
 * `fakeShareIntent.resets` to see that the app cleared it.
 *
 * Test-only (src/testing is never imported by app code).
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ShareIntent } from 'expo-share-intent';

export const EMPTY_SHARE_INTENT: ShareIntent = { files: null, text: null, webUrl: null, type: null };

type State = { isReady: boolean; hasShareIntent: boolean; shareIntent: ShareIntent; resetShareIntent: (clearNativeModule?: boolean) => void; error: string | null };

const hasValue = (intent: ShareIntent) => !!(intent.text || intent.webUrl || intent.files);

class FakeShareIntentHost {
  /** resetShareIntent() calls (the app clears a share once it has stored it). */
  resets = 0;
  private value: ShareIntent = EMPTY_SHARE_INTENT;
  private error: string | null = null;
  private readonly listeners = new Set<() => void>();

  /** Delivers a share (a new object each time, as the hook's state would be). */
  deliver(intent: Partial<ShareIntent>): void {
    this.value = { ...EMPTY_SHARE_INTENT, type: intent.webUrl ? 'weburl' : 'text', ...intent };
    this.notify();
  }

  fail(error: string): void {
    this.error = error;
    this.notify();
  }

  reset = (): void => {
    this.resets += 1;
    this.error = null;
    if (hasValue(this.value)) this.value = EMPTY_SHARE_INTENT;
    this.notify();
  };

  /** Back to no share and no resets (call in beforeEach). */
  clear(): void {
    this.value = EMPTY_SHARE_INTENT;
    this.error = null;
    this.resets = 0;
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): ShareIntent => this.value;

  errorSnapshot = (): string | null => this.error;

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const fakeShareIntent = new FakeShareIntentHost();

export function useFakeShareIntent(): State {
  const shareIntent = useSyncExternalStore(fakeShareIntent.subscribe, fakeShareIntent.snapshot);
  const error = useSyncExternalStore(fakeShareIntent.subscribe, fakeShareIntent.errorSnapshot);
  return { isReady: true, hasShareIntent: hasValue(shareIntent), shareIntent, resetShareIntent: fakeShareIntent.reset, error };
}

const Context = createContext<State>({
  isReady: false,
  hasShareIntent: false,
  shareIntent: EMPTY_SHARE_INTENT,
  resetShareIntent: () => undefined,
  error: null,
});

export function FakeShareIntentProvider({ children }: { options?: unknown; children: ReactNode }) {
  const state = useFakeShareIntent();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useFakeShareIntentContext(): State {
  return useContext(Context);
}
