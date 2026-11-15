/**
 * Web twin of index.ts: there is no native module on the web. The web build keeps the
 * FakeModelManager (createModelManager.web.ts), so nothing should import this there.
 */
import type { CliffwordNativeModule } from './index';

export type { CliffwordNativeEvents, CliffwordNativeModule, HashProgressEvent } from './index';

const CliffwordNative: CliffwordNativeModule | null = null;

export default CliffwordNative;
