import { FakeClock } from '../clock/FakeClock';
import { codedError, FAKE_NATIVE_SONGS, FakeCliffwordMusic } from '../../testing/FakeCliffwordMusic';
import { END_SLACK_MS, mapAuthorization, mapSong, MusicKitPlayer, toMusicPlayerError, type MusicKitNative } from './MusicKitPlayer';
import { MusicPlayerError, PAUSE_TOLERANCE_MS, type PlaybackState } from './types';

function setup(authorization: FakeCliffwordMusic['authorization'] = 'authorized') {
  const clock = new FakeClock();
  const native = new FakeCliffwordMusic(clock);
  native.authorization = authorization;
  const music = new MusicKitPlayer(native, { clock });
  const states: PlaybackState[] = [];
  music.onStateChange((s) => states.push(s));
  return { clock, native, music, states };
}

const methods = (native: FakeCliffwordMusic) => native.calls.map((c) => c.method).filter((m) => m !== 'authorizationStatus');

describe('MusicKitPlayer: authorization', () => {
  it('asks only while undecided and maps every status', async () => {
    const { native, music } = setup('notDetermined');
    expect(music.available).toBe(true);
    expect(await music.authorizationStatus()).toBe('notDetermined');
    expect(methods(native)).toEqual([]);

    expect(await music.authorize()).toBe('authorized');
    expect(methods(native)).toEqual(['requestAuthorization']);
    expect(await music.authorize()).toBe('authorized');
    expect(methods(native)).toEqual(['requestAuthorization']);

    for (const status of ['denied', 'restricted'] as const) {
      const other = setup(status);
      expect(await other.music.authorize()).toBe(status);
      expect(methods(other.native)).toEqual([]);
    }

    const refused = setup('notDetermined');
    refused.native.requestResult = 'denied';
    expect(await refused.music.authorize()).toBe('denied');
    expect(mapAuthorization('somethingNew')).toBe('denied');
  });

  it('needs authorization for the library and playback, without calling the module', async () => {
    const { native, music } = setup('denied');
    await expect(music.librarySongs()).rejects.toMatchObject({ name: 'MusicPlayerError', code: 'not-authorized' });
    await expect(music.play('i.lib1')).rejects.toMatchObject({ code: 'not-authorized' });
    expect(methods(native)).toEqual([]);
  });

  it('reads the subscription and maps its errors', async () => {
    const { native, music } = setup();
    expect(await music.subscriptionStatus()).toEqual({ canPlayCatalog: true, hasCloudLibrary: true, canSubscribe: false });
    native.subscriptionResult = codedError('ERR_MUSIC_NOT_AUTHORIZED');
    await expect(music.subscriptionStatus()).rejects.toMatchObject({ code: 'not-authorized' });
  });
});

