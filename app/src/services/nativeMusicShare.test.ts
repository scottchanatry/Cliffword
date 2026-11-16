/**
 * The music and share members of the native container (Jest runs as iOS; the cliffword-music
 * module is absent here, as on Android).
 */
import { FakeClock } from '../adapters/clock/FakeClock';
import { ExpoShareInbox } from '../adapters/share/ExpoShareInbox';
import { MemoryShareInbox } from '../adapters/share/MemoryShareInbox';
import { UnsupportedMusicPlayer } from '../adapters/music/UnsupportedMusicPlayer';
import { createNativeServices } from './nativeServices';
import { createStorageService } from './storageService';
import { createTestServices } from './testServices';
import { createWebServices } from './webServices';

describe('native container: music and share', () => {
  it.each(['ios', 'android'] as const)('%s: a persistent share inbox, and no Apple Music without the module', async (platform) => {
    const test = createTestServices();
    const storage = createStorageService('sql.js-memory', () => test.storage.open());
    const clock = new FakeClock();
    const s = createNativeServices(platform, { storage, clock, model: test.model, modelManager: test.modelManager });
    expect(s.share).toBeInstanceOf(ExpoShareInbox);
    expect(s.music).toBeInstanceOf(UnsupportedMusicPlayer);
    expect(await s.music.authorize()).toBe('unsupported');

    const item = await (s.share as ExpoShareInbox).receive({ text: 'Despacito - Luis Fonsi' });
    expect(item).toMatchObject({ text: 'Despacito - Luis Fonsi', receivedAt: clock.now() });
    const opened = await test.storage.open();
    expect((await opened.shareInbox.pending()).map((r) => r.text)).toEqual(['Despacito - Luis Fonsi']);
    await test.storage.close();
  });

  it('web keeps the in-memory inbox', () => {
    expect(createWebServices({}, {}).share).toBeInstanceOf(MemoryShareInbox);
  });
});
