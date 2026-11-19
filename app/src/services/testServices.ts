/**
 * Services for Jest: every adapter is a fake or in-memory, all on one FakeClock, and storage is
 * a fresh sql.js database in memory (same schema and repositories as the app; ids "test-1",
 * "test-2", ...). The return type keeps the concrete fakes, so a test can drive them:
 *
 *   const services = createTestServices();
 *   await services.speechIn.start({ lang: 'es-ES', onDevice: true, interim: true });
 *   services.speechIn.say('Marta llegó tarde');
 *   services.clock.advance(1000);
 *   const storage = await services.storage.open();
 *
 * Overrides replace single services (their types replace the fake types in the result).
 *
 * Test-only: the app never imports this file (src/services/index.ts does not export it), so
 * the fakes and sql.js stay out of the iOS and Android bundles. Import it directly in tests.
 */
import { FakeClock } from '../adapters/clock/FakeClock';
import { FakeHaptics } from '../adapters/haptics/FakeHaptics';
import { FakeModelManager } from '../adapters/model/FakeModelManager';
import { MockModelAdapter } from '../adapters/model/MockModelAdapter';
import { FakeMusicPlayer } from '../adapters/music/FakeMusicPlayer';
import { FixedNetworkInfo } from '../adapters/network/FixedNetworkInfo';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import { FakeSpeechIn } from '../adapters/speechIn/FakeSpeechIn';
import { FakeSpeechOut } from '../adapters/speechOut/FakeSpeechOut';
import { openMemoryStorage } from '../storage/testing/openTestStorage';
import { defaultPacks, sharedMockModel } from './defaults';
import { createStorageService, storageClockFor } from './storageService';
import type { ServiceOverrides, Services } from './types';

export interface TestServices extends Services {
  readonly platform: 'test';
  readonly model: MockModelAdapter;
  readonly modelManager: FakeModelManager;
  readonly speechOut: FakeSpeechOut;
  readonly speechIn: FakeSpeechIn;
  readonly music: FakeMusicPlayer;
  readonly share: MemoryShareInbox;
  readonly haptics: FakeHaptics;
  readonly network: FixedNetworkInfo;
  readonly clock: FakeClock;
}

/** Test services where the overridden keys take the override's type. */
export type TestServicesWith<O> = Omit<TestServices, keyof O> & { readonly [K in keyof O]-?: Exclude<O[K], undefined> };

export function createTestServices<O extends ServiceOverrides = Record<never, never>>(overrides?: O): TestServicesWith<O> {
  const o: ServiceOverrides = overrides ?? {};
  const clock = o.clock ?? new FakeClock();
  let ids = 0;
  const storageClock = storageClockFor(clock, () => `test-${++ids}`);
  const services: Services = {
    platform: 'test',
    clock,
    packs: o.packs ?? defaultPacks(),
    model: o.model ?? new MockModelAdapter({ model: sharedMockModel() }),
    modelManager: o.modelManager ?? new FakeModelManager(),
    speechOut: o.speechOut ?? new FakeSpeechOut({ clock }),
    speechIn: o.speechIn ?? new FakeSpeechIn({ clock }),
    music: o.music ?? new FakeMusicPlayer({ clock }),
    share: o.share ?? new MemoryShareInbox(clock),
    haptics: o.haptics ?? new FakeHaptics(),
    // Mobile data unless a test sets Wi-Fi (network.set('wifi')): no download starts by itself.
    network: o.network ?? new FixedNetworkInfo('cellular'),
    storage: o.storage ?? createStorageService('sql.js-memory', () => openMemoryStorage(storageClock)),
  };
  // The cast keeps the concrete fake types built above (or the overrides' types); see TestServicesWith.
  return services as unknown as TestServicesWith<O>;
}
