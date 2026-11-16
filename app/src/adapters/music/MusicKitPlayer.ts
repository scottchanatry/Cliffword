/**
 * MusicPlayer on iOS over the local Expo module modules/cliffword-music (MusicKit). Built by
 * createNativeMusicPlayer; never imported on the web.
 *
 * - Authorization and the library go straight to the module (library songs without play
 *   parameters are left out: they cannot be played here). Artwork URLs that are not http(s)
 *   (MusicKit gives library items a private scheme) are dropped.
 * - Playback state comes from each call's result and from the module's events: onPlaybackState
 *   on status or song changes, onPlaybackTime about every 250 ms while playing (it only re-anchors
 *   the position; positionMs() extrapolates between them with the clock).
 * - The end of the song: MusicKit stops or pauses after a one-song queue. A stop or pause that
 *   this player did not ask for, within END_SLACK_MS of the song's end, reads as 'ended'.
 * - pauseAt(): the module's native timer (schedulePause) pauses within a few ms of the target and
 *   reports it with the token this player gave it, so a late event for an old target is ignored.
 *   A binary without schedulePause falls back to PausePoller.
 * - Errors: the module's codes map to MusicPlayerError codes (see toMusicPlayerError).
 */
import type {
  CliffwordMusicEvents,
  NativeLibraryOrder,
  NativeMusicAuthorization,
  NativePlaybackState,
  NativePlaybackStatus,
  NativeScheduledPauseEvent,
  NativeSong,
  NativeSubscription,
  NativeTimeEvent,
} from '../../../modules/cliffword-music';
import { MUSIC_ERROR_CODES } from '../../../modules/cliffword-music/codes';
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import { decidePause, PausePoller, PauseSlot, pauseTarget, type PausePollTarget, type Timers } from './linePause';
import {
  MusicPlayerError,
  type LibraryQuery,
  type MusicAuthorization,
  type MusicPlayer,
  type MusicSubscription,
  type PauseAtOptions,
  type PauseAtResult,
  type PlaybackState,
  type PlaybackStatus,
  type Song,
} from './types';

/** The module surface MusicKitPlayer uses (CliffwordMusicModule satisfies it). */
export interface MusicKitNative {
  authorizationStatus(): NativeMusicAuthorization;
  requestAuthorization(): Promise<NativeMusicAuthorization>;
  subscription(): Promise<NativeSubscription>;
  librarySongs(query: string | null, order: NativeLibraryOrder, limit: number, offset: number): Promise<NativeSong[]>;
  play(songId: string): Promise<NativePlaybackState>;
  pause(): Promise<NativePlaybackState>;
  resume(): Promise<NativePlaybackState>;
  seek(positionSec: number): Promise<NativePlaybackState>;
  playbackState(): Promise<NativePlaybackState>;
  setTimeUpdateInterval?(ms: number): void;
  schedulePause?(token: number, targetSec: number): void;
  cancelScheduledPause?(): void;
  addListener<E extends keyof CliffwordMusicEvents>(event: E, listener: CliffwordMusicEvents[E]): { remove(): void };
}

export interface MusicKitPlayerOptions {
  clock?: Clock;
  /** Timers for the PausePoller fallback. */
  timers?: Timers;
}

/** A stop this close to the song's end, not asked for by this player, is the end of the song. */
export const END_SLACK_MS = 1500;

const AUTHORIZATIONS: readonly NativeMusicAuthorization[] = ['authorized', 'denied', 'notDetermined', 'restricted'];

/** The module's authorization string as the contract's value (anything unknown reads as 'denied'). */
export function mapAuthorization(status: string): MusicAuthorization {
  return (AUTHORIZATIONS as readonly string[]).includes(status) ? (status as NativeMusicAuthorization) : 'denied';
}

