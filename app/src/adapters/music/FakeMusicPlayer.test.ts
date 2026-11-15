import { FakeClock } from '../clock/FakeClock';
import { FAKE_SONGS, FakeMusicPlayer } from './FakeMusicPlayer';
import { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';
import { MusicPlayerError, type PlaybackStatus } from './types';

describe('FakeMusicPlayer', () => {
  it('needs authorization before the library and playback', async () => {
    const music = new FakeMusicPlayer();
    expect(music.available).toBe(true);
    expect(await music.authorizationStatus()).toBe('notDetermined');
    await expect(music.librarySongs()).rejects.toMatchObject({ code: 'not-authorized' });
    await expect(music.play('fake-song-1')).rejects.toBeInstanceOf(MusicPlayerError);

    expect(await music.authorize()).toBe('authorized');
    expect(await music.subscriptionStatus()).toEqual({ canPlayCatalog: true, hasCloudLibrary: true, canSubscribe: false });

    const refused = new FakeMusicPlayer({ authorizeResult: 'denied' });
    expect(await refused.authorize()).toBe('denied');
    await expect(refused.librarySongs()).rejects.toMatchObject({ code: 'not-authorized' });
  });

  it('searches the library by title or artist, ignoring case and accents, with a limit', async () => {
    const music = new FakeMusicPlayer({ authorization: 'authorized' });
    expect(await music.librarySongs()).toEqual(FAKE_SONGS);
    expect((await music.librarySongs({ query: 'cancion' })).map((s) => s.id)).toEqual(['fake-song-1']);
    expect((await music.librarySongs({ query: 'MARIA' })).map((s) => s.id)).toEqual(['fake-song-3']);
    expect(await music.librarySongs({ limit: 1 })).toHaveLength(1);
    expect(await music.librarySongs({ query: 'zzz' })).toEqual([]);
  });

  it('plays on the clock: position, pause, resume, seek and the end of the song', async () => {
    const clock = new FakeClock();
    const music = new FakeMusicPlayer({ clock, authorization: 'authorized' });
    const statuses: PlaybackStatus[] = [];
    music.onStateChange((s) => statuses.push(s.status));

    await expect(music.play('nope')).rejects.toMatchObject({ code: 'not-found' });
    await music.play('fake-song-1');
    expect(music.nowPlaying()?.title).toBe('Canción del Mar');
    clock.advance(10_000);
    expect(music.positionMs()).toBe(10_000);

    await music.pause();
    clock.advance(5_000);
    expect(music.positionMs()).toBe(10_000);
    await music.resume();
    clock.advance(1_000);
    expect(music.positionMs()).toBe(11_000);

    await music.seek(195_000);
    expect(music.state()).toMatchObject({ status: 'playing', positionMs: 195_000, at: clock.now() });
    clock.advance(10_000);
    expect(music.positionMs()).toBe(200_000);
    expect(music.state().status).toBe('ended');

    await music.seek(-50);
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 0 });
    expect(statuses).toEqual(['playing', 'paused', 'playing', 'playing', 'ended', 'paused']);
    expect(music.played).toEqual(['fake-song-1']);
  });

  it('tick() reports the end of the song without another read', async () => {
    const clock = new FakeClock();
    const music = new FakeMusicPlayer({
      clock,
      authorization: 'authorized',
      songs: [{ id: 's', title: 'Corta', artist: 'Prueba', durationMs: 1_000 }],
    });
    const listener = jest.fn();
    await music.play('s');
    music.onStateChange(listener);
    clock.advance(1_500);
    music.tick();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ended', positionMs: 1_000 }));
  });

  it('pause, resume and seek do nothing without a song', async () => {
    const music = new FakeMusicPlayer({ authorization: 'authorized' });
    const listener = jest.fn();
    music.onStateChange(listener);
    await music.pause();
    await music.resume();
    await music.seek(1000);
    expect(listener).not.toHaveBeenCalled();
    expect(music.state()).toMatchObject({ status: 'idle', song: null, positionMs: 0 });
  });
});

describe('UnsupportedMusicPlayer', () => {
  it('answers unsupported and rejects library and playback calls', async () => {
    const music = new UnsupportedMusicPlayer();
    expect(music.available).toBe(false);
    expect(await music.authorize()).toBe('unsupported');
    expect(await music.authorizationStatus()).toBe('unsupported');
    expect(await music.subscriptionStatus()).toBe('unsupported');
    for (const call of [() => music.librarySongs(), () => music.play(), () => music.pause(), () => music.resume(), () => music.seek()]) {
      await expect(call()).rejects.toMatchObject({ name: 'MusicPlayerError', code: 'unsupported' });
    }
    expect(music.positionMs()).toBe(0);
    expect(music.nowPlaying()).toBeNull();
    expect(music.state().status).toBe('idle');
    const off = music.onStateChange();
    expect(() => off()).not.toThrow();
  });
});
