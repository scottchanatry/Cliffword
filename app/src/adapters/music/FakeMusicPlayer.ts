/**
 * MusicPlayer for tests: a scripted library and a position driven by the injected clock
 * (use a FakeClock and advance it). When the position reaches the end of the song, the next
 * read (positionMs, state, nowPlaying, or tick()) moves the status to 'ended' and reports it.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { Listeners, type Unsubscribe } from '../listeners';
import {
  MusicPlayerError,
  type LibraryQuery,
  type MusicAuthorization,
  type MusicPlayer,
  type MusicSubscription,
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

  constructor(opts: FakeMusicPlayerOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.songs = opts.songs ?? FAKE_SONGS;
    this.authorization = opts.authorization ?? 'notDetermined';
    this.authorizeResult = opts.authorizeResult ?? 'authorized';
    this.subscription = opts.subscription ?? { canPlayCatalog: true, hasCloudLibrary: true, canSubscribe: false };
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
    return this.songs.filter((s) => !q || fold(s.title).includes(q) || fold(s.artist).includes(q)).slice(0, limit);
  }

  async play(songId: string): Promise<void> {
    this.requireAuthorized();
    const song = this.songs.find((s) => s.id === songId);
    if (!song) throw new MusicPlayerError('not-found', `No song with id ${songId}`);
    this.played.push(songId);
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
    if (status === 'playing' && song && this.positionNow() >= song.durationMs) {
      this.set({ status: 'ended', song, positionMs: song.durationMs });
    }
  }

  private set(state: Omit<PlaybackState, 'at'>): void {
    this.current = { ...state, at: this.clock.now() };
    this.listeners.emit(this.current);
  }

  private requireAuthorized(): void {
    if (this.authorization !== 'authorized') throw new MusicPlayerError('not-authorized');
  }
}