describe('MusicKitPlayer: library', () => {
  it('maps songs to ms, keeps http artwork only and leaves out songs it cannot play', async () => {
    const { native, music } = setup();
    const songs = await music.librarySongs();
    expect(native.calls.find((c) => c.method === 'librarySongs')?.args).toEqual([null, 'recentlyAdded', 25, 0]);
    expect(songs).toEqual([
      {
        id: 'i.lib1',
        title: 'Luna de Santurce',
        artist: 'Rayo K',
        album: 'Calle Loíza',
        durationMs: 201_500,
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg',
        explicit: true,
        isrc: 'QZTEST2600001',
        genre: 'Reggaeton',
      },
      { id: 'i.lib2', title: 'Corazón Lento', artist: 'María Demo', durationMs: 180_000 },
    ]);
  });

  it('passes search, order and paging to the module', async () => {
    const { native, music } = setup();
    expect((await music.librarySongs({ query: '  luna ', order: 'recentlyPlayed', limit: 10.7, offset: 2 })).map((s) => s.id)).toEqual([]);
    expect(native.calls.find((c) => c.method === 'librarySongs')?.args).toEqual(['luna', 'recentlyPlayed', 10, 2]);
    expect((await music.librarySongs({ query: 'rayo', order: 'title' })).map((s) => s.id)).toEqual(['i.lib1']);
    expect(native.calls.filter((c) => c.method === 'librarySongs')[1]?.args).toEqual(['rayo', 'title', 25, 0]);
  });

  it('maps module songs and errors on their own', () => {
    expect(mapSong({ id: 'x', title: 'T', artist: 'A', durationSec: null, explicit: false, playable: true })).toEqual({
      id: 'x',
      title: 'T',
      artist: 'A',
      durationMs: 0,
    });
    expect(mapSong({ id: 'x', title: 'T', artist: 'A', durationSec: 0.0004, artworkUrl: 'HTTP://a/b.jpg', explicit: false, playable: true })).toMatchObject({
      durationMs: 0,
      artworkUrl: 'HTTP://a/b.jpg',
    });
    expect(toMusicPlayerError(codedError('ERR_MUSIC_NOT_FOUND')).code).toBe('not-found');
    expect(toMusicPlayerError(codedError('ERR_MUSIC_NO_SUBSCRIPTION')).code).toBe('no-subscription');
    expect(toMusicPlayerError(codedError('ERR_MUSIC_FAILED', 'boom'))).toMatchObject({ code: 'failed', message: 'boom' });
    expect(toMusicPlayerError('weird').code).toBe('failed');
    const own = new MusicPlayerError('unsupported');
    expect(toMusicPlayerError(own)).toBe(own);
  });

  it('rejects with failed when the library request fails', async () => {
    const { native, music } = setup();
    native.failNext.set('librarySongs', codedError('ERR_MUSIC_FAILED', 'offline'));
    await expect(music.librarySongs()).rejects.toMatchObject({ code: 'failed', message: 'offline' });
  });
});

describe('MusicKitPlayer: playback', () => {
  it('plays, pauses, resumes and seeks, with one state per change', async () => {
    const { clock, native, music, states } = setup();
    await music.librarySongs();
    await music.play('i.lib1');
    expect(states.map((s) => s.status)).toEqual(['loading', 'playing']);
    expect(states[0]?.song?.title).toBe('Luna de Santurce');
    expect(music.nowPlaying()?.durationMs).toBe(201_500);

    clock.advance(10_000);
    expect(music.positionMs()).toBe(10_000);
    await music.pause();
    clock.advance(5_000);
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 10_000 });
    expect(music.positionMs()).toBe(10_000);

    await music.resume();
    clock.advance(1_000);
    expect(music.positionMs()).toBe(11_000);

    await music.seek(500_000);
    expect(native.calls.at(-1)).toEqual({ method: 'seek', args: [201.5] });
    expect(music.state()).toMatchObject({ status: 'playing', positionMs: 201_500 });
    await music.seek(-5);
    expect(native.calls.at(-1)).toEqual({ method: 'seek', args: [0] });
    expect(states.map((s) => s.status)).toEqual(['loading', 'playing', 'paused', 'playing', 'playing', 'playing']);
  });

  it('plays a song it has not listed yet (the module sends the song)', async () => {
    const { music, states } = setup();
    await music.play('i.lib2');
    expect(states[0]).toMatchObject({ status: 'loading', song: null });
    expect(music.nowPlaying()?.title).toBe('Corazón Lento');
  });

  it('pause, resume and seek do nothing without a song', async () => {
    const { native, music, states } = setup();
    await music.pause();
    await music.resume();
    await music.seek(1000);
    expect(methods(native)).toEqual([]);
    expect(states).toEqual([]);
    expect(music.state()).toMatchObject({ status: 'idle', song: null, positionMs: 0 });
  });

  it('maps play failures and goes back to what the module holds', async () => {
    const { native, music } = setup();
    await expect(music.play('i.nope')).rejects.toMatchObject({ code: 'not-found' });
    expect(music.state()).toMatchObject({ status: 'idle', song: null });

    native.failNext.set('play', codedError('ERR_MUSIC_NO_SUBSCRIPTION', 'subscribe'));
    await expect(music.play('i.lib1')).rejects.toMatchObject({ code: 'no-subscription', message: 'subscribe' });
    expect(music.state().status).toBe('idle');
  });

  it('follows time updates and outside pauses, and reads a stop near the end as ended', async () => {
    const { clock, native, music, states } = setup();
    await music.play('i.lib2');
    clock.advance(2_000);
    // The module reports a little less than the clock (buffering): the position re-anchors.
    native.emit('onPlaybackTime', { positionSec: 1.9, status: 'playing' });
    expect(music.positionMs()).toBe(1_900);
    clock.advance(100);
    expect(music.positionMs()).toBe(2_000);
    expect(states).toHaveLength(2); // time updates are not state changes

    native.external('paused', 2.0);
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 2_000 });
    native.external('playing', 2.0);
    clock.advance(178_000 - END_SLACK_MS + 500);
    native.external('stopped', 0);
    expect(music.state()).toMatchObject({ status: 'ended', positionMs: 180_000 });
    native.external('paused', 0);
    expect(music.state().status).toBe('ended');
    expect(states.map((s) => s.status)).toEqual(['loading', 'playing', 'paused', 'playing', 'ended']);

    await music.seek(30_000);
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 30_000 });
  });

  it('stops listening on dispose', () => {
    const { native, music } = setup();
    expect(native.listenerCount('onPlaybackState')).toBe(1);
    music.dispose();
    expect(native.listenerCount('onPlaybackState')).toBe(0);
    expect(native.listenerCount('onPlaybackTime')).toBe(0);
  });
});

