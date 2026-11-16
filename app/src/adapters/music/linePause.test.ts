import { systemClock } from '../clock/systemClock';
import { FakeMusicPlayer } from './FakeMusicPlayer';
import { decidePause, PausePoller, PauseSlot, pauseTarget, type PausePollTarget, type Timers } from './linePause';
import { PAUSE_TOLERANCE_MS, type PlaybackState, type Song } from './types';

const SONG: Song = { id: 's', title: 'Luna de Santurce', artist: 'Rayo K', durationMs: 200_000 };
const at = (status: PlaybackState['status'], positionMs: number, song: Song | null = SONG): PlaybackState => ({
  status,
  song,
  positionMs,
  at: 0,
});

describe('pauseTarget and decidePause', () => {
  it('subtracts the lead and never goes below 0', () => {
    expect(pauseTarget(12_000)).toBe(12_000);
    expect(pauseTarget(12_000, { leadMs: 150 })).toBe(11_850);
    expect(pauseTarget(100, { leadMs: 500 })).toBe(0);
    expect(pauseTarget(1_000, { leadMs: -50 })).toBe(1_000);
  });

  it('arms ahead, pauses at once just past, and cancels far past, without a song or after the end', () => {
    expect(decidePause(at('playing', 1_000), 2_000)).toEqual({ kind: 'arm' });
    expect(decidePause(at('paused', 1_000), 2_000)).toEqual({ kind: 'arm' });
    expect(decidePause(at('playing', 2_000), 2_000)).toEqual({ kind: 'pause-now' });
    expect(decidePause(at('playing', 2_000 + PAUSE_TOLERANCE_MS), 2_000)).toEqual({ kind: 'pause-now' });
    expect(decidePause(at('paused', 2_050), 2_000)).toEqual({ kind: 'already-paused' });
    expect(decidePause(at('playing', 2_000 + PAUSE_TOLERANCE_MS + 1), 2_000)).toEqual({ kind: 'cancel', reason: 'past-target' });
    expect(decidePause(at('idle', 0, null), 2_000)).toEqual({ kind: 'cancel', reason: 'no-song' });
    expect(decidePause(at('ended', 200_000), 2_000)).toEqual({ kind: 'cancel', reason: 'ended' });
  });
});

describe('PauseSlot', () => {
  it('keeps one target: replacing, firing by token and cancelling', async () => {
    const slot = new PauseSlot();
    const a = slot.arm(1_000);
    const b = slot.arm(2_000);
    expect(await a.promise).toEqual({ outcome: 'cancelled', targetMs: 1_000, reason: 'replaced' });
    expect(slot.fire(a.token, 1_000)).toBe(false);
    expect(slot.current()).toEqual({ token: b.token, targetMs: 2_000 });
    expect(slot.fire(b.token, 2_004)).toBe(true);
    expect(await b.promise).toEqual({ outcome: 'paused', targetMs: 2_000, positionMs: 2_004 });
    expect(slot.current()).toBeNull();
    expect(slot.cancel('cleared')).toBe(false);
    const c = slot.arm(3_000);
    expect(slot.cancel('seeked')).toBe(true);
    expect(await c.promise).toMatchObject({ outcome: 'cancelled', reason: 'seeked' });
  });
});

/** Polls a FakeMusicPlayer on the (jest-faked) system clock. */
function pollTargetFor(music: FakeMusicPlayer): PausePollTarget & { pauses: number } {
  const target = {
    pauses: 0,
    positionMs: () => music.positionMs(),
    isPlaying: () => music.state().status === 'playing',
    pause: async () => {
      target.pauses += 1;
      await music.pause();
    },
  };
  return target;
}

/** Real (faked) timers that fire `lateMs` late, as a busy JS thread would. */
const lateTimers = (lateMs: number): Timers => ({
  setTimeout: (fn, ms) => setTimeout(fn, ms + lateMs),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

describe('PausePoller (the line-end pause helper)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  async function playFake() {
    const music = new FakeMusicPlayer({ clock: systemClock, authorization: 'authorized', songs: [SONG] });
    await music.play('s');
    return music;
  }

  it('pauses within a few ms of the target', async () => {
    const music = await playFake();
    const poller = new PausePoller();
    const target = pollTargetFor(music);
    const done = poller.arm(target, 30_000);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(music.state().status).toBe('playing');
    await jest.advanceTimersByTimeAsync(2_000);
    const position = await done;
    expect(target.pauses).toBe(1);
    expect(position).not.toBeNull();
    expect(Math.abs((position ?? 0) - 30_000)).toBeLessThanOrEqual(3);
    expect(music.state()).toMatchObject({ status: 'paused' });
    expect(poller.armed).toBe(false);
  });

  it.each([10, 45, 80])('stays within tolerance when every timer fires %i ms late', async (lateMs) => {
    const music = await playFake();
    const poller = new PausePoller({ timers: lateTimers(lateMs) });
    const done = poller.arm(pollTargetFor(music), 12_345);
    await jest.advanceTimersByTimeAsync(20_000);
    const position = await done;
    expect(position).not.toBeNull();
    expect(Math.abs((position ?? 0) - 12_345)).toBeLessThanOrEqual(PAUSE_TOLERANCE_MS);
  });

  it('waits while playback is paused and fires after it resumes', async () => {
    const music = await playFake();
    const poller = new PausePoller();
    const done = poller.arm(pollTargetFor(music), 5_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await music.pause();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(music.positionMs()).toBe(2_000);
    await music.resume();
    await jest.advanceTimersByTimeAsync(3_500);
    const position = await done;
    expect(Math.abs((position ?? 0) - 5_000)).toBeLessThanOrEqual(3);
  });

  it('notices a seek while sleeping far from the target', async () => {
    const music = await playFake();
    const poller = new PausePoller();
    const done = poller.arm(pollTargetFor(music), 100_000);
    await jest.advanceTimersByTimeAsync(1_000);
    await music.seek(99_000);
    await jest.advanceTimersByTimeAsync(1_500);
    const position = await done;
    expect(Math.abs((position ?? 0) - 100_000)).toBeLessThanOrEqual(3);
  });

  it('resolves null and leaves playback alone when cancelled or replaced', async () => {
    const music = await playFake();
    const poller = new PausePoller();
    const target = pollTargetFor(music);
    const first = poller.arm(target, 4_000);
    const second = poller.arm(target, 6_000);
    expect(await first).toBeNull();
    poller.cancel();
    expect(await second).toBeNull();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(target.pauses).toBe(0);
    expect(music.state().status).toBe('playing');
    expect(jest.getTimerCount()).toBe(0);
  });
});
