import { FakeClock } from '../clock/FakeClock';
import { FakeCliffwordMusic } from '../../testing/FakeCliffwordMusic';
import { createNativeMusicPlayer } from './createNativeMusicPlayer';
import { MusicKitPlayer } from './MusicKitPlayer';
import { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';

describe('createNativeMusicPlayer', () => {
  it('uses MusicKit on iOS when the binary has the module', async () => {
    const clock = new FakeClock();
    const native = new FakeCliffwordMusic(clock);
    native.authorization = 'authorized';
    const music = createNativeMusicPlayer('ios', clock, native);
    expect(music).toBeInstanceOf(MusicKitPlayer);
    expect(music.available).toBe(true);
    expect(await music.authorize()).toBe('authorized');
  });

  it('has no Apple Music on Android, nor on iOS without the module (Jest has none)', async () => {
    const native = new FakeCliffwordMusic(new FakeClock());
    expect(createNativeMusicPlayer('android', undefined, native)).toBeInstanceOf(UnsupportedMusicPlayer);
    expect(createNativeMusicPlayer('ios', undefined, null)).toBeInstanceOf(UnsupportedMusicPlayer);
    const defaulted = createNativeMusicPlayer('ios');
    expect(defaulted).toBeInstanceOf(UnsupportedMusicPlayer);
    expect(await defaulted.authorize()).toBe('unsupported');
    expect(native.calls).toEqual([]);
  });
});
