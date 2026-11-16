/**
 * Jest manual mock for expo-share-intent (its native module and the share extension do not
 * exist in Jest). Jest uses it for every test automatically, because it sits next to
 * node_modules. Drive it with `fakeShareIntent` from src/testing/fakeShareIntent.
 */
import {
  FakeShareIntentProvider,
  fakeShareIntent,
  useFakeShareIntent,
  useFakeShareIntentContext,
} from '../src/testing/fakeShareIntent';

export { fakeShareIntent };
export const ShareIntentProvider = FakeShareIntentProvider;
export const useShareIntentContext = useFakeShareIntentContext;
export const useShareIntent = useFakeShareIntent;
export const ShareIntentModule = null;
export const getScheme = (): string => 'cliffword';
export const getShareExtensionKey = (): string => 'cliffwordShareKey';
