/**
 * The song's Apple Music track, as the lyric controller drives it (services.music, the
 * MusicPlayer contract of src/adapters/music/types.ts).
 *
 * - Available only for a song linked to an Apple Music library song, on a device with MusicKit,
 *   once the learner granted access. Otherwise the controller runs in manual mode (the voice
 *   reads the lines).
 * - Playback only ever starts or resumes from a learner's action (App Review 4.5.2): the
 *   controller calls segment() for next, a tapped line, again, play and the sing-back; nothing
 *   here resumes on its own.
 * - segment(from, target): plays up to `target` and pauses there with the adapter's
 *   pauseAt() (a native timer on iOS within PAUSE_TOLERANCE_MS; FakeMusicPlayer pauses exactly).
 *   When the track is paused a little before the target (the previous cliff's stop), it simply
 *   resumes, so the song runs on line by line; otherwise it seeks to `from` first.
 * - While it plays, the position is re-read every TICK_MS for the view (vm.playback).
 */
import type { MusicPlayer, PauseAtResult } from '../../adapters/music/types';
import type { PlaybackState } from '../contract';

/** How often the playback position is re-read for the view while the track plays. */
export const TICK_MS = 250;
/** Resume (instead of seeking back) when the track is paused at most this far before the target. */
export const MAX_RESUME_GAP_MS = 30_000;
/** A target this close ahead of the position counts as reached: seek back to hear the run-up. */
export const MIN_AHEAD_MS = 150;

export const NO_PLAYBACK: PlaybackState = Object.freeze({ available: false, playing: false, positionMs: 0, durationMs: null });

export interface Ticker {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemTicker: Ticker = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface TrackDeps {
  music: MusicPlayer;
  trackId: string;
  /** The playback view changed (status, song, seek, or a tick while playing). */
  onChange: () => void;
  onError?: (error: unknown) => void;
  /** null: no ticking (tests read the position themselves). */
  ticker?: Ticker | null;
}

export type SegmentOutcome = 'paused' | 'cancelled' | 'playing' | 'failed';

export class Track {
  private ready = false;
  private unsub: (() => void) | null = null;
  private tick: unknown = null;
  private disposed = false;

  constructor(private readonly deps: TrackDeps) {}

  /** Checks access without asking (the library screen asks). */
  async init(): Promise<void> {
    const { music } = this.deps;
    if (!music.available) return;
    try {
      this.ready = (await music.authorizationStatus()) === 'authorized';
    } catch (e) {
      this.deps.onError?.(e);
      this.ready = false;
    }
    if (this.ready && !this.disposed) {
      this.unsub = music.onStateChange(() => {
        this.syncTicker();
        this.deps.onChange();
      });
    }
  }

  get available(): boolean {
    return this.ready && !this.disposed;
  }

  /** This song is the one loaded in the player. */
  private get loaded(): boolean {
    return this.deps.music.nowPlaying()?.id === this.deps.trackId;
  }

  get playing(): boolean {
    if (!this.available) return false;
    const s = this.deps.music.state();
    return s.status === 'playing' && s.song?.id === this.deps.trackId;
  }

  view(): PlaybackState {
    if (!this.available) return NO_PLAYBACK;
    const { music, trackId } = this.deps;
    const s = music.state();
    if (s.song?.id !== trackId) return { available: true, playing: false, positionMs: 0, durationMs: null };
    return { available: true, playing: s.status === 'playing', positionMs: music.positionMs(), durationMs: s.song.durationMs };
  }

  positionMs(): number {
    return this.available && this.loaded ? this.deps.music.positionMs() : 0;
  }

  /** Pause if this track is playing (before the voice speaks or the microphone listens). */
  async pauseIfPlaying(): Promise<void> {
    if (!this.playing) return;
    try {
      await this.deps.music.pause();
    } catch (e) {
      this.deps.onError?.(e);
    }
  }

  /**
   * Play towards `target` and pause there. `from`: where a fresh run starts (seeked to unless the
   * track is paused a little before the target and this is not a replay). A null target plays on
   * (the learner pauses). Resolves when it paused, was cancelled, or (null target) once playing.
   */
  async segment(from: number, target: number | null, replay: boolean): Promise<SegmentOutcome> {
    if (!this.available) return 'failed';
    const { music, trackId } = this.deps;
    try {
      if (!this.loaded) {
        await music.play(trackId);
        replay = true;
      }
      const pos = music.positionMs();
      const resumable = target !== null && pos <= target - MIN_AHEAD_MS && target - pos <= MAX_RESUME_GAP_MS;
      if (replay || !resumable) await music.seek(Math.max(0, from));
      const pausing: Promise<PauseAtResult> | null = target !== null ? music.pauseAt(target) : null;
      if (music.state().status !== 'playing') await music.resume();
      this.syncTicker();
      this.deps.onChange();
      if (!pausing) return 'playing';
      const result = await pausing;
      this.syncTicker();
      this.deps.onChange();
      return result.outcome;
    } catch (e) {
      this.deps.onError?.(e);
      return 'failed';
    }
  }

  /** The play button: resume where the track stopped, or start the song. */
  async resume(): Promise<void> {
    if (!this.available) return;
    const { music, trackId } = this.deps;
    try {
      if (!this.loaded) await music.play(trackId);
      else if (music.state().status !== 'playing') {
        if (music.state().status === 'ended') await music.seek(0);
        await music.resume();
      }
    } catch (e) {
      this.deps.onError?.(e);
    }
    this.syncTicker();
    this.deps.onChange();
  }

  async pause(): Promise<void> {
    await this.pauseIfPlaying();
    this.syncTicker();
    this.deps.onChange();
  }

  /** Leaving the song: disarm the line pause, pause the track, stop listening to it. */
  dispose(): void {
    if (this.disposed) return;
    const wasPlaying = this.playing;
    this.disposed = true;
    this.stopTicker();
    this.unsub?.();
    this.unsub = null;
    if (this.ready && this.loaded) {
      this.deps.music.clearPauseAt();
      if (wasPlaying) void this.deps.music.pause().catch((e: unknown) => this.deps.onError?.(e));
    }
  }

  private syncTicker(): void {
    if (this.playing && !this.disposed) this.startTicker();
    else this.stopTicker();
  }

  private startTicker(): void {
    const ticker = this.deps.ticker === undefined ? systemTicker : this.deps.ticker;
    if (!ticker || this.tick !== null) return;
    this.tick = ticker.setInterval(() => {
      // Reading the position also lets a player without its own timer notice a pauseAt target.
      if (!this.playing) this.stopTicker();
      this.deps.onChange();
    }, TICK_MS);
  }

  private stopTicker(): void {
    if (this.tick === null) return;
    const ticker = this.deps.ticker === undefined ? systemTicker : this.deps.ticker;
    ticker?.clearInterval(this.tick);
    this.tick = null;
  }
}