/** A module song as the contract's Song: ms durations, http(s) artwork only, empty fields left out. */
export function mapSong(native: NativeSong): Song {
  const durationSec = Number(native.durationSec);
  const artwork = native.artworkUrl ?? '';
  return {
    id: native.id,
    title: native.title,
    artist: native.artist,
    ...(native.album ? { album: native.album } : {}),
    durationMs: Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : 0,
    ...(/^https?:\/\//i.test(artwork) ? { artworkUrl: artwork } : {}),
    ...(native.explicit ? { explicit: true } : {}),
    ...(native.isrc ? { isrc: native.isrc } : {}),
    ...(native.genre ? { genre: native.genre } : {}),
  };
}

/** A rejected module call as a MusicPlayerError (by the module's error code). */
export function toMusicPlayerError(error: unknown): MusicPlayerError {
  if (error instanceof MusicPlayerError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case MUSIC_ERROR_CODES.notAuthorized:
      return new MusicPlayerError('not-authorized', message);
    case MUSIC_ERROR_CODES.notFound:
      return new MusicPlayerError('not-found', message);
    case MUSIC_ERROR_CODES.noSubscription:
      return new MusicPlayerError('no-subscription', message);
    default:
      return new MusicPlayerError('failed', message);
  }
}

/** Module seconds as whole ms (never negative or NaN). */
function msOf(seconds: number): number {
  const ms = Math.round(Number(seconds) * 1000);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function playbackStatusOf(status: NativePlaybackStatus): PlaybackStatus {
  switch (status) {
    case 'playing':
    case 'seeking':
      return 'playing';
    case 'paused':
    case 'interrupted':
    case 'stopped':
      return 'paused';
  }
}

interface ApplyOptions {
  /** The status this player just asked for (MusicKit may still report the old one). */
  force?: PlaybackStatus;
  /** Emit even if status and song did not change (seeks). */
  emit?: boolean;
}

export class MusicKitPlayer implements MusicPlayer {
  readonly available = true;

  private readonly clock: Clock;
  private readonly listeners = new Listeners<PlaybackState>();
  private readonly songs = new Map<string, Song>();
  private readonly slot = new PauseSlot();
  private readonly poller: PausePoller;
  private readonly subscriptions: { remove(): void }[];
  private current: PlaybackState;
  private rate = 1;

  constructor(
    private readonly native: MusicKitNative,
    opts: MusicKitPlayerOptions = {},
  ) {
    this.clock = opts.clock ?? systemClock;
    this.poller = new PausePoller({ timers: opts.timers });
    this.current = { status: 'idle', song: null, positionMs: 0, at: this.clock.now() };
    this.subscriptions = [
      native.addListener('onPlaybackState', (state) => this.applyNative(state)),
      native.addListener('onPlaybackTime', (event) => this.applyTime(event)),
      native.addListener('onScheduledPause', (event) => this.onScheduledPause(event)),
    ];
  }

  /** Stops listening to the module (tests, or a container being replaced). */
  dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.length = 0;
    this.cancelPause('cleared');
  }

  async authorize(): Promise<MusicAuthorization> {
    const now = mapAuthorization(this.native.authorizationStatus());
    if (now !== 'notDetermined') return now;
    try {
      return mapAuthorization(await this.native.requestAuthorization());
    } catch (error) {
      throw toMusicPlayerError(error);
    }
  }

  async authorizationStatus(): Promise<MusicAuthorization> {
    return mapAuthorization(this.native.authorizationStatus());
  }

  async subscriptionStatus(): Promise<MusicSubscription> {
    try {
      const s = await this.native.subscription();
      return { canPlayCatalog: !!s.canPlayCatalog, hasCloudLibrary: !!s.hasCloudLibrary, canSubscribe: !!s.canSubscribe };
    } catch (error) {
      throw toMusicPlayerError(error);
    }
  }

  async librarySongs(query: LibraryQuery = {}): Promise<Song[]> {
    this.requireAuthorized();
    const limit = Math.max(1, Math.floor(query.limit ?? 25));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const text = query.query?.trim() || null;
    let found: NativeSong[];
    try {
      found = await this.native.librarySongs(text, query.order ?? 'recentlyAdded', limit, offset);
    } catch (error) {
      throw toMusicPlayerError(error);
    }
    return found.filter((song) => song.playable !== false).map((song) => this.remember(mapSong(song)));
  }

  async play(songId: string): Promise<void> {
    this.requireAuthorized();
    this.cancelPause('song-changed');
    this.set({ status: 'loading', song: this.songs.get(songId) ?? null, positionMs: 0 });
    let result: NativePlaybackState;
    try {
      result = await this.native.play(songId);
    } catch (error) {
      await this.resync();
      throw toMusicPlayerError(error);
    }
    this.applyNative(result, { force: 'playing', emit: true });
  }

  async pause(): Promise<void> {
    if (this.state().status !== 'playing') return;
    const result = await this.call(() => this.native.pause());
    this.applyNative(result, { force: 'paused' });
  }

  async resume(): Promise<void> {
    if (this.state().status !== 'paused') return;
    const result = await this.call(() => this.native.resume());
    this.applyNative(result, { force: 'playing' });
  }

  async seek(ms: number): Promise<void> {
    const song = this.current.song;
    if (!song) return;
    const upper = song.durationMs > 0 ? song.durationMs : Number.POSITIVE_INFINITY;
    const target = Math.max(0, Math.min(upper, ms));
    const wasEnded = this.state().status === 'ended';
    this.cancelPause('seeked');
    const result = await this.call(() => this.native.seek(target / 1000));
    this.applyNative(result, { force: wasEnded ? 'paused' : undefined, emit: true });
  }

  positionMs(): number {
    const { status, song, positionMs, at } = this.current;
    if (status !== 'playing' || !song) return positionMs;
    const extrapolated = positionMs + Math.max(0, this.clock.now() - at) * this.rate;
    return song.durationMs > 0 ? Math.min(song.durationMs, extrapolated) : extrapolated;
  }

  nowPlaying(): Song | null {
    return this.current.song;
  }

  state(): PlaybackState {
    return this.current;
  }

  onStateChange(listener: (state: PlaybackState) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  async pauseAt(ms: number, opts?: PauseAtOptions): Promise<PauseAtResult> {
    const targetMs = pauseTarget(ms, opts);
    const decision = decidePause({ ...this.current, positionMs: this.positionMs() }, targetMs);
    if (decision.kind === 'arm') {
      const { token, promise } = this.slot.arm(targetMs);
      if (this.native.schedulePause) {
        this.native.schedulePause(token, targetMs / 1000);
      } else {
        void this.poller.arm(this.pollTarget, targetMs).then((positionMs) => {
          if (positionMs !== null) this.slot.fire(token, positionMs);
        });
      }
      return promise;
    }
    this.cancelPause('replaced');
    if (decision.kind === 'cancel') return { outcome: 'cancelled', targetMs, reason: decision.reason };
    if (decision.kind === 'pause-now') await this.pause();
    return { outcome: 'paused', targetMs, positionMs: this.positionMs() };
  }

  clearPauseAt(): void {
    this.cancelPause('cleared');
  }

  private readonly pollTarget: PausePollTarget = {
    positionMs: () => this.positionMs(),
    isPlaying: () => this.current.status === 'playing',
    pause: () => this.pause(),
  };

  private cancelPause(reason: Parameters<PauseSlot['cancel']>[0]): void {
    if (!this.slot.cancel(reason)) return;
    this.native.cancelScheduledPause?.();
    this.poller.cancel();
  }

  private onScheduledPause(event: NativeScheduledPauseEvent): void {
    const armed = this.slot.current();
    if (!armed || armed.token !== event.token) return;
    if (event.missed) {
      this.slot.cancel('past-target');
      return;
    }
    const positionMs = msOf(event.positionSec);
    if (this.current.song) this.set({ status: 'paused', song: this.current.song, positionMs });
    this.slot.fire(event.token, positionMs);
  }

  private applyTime(event: NativeTimeEvent): void {
    const { status, song } = this.current;
    if (!song || status !== 'playing' || playbackStatusOf(event.status) !== 'playing') return;
    this.current = { ...this.current, positionMs: msOf(event.positionSec), at: this.clock.now() };
  }

  private applyNative(native: NativePlaybackState, opts: ApplyOptions = {}): void {
    const previous = this.current;
    const song = this.songFor(native);
    let positionMs = msOf(native.positionSec);
    let status: PlaybackStatus = song ? (opts.force ?? playbackStatusOf(native.status)) : 'idle';
    if (song && !opts.force && status !== 'playing' && previous.song?.id === song.id) {
      const reachedEnd =
        previous.status === 'playing' && song.durationMs > 0 && this.positionMs() >= song.durationMs - END_SLACK_MS;
      if (reachedEnd || previous.status === 'ended') {
        status = 'ended';
        positionMs = song.durationMs;
      }
    }
    if (status === 'playing') this.rate = native.rate > 0 ? native.rate : 1;
    const changed = status !== previous.status || song?.id !== previous.song?.id;
    this.current = { status, song, positionMs, at: this.clock.now() };
    if (status === 'ended') this.cancelPause('ended');
    if (changed || opts.emit) this.listeners.emit(this.current);
  }

  private songFor(native: NativePlaybackState): Song | null {
    if (!native.songId) return null;
    if (native.song) return this.remember(mapSong(native.song));
    return this.songs.get(native.songId) ?? (this.current.song?.id === native.songId ? this.current.song : null);
  }

  private remember(song: Song): Song {
    this.songs.set(song.id, song);
    return song;
  }

  private set(state: Omit<PlaybackState, 'at'>): void {
    this.current = { ...state, at: this.clock.now() };
    this.listeners.emit(this.current);
  }

  /** After a failed play(): whatever the module now holds (usually nothing). */
  private async resync(): Promise<void> {
    try {
      this.applyNative(await this.native.playbackState(), { emit: true });
    } catch {
      this.set({ status: 'idle', song: null, positionMs: 0 });
    }
  }

  private async call(fn: () => Promise<NativePlaybackState>): Promise<NativePlaybackState> {
    try {
      return await fn();
    } catch (error) {
      throw toMusicPlayerError(error);
    }
  }

  private requireAuthorized(): void {
    if (mapAuthorization(this.native.authorizationStatus()) !== 'authorized') throw new MusicPlayerError('not-authorized');
  }
}
