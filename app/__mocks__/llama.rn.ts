/**
 * Jest manual mock for llama.rn (a native module; its own jest/mock.js needs NativeModules).
 * Jest uses it for every test automatically, because it sits next to node_modules. It is the
 * fake of src/testing/fakeLlamaRn.ts with the Cliffword patch present; tests that need another
 * configuration build their own runtime with createFakeLlamaRuntime and pass it to
 * LlamaModelAdapter. `__fakeRuntime` gives a test the runtime behind these exports.
 */
import { createFakeLlamaRuntime } from '../src/testing/fakeLlamaRn';

export const __fakeRuntime = createFakeLlamaRuntime();

export const initLlama = __fakeRuntime.initLlama;

export const isTextScoringAvailable = (): boolean => __fakeRuntime.isTextScoringAvailable?.() ?? false;

export async function releaseAllLlama(): Promise<void> {
  await Promise.all(__fakeRuntime.contexts.map((c) => c.release()));
}
