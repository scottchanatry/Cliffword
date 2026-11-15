/**
 * MusicPlayer for tests: a scripted library and a position driven by the injected clock
 * (use a FakeClock and advance it). When the position reaches the end of the song, the next
 * read (positionMs, state, nowPlaying, or tick()) moves the status to 'ended' and reports it.
 *
 * pauseAt() is exact here: the read that finds the position past the target pauses at the
 * target itself. With `timers` (a live preview on the system clock) the fake also wakes itself
 * at the next target or song end, so nothing has to read it.
 *
 * Library order: 'title' sorts by title; both recency orders keep the scripted order (the fake
 * songs carry no dates).
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import { decidePause, PauseSlot, pauseTarget, type Timers } from './linePause';
import {
  MusicPlayerError,
  type LibraryQuery,
  type MusicAuthorization,
  type MusicPlayer,
  type MusicSubscription,
  type PauseAtOptions,
  type PauseAtResult,
  type PlaybackState,
  type Song,
} from './types';

export const FAKE_SONGS: readonly Song[] = [
  { id: 'fake-song-1', title: 'Canción del Mar', artist: 'Los Ejemplos', album: 'Pruebas', durationMs: 200_000 },
  { id: 'fake-song-2', title: 'Janguea Conmigo', artist: 'DJ Fixture', durationMs: 180_000, explicit: true },
  { id: 'fake-song-3', title: 'Corazón Lento', artist: 'María Demo', durationMs: 240_000 },
];

export interface FakeMusicPlayerOptions {
  clock?: Clock;
  songs?: readonly Song[];
  /** Starting authorization. Default 'notDetermined'. */
  authorization?: MusicAuthorization;
  /** What authorize() turns 'notDetermined' into. Default 'authorized'. */
  authorizeResult?: Extract<MusicAuthorization, 'authorized' | 'denied' | 'restricted'>;
  subscription?: MusicSubscription;
  /** Timers for a live fake (web preview): it wakes itself at the next pauseAt target or song end. */
  timers?: Timers;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export class FakeMusicPlayer implements MusicPlayer {
  readonly available = true;
  authorization: MusicAuthorization;
  /** Test inspection: song ids passed to play(), in order. */
  readonly played: string[] = [];

  private readonly clock: Clock;
  private readonly songs: readonly Song[];
  private readonly authorizeResult: 'authorized' | 'denied' | 'restricted';
  private readonly subscription: MusicSubscription;
  private current: PlaybackState;
  private readonly listeners = new Listeners<PlaybackState>();
  private readonly slot = new PauseSlot();
  private readonly timers: Timers | null;
  private wake: unknown = null;

  constructor(opts: FakeMusicPlayerOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.songs = opts.songs ?? FAKE_SONGS;
    this.authorization = opts.authorization ?? 'notDetermined';
    this.authorizeResult = opts.authorizeResult ?? 'authorized';
    this.subscription = opts.subscription ?? { canPlayCatalog: true, hasCloudLibrary: true, canSubscribe: false };
    this.timers = opts.timers ?? null;
    this.current = { status: 'idle', song: null, positionMs: 0, at: this.clock.now() };
  }

  async authorize(): Promise<MusicAuthorization> {
    if (this.authorization === 'notDetermined') this.authorization = this.authorizeResult;
    return this.authorization;
  }

  async authorizationStatus(): Promise<MusicAuthorization> {
    return this.authorization;
  }

  async subscriptionStatus(): Promise<MusicSubscription> {
    return this.subscription;
  }

  async librarySongs(query: LibraryQuery = {}): Promise<Song[]> {
    this.requireAuthorized();
    const q = query.query ? fold(query.query.trim()) : '';
    const limit = query.limit ?? 25;
    const offset = Math.max(0, query.offset ?? 0);
    const found = this.songs.filter((s) => !q || fold(s.title).includes(q) || fold(s.artist).includes(q));
    if (query.order === 'title') found.sort((a, b) => fold(a.title).localeCompare(fold(b.title)));
    return found.slice(offset, offset + limit);
  }

  async play(songId: string): Promise<void> {
    this.requireAuthorized();
    const song = this.songs.find((s) => s.id === songId);
    if (!song) throw new MusicPlayerError('not-found', `No song with id ${songId}`);
    this.played.push(songId);
    this.slot.cancel('song-changed');
    this.set({ status: 'playing', song, positionMs: 0 });
  }

  async pause(): Promise<void> {
    this.refresh();
    if (this.current.status !== 'playing') return;
    this.set({ ...this.current, status: 'paused', positionMs: this.positionNow() });
  }

  async resume(): Promise<void> {
    this.refresh();
    if (this.current.status !== 'paused') return;
    this.set({ ...this.current, status: 'playing' });
  }

  async seek(ms: number): Promise<void> {
    this.refresh();
    const song = this.current.song;
    if (!song) return;
    const positionMs = Math.max(0, Math.min(song.durationMs, ms));
    const status = this.current.status === 'ended' ? 'paused' : this.current.status;
    this.slot.cancel('seeked');
    this.set({ ...this.current, status, positionMs });
  }

  positionMs(): number {
    this.refresh();
    return this.positionNow();
  }

  nowPlaying(): Song | null {
    this.refresh();
    return this.current.song;
  }

  state(): PlaybackState {
    this.refresh();
    return this.current;
  }

  onStateChange(listener: (state: PlaybackState) => void): Unsubscribe {
    return this.listeners.add(listener);
  }

  async pauseAt(ms: number, opts?: PauseAtOptions): Promise<PauseAtResult> {
    this.refresh();
    const targetMs = pauseTarget(ms, opts);
    const decision = decidePause({ ...this.current, positionMs: this.positionNow() }, targetMs);
    if (decision.kind === 'arm') {
      const { promise } = this.slot.arm(targetMs);
      this.scheduleWake();
      return promise;
    }
    this.slot.cancel('replaced');
    if (decision.kind === 'cancel') return { outcome: 'cancelled', targetMs, reason: decision.reason };
    if (decision.kind === 'pause-now') await this.pause();
    return { outcome: 'paused', targetMs, positionMs: this.positionNow() };
  }

  clearPauseAt(): void {
    this.slot.cancel('cleared');
    this.scheduleWake();
  }

  /** Checks for the end of the song after the clock moved; same as any read. */
  tick(): void {
    this.refresh();
  }

  private positionNow(): number {
    const { status, song, positionMs, at } = this.current;
    if (status !== 'playing' || !song) return positionMs;
    return Math.min(song.durationMs, positionMs + (this.clock.now() - at));
  }

  private refresh(): void {
    const { status, song } = this.current;
    if (status !== 'playing' || !song) return;
    const position = this.positionNow();
    const armed = this.slot.current();
    if (armed && armed.targetMs < song.durationMs && position >= armed.targetMs) {
      this.set({ status: 'paused', song, positionMs: armed.targetMs });
      this.slot.fire(armed.token, armed.targetMs);
    } else if (position >= song.durationMs) {
      this.set({ status: 'ended', song, positionMs: song.durationMs });
      this.slot.cancel('ended');
    }
  }

  private set(state: Omit<PlaybackState, 'at'>): void {
    this.current = { ...state, at: this.clock.now() };
    this.scheduleWake();
    this.listeners.emit(this.current);
  }

  /** Live mode only: one timer for the next moment a read would change the state. */
  private scheduleWake(): void {
    const timers = this.timers;
    if (!timers) return;
    if (this.wake !== null) timers.clearTimeout(this.wake);
    this.wake = null;
    const { status, song } = this.current;
    if (status !== 'playing' || !song) return;
    const armed = this.slot.current();
    const next = armed && armed.targetMs < song.durationMs ? armed.targetMs : song.durationMs;
    this.wake = timers.setTimeout(() => {
      this.wake = null;
      this.tick();
    }, Math.max(0, next - this.positionNow()));
  }

  private requireAuthorized(): void {
    if (this.authorization !== 'authorized') throw new MusicPlayerError('not-authorized');
  }
}