describe('MusicKitPlayer: pauseAt (native line-end timer)', () => {
  it('arms the native timer and resolves where the module paused, within tolerance', async () => {
    const { clock, native, music } = setup();
    await music.play('i.lib1');
    const result = music.pauseAt(12_000, { leadMs: 150 });
    expect(native.scheduled).toEqual({ token: 1, targetSec: 11.85 });

    clock.advance(11_000);
    native.tick();
    expect(music.state().status).toBe('playing');
    clock.advance(853);
    native.tick();
    const paused = await result;
    expect(paused).toEqual({ outcome: 'paused', targetMs: 11_850, positionMs: 11_853 });
    if (paused.outcome !== 'paused') throw new Error('expected a pause');
    expect(Math.abs(paused.positionMs - paused.targetMs)).toBeLessThanOrEqual(PAUSE_TOLERANCE_MS);
    expect(music.state()).toMatchObject({ status: 'paused', positionMs: 11_853 });
  });

  it('accepts the pause token as BigInt (Swift Int on iOS)', async () => {
    const { native, music } = setup();
    await music.play('i.lib1');
    const result = music.pauseAt(3_000, { leadMs: 0 });
    native.emit('onScheduledPause', { token: BigInt(1) as unknown as number, targetSec: 3, positionSec: 3.004, missed: false });
    expect(await result).toEqual({ outcome: 'paused', targetMs: 3_000, positionMs: 3_004 });
  });

  it('ignores a late event for an older target and cancels on seek, replace and clear', async () => {
    const { clock, native, music } = setup();
    await music.play('i.lib1');
    const first = music.pauseAt(5_000);
    const second = music.pauseAt(6_000);
    expect(await first).toEqual({ outcome: 'cancelled', targetMs: 5_000, reason: 'replaced' });
    native.emit('onScheduledPause', { token: 1, targetSec: 5, positionSec: 5, missed: false });
    expect(music.state().status).toBe('playing');

    await music.seek(1_000);
    expect(await second).toEqual({ outcome: 'cancelled', targetMs: 6_000, reason: 'seeked' });
    expect(native.scheduled).toBeNull();

    const third = music.pauseAt(8_000);
    music.clearPauseAt();
    expect(await third).toMatchObject({ outcome: 'cancelled', reason: 'cleared' });
    expect(native.scheduled).toBeNull();

    const fourth = music.pauseAt(9_000);
    await music.play('i.lib2');
    expect(await fourth).toMatchObject({ outcome: 'cancelled', reason: 'song-changed' });
    clock.advance(1);
  });

  it('stays armed through a pause and fires after resume', async () => {
    const { clock, native, music } = setup();
    await music.play('i.lib1');
    const result = music.pauseAt(3_000);
    clock.advance(1_000);
    await music.pause();
    clock.advance(10_000);
    native.tick();
    await music.resume();
    clock.advance(2_000);
    native.tick();
    expect(await result).toEqual({ outcome: 'paused', targetMs: 3_000, positionMs: 3_000 });
  });

  it('decides at once: no song, past the target, at the target, already paused there', async () => {
    const { clock, native, music } = setup();
    expect(await music.pauseAt(1_000)).toEqual({ outcome: 'cancelled', targetMs: 1_000, reason: 'no-song' });
    await music.play('i.lib1');
    clock.advance(5_000);
    expect(await music.pauseAt(4_800)).toEqual({ outcome: 'cancelled', targetMs: 4_800, reason: 'past-target' });
    expect(await music.pauseAt(4_950)).toEqual({ outcome: 'paused', targetMs: 4_950, positionMs: 5_000 });
    expect(music.state().status).toBe('paused');
    expect(await music.pauseAt(4_960)).toEqual({ outcome: 'paused', targetMs: 4_960, positionMs: 5_000 });
    expect(native.calls.filter((c) => c.method === 'pause')).toHaveLength(1);
  });

  it('reports a target the module missed (an outside seek past it) as past-target, and the end of the song as ended', async () => {
    const { clock, native, music } = setup();
    await music.play('i.lib2');
    const missed = music.pauseAt(10_000);
    native.external('playing', 60);
    native.tick();
    expect(await missed).toMatchObject({ outcome: 'cancelled', reason: 'past-target' });

    const tooLate = music.pauseAt(179_900);
    clock.advance(119_500);
    native.external('stopped', 0);
    expect(await tooLate).toMatchObject({ outcome: 'cancelled', reason: 'ended' });
  });

  it('falls back to polling when the binary has no native timer', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const clock = { now: () => Date.now() };
      const fake = new FakeCliffwordMusic(clock as unknown as FakeClock);
      fake.authorization = 'authorized';
      const native: MusicKitNative = { ...bindAll(fake), schedulePause: undefined, cancelScheduledPause: undefined };
      const music = new MusicKitPlayer(native, { clock });
      await music.play('i.lib1');
      const result = music.pauseAt(2_000);
      await jest.advanceTimersByTimeAsync(2_500);
      const paused = await result;
      expect(paused.outcome).toBe('paused');
      if (paused.outcome === 'paused') expect(Math.abs(paused.positionMs - 2_000)).toBeLessThanOrEqual(PAUSE_TOLERANCE_MS);
      expect(music.state().status).toBe('paused');
    } finally {
      jest.useRealTimers();
    }
  });
});

/** The fake's methods bound to it, as a plain object (so single methods can be removed). */
function bindAll(fake: FakeCliffwordMusic): MusicKitNative {
  return {
    authorizationStatus: () => fake.authorizationStatus(),
    requestAuthorization: () => fake.requestAuthorization(),
    subscription: () => fake.subscription(),
    librarySongs: (q, o, l, off) => fake.librarySongs(q, o, l, off),
    play: (id) => fake.play(id),
    pause: () => fake.pause(),
    resume: () => fake.resume(),
    seek: (s) => fake.seek(s),
    playbackState: () => fake.playbackState(),
    addListener: (event, listener) => fake.addListener(event, listener),
  };
}

it('FAKE_NATIVE_SONGS includes a song that cannot be played', () => {
  expect(FAKE_NATIVE_SONGS.some((s) => !s.playable)).toBe(true);
});
