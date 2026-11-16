import { FakeClock } from '../clock/FakeClock';
import { FAKE_SONGS, FakeMusicPlayer } from './FakeMusicPlayer';
import { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';
import { MusicPlayerError, type PauseAtResult, type PlaybackStatus } from './types';

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

  it('orders by title and pages with offset (recency orders keep the scripted order)', async () => {
    const music = new FakeMusicPlayer({ authorization: 'authorized' });
    expect((await music.librarySongs({ order: 'title' })).map((s) => s.id)).toEqual(['fake-song-1', 'fake-song-3', 'fake-song-2']);
    expect((await music.librarySongs({ order: 'recentlyPlayed' })).map((s) => s.id)).toEqual(['fake-song-1', 'fake-song-2', 'fake-song-3']);
    expect((await music.librarySongs({ offset: 1, limit: 1 })).map((s) => s.id)).toEqual(['fake-song-2']);
    expect(await music.librarySongs({ offset: 5 })).toEqual([]);
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

describe('FakeMusicPlayer.pauseAt', () => {
  async function playing() {
    const clock = new FakeClock();
    const music = new FakeMusicPlayer({ clock, authorization: 'authorized' });
    await music.play('fake-song-1');
    return { clock, music };
  }

  it('pauses exactly at the target (minus the lead) on the first read past it', async () => {
    const { clock, music } = await playing();
    const statuses: PlaybackStatus[] = [];
    music.onStateChange((s) => statuses.push(s.status));
    const result = music.pauseAt(12_000, { leadMs: 200 });
    clock.advance(11_000);
    music.tick();
    expect(music.state().status).toBe('playing');
    clock.advance(5_000);
    expect(music.positionMs()).toBe(11_800);
    expect(await result).toEqual({ outcome: 'paused', targetMs: 11_800, positionMs: 11_800 });
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 11_800 });
    expect(statuses).toEqual(['paused']);
  });

  it('stays armed through pause and resume', async () => {
    const { clock, music } = await playing();
    const result = music.pauseAt(3_000);
    clock.advance(1_000);
    await music.pause();
    clock.advance(9_000);
    music.tick();
    await music.resume();
    clock.advance(2_500);
    music.tick();
    expect(await result).toEqual({ outcome: 'paused', targetMs: 3_000, positionMs: 3_000 });
  });

  it('cancels on seek, replace, clear, a new song and the end of the song', async () => {
    const { clock, music } = await playing();
    const results: Promise<PauseAtResult>[] = [];
    results.push(music.pauseAt(5_000));
    results.push(music.pauseAt(6_000));
    await music.seek(1_000);
    results.push(music.pauseAt(7_000));
    music.clearPauseAt();
    results.push(music.pauseAt(8_000));
    await music.play('fake-song-1');
    results.push(music.pauseAt(250_000));
    clock.advance(200_000);
    music.tick();
    expect((await Promise.all(results)).map((r) => (r.outcome === 'cancelled' ? r.reason : r.outcome))).toEqual([
      'replaced',
      'seeked',
      'cleared',
      'song-changed',
      'ended',
    ]);
    expect(music.state().status).toBe('ended');
  });

  it('answers at once without a song, past the target, at it, or when already paused there', async () => {
    const empty = new FakeMusicPlayer({ authorization: 'authorized' });
    expect(await empty.pauseAt(1_000)).toEqual({ outcome: 'cancelled', targetMs: 1_000, reason: 'no-song' });

    const { clock, music } = await playing();
    clock.advance(5_000);
    expect(await music.pauseAt(4_000)).toEqual({ outcome: 'cancelled', targetMs: 4_000, reason: 'past-target' });
    expect(await music.pauseAt(4_950)).toEqual({ outcome: 'paused', targetMs: 4_950, positionMs: 5_000 });
    expect(music.state().status).toBe('paused');
    expect(await music.pauseAt(4_990)).toEqual({ outcome: 'paused', targetMs: 4_990, positionMs: 5_000 });
  });

  it('wakes itself with timers (a live preview on the system clock)', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const music = new FakeMusicPlayer({
        clock: { now: () => Date.now() },
        authorization: 'authorized',
        songs: [{ id: 's', title: 'Corta', artist: 'Prueba', durationMs: 10_000 }],
        timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      });
      const statuses: PlaybackStatus[] = [];
      music.onStateChange((s) => statuses.push(s.status));
      await music.play('s');
      const result = music.pauseAt(4_000);
      await jest.advanceTimersByTimeAsync(4_000);
      expect(await result).toEqual({ outcome: 'paused', targetMs: 4_000, positionMs: 4_000 });
      await music.resume();
      await jest.advanceTimersByTimeAsync(6_000);
      expect(statuses).toEqual(['playing', 'paused', 'playing', 'ended']);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('UnsupportedMusicPlayer', () => {
  it('answers unsupported and rejects library and playback calls', async () => {
    const music = new UnsupportedMusicPlayer();
    expect(music.available).toBe(false);
    expect(await music.authorize()).toBe('unsupported');
    expect(await music.authorizationStatus()).toBe('unsupported');
    expect(await music.subscriptionStatus()).toBe('unsupported');
    for (const call of [
      () => music.librarySongs(),
      () => music.play(),
      () => music.pause(),
      () => music.resume(),
      () => music.seek(),
      () => music.pauseAt(),
    ]) {
      await expect(call()).rejects.toMatchObject({ name: 'MusicPlayerError', code: 'unsupported' });
    }
    expect(music.positionMs()).toBe(0);
    expect(music.nowPlaying()).toBeNull();
    expect(music.state().status).toBe('idle');
    const off = music.onStateChange();
    expect(() => off()).not.toThrow();
    expect(() => music.clearPauseAt()).not.toThrow();
  });
});
