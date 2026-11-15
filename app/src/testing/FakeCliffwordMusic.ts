/**
 * Plays the cliffword-music native module (modules/cliffword-music) for MusicKitPlayer tests:
 * a scripted library, playback on a FakeClock (seconds, like the module), the module's events,
 * and the native line-end timer, which runs when the test calls tick().
 *
 * Test-only (src/testing is never imported by app code).
 */
import type {
  CliffwordMusicEvents,
  NativeLibraryOrder,
  NativeMusicAuthorization,
  NativePlaybackState,
  NativePlaybackStatus,
  NativeSong,
  NativeSubscription,
} from '../../modules/cliffword-music';
import type { FakeClock } from '../adapters/clock/FakeClock';
import type { MusicKitNative } from '../adapters/music/MusicKitPlayer';

export const FAKE_NATIVE_SONGS: NativeSong[] = [
  {
    id: 'i.lib1',
    title: 'Luna de Santurce',
    artist: 'Rayo K',
    album: 'Calle Loíza',
    durationSec: 201.5,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg',
    explicit: true,
    isrc: 'QZTEST2600001',
    genre: 'Reggaeton',
    playable: true,
  },
  {
    id: 'i.lib2',
    title: 'Corazón Lento',
    artist: 'María Demo',
    durationSec: 180,
    artworkUrl: 'musicKit://artwork/transient/300x300?id=abc',
    explicit: false,
    playable: true,
  },
  { id: 'i.lib3', title: 'Nube', artist: 'Sin Red', durationSec: 150, explicit: false, playable: false },
];

/** An Error with a code, as the module rejects. */
export function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

type Listener = (payload: never) => void;

export class FakeCliffwordMusic implements MusicKitNative {
  authorization: NativeMusicAuthorization = 'notDetermined';
  /** What requestAuthorization() turns 'notDetermined' into. */
  requestResult: NativeMusicAuthorization = 'authorized';
  subscriptionResult: NativeSubscription | Error = { canPlayCatalog: true, hasCloudLibrary: true, canSubscribe: false };
  songs: NativeSong[] = [...FAKE_NATIVE_SONGS];
  /** Errors the next call of a method rejects with (then cleared). */
  readonly failNext = new Map<string, Error>();
  /** Calls, in order, with their arguments. */
  readonly calls: { method: string; args: unknown[] }[] = [];
  /** The armed native line-end target. */
  scheduled: { token: number; targetSec: number } | null = null;

  status: NativePlaybackStatus = 'stopped';
  songId: string | null = null;
  private anchorSec = 0;
  private anchorAt: number;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly clock: FakeClock) {
    this.anchorAt = clock.now();
  }

  authorizationStatus(): NativeMusicAuthorization {
    this.record('authorizationStatus');
    return this.authorization;
  }

  async requestAuthorization(): Promise<NativeMusicAuthorization> {
    this.record('requestAuthorization');
    this.failIfAsked('requestAuthorization');
    if (this.authorization === 'notDetermined') this.authorization = this.requestResult;
    return this.authorization;
  }

  async subscription(): Promise<NativeSubscription> {
    this.record('subscription');
    if (this.subscriptionResult instanceof Error) throw this.subscriptionResult;
    return this.subscriptionResult;
  }

  async librarySongs(query: string | null, order: NativeLibraryOrder, limit: number, offset: number): Promise<NativeSong[]> {
    this.record('librarySongs', query, order, limit, offset);
    this.failIfAsked('librarySongs');
    const q = query?.toLowerCase() ?? '';
    return this.songs.filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)).slice(offset, offset + limit);
  }

  async play(songId: string): Promise<NativePlaybackState> {
    this.record('play', songId);
    this.failIfAsked('play');
    if (!this.songs.some((s) => s.id === songId)) throw Object.assign(new Error(`No library song with id ${songId}`), { code: 'ERR_MUSIC_NOT_FOUND' });
    this.songId = songId;
    this.anchor(0, 'playing');
    return this.snapshot();
  }

  async pause(): Promise<NativePlaybackState> {
    this.record('pause');
    this.failIfAsked('pause');
    if (this.songId) this.anchor(this.positionSec(), 'paused');
    return this.snapshot();
  }

  async resume(): Promise<NativePlaybackState> {
    this.record('resume');
    this.failIfAsked('resume');
    if (this.songId) this.anchor(this.positionSec(), 'playing');
    return this.snapshot();
  }

  async seek(positionSec: number): Promise<NativePlaybackState> {
    this.record('seek', positionSec);
    this.failIfAsked('seek');
    if (this.songId) this.anchor(Math.max(0, positionSec), this.status);
    return this.snapshot();
  }

  async playbackState(): Promise<NativePlaybackState> {
    this.record('playbackState');
    return this.snapshot();
  }

  setTimeUpdateInterval(ms: number): void {
    this.record('setTimeUpdateInterval', ms);
  }

  schedulePause(token: number, targetSec: number): void {
    this.record('schedulePause', token, targetSec);
    this.scheduled = { token, targetSec };
  }

  cancelScheduledPause(): void {
    this.record('cancelScheduledPause');
    this.scheduled = null;
  }

  addListener<E extends keyof CliffwordMusicEvents>(event: E, listener: CliffwordMusicEvents[E]): { remove(): void } {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    this.listeners.set(event, set);
    const entry = listener as unknown as Listener;
    set.add(entry);
    return { remove: () => set.delete(entry) };
  }

  listenerCount(event: keyof CliffwordMusicEvents): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** The playback position now, in seconds. */
  positionSec(): number {
    if (this.status !== 'playing') return this.anchorSec;
    return this.anchorSec + (this.clock.now() - this.anchorAt) / 1000;
  }

  snapshot(): NativePlaybackState {
    const song = this.songs.find((s) => s.id === this.songId) ?? null;
    if (!song) return { status: 'stopped', positionSec: 0, rate: 0 };
    return { status: this.status, positionSec: this.positionSec(), rate: this.status === 'playing' ? 1 : 0, songId: song.id, song };
  }

  /**
   * Runs the native line-end timer once, as the module's 10 ms checks would: pauses when the
   * position has reached the target (or reports `missed` when it is far past it).
   */
  tick(): void {
    const scheduled = this.scheduled;
    if (!scheduled || this.status !== 'playing') return;
    const position = this.positionSec();
    const remaining = scheduled.targetSec - position;
    if (remaining < -0.25) {
      this.scheduled = null;
      this.emit('onScheduledPause', { token: scheduled.token, targetSec: scheduled.targetSec, positionSec: position, missed: true });
    } else if (remaining <= 0.003) {
      this.scheduled = null;
      this.anchor(position, 'paused');
      this.emit('onScheduledPause', { token: scheduled.token, targetSec: scheduled.targetSec, positionSec: position, missed: false });
      this.emit('onPlaybackState', this.snapshot());
    }
  }

  /** Plays MusicKit's own state change (a pause from Control Center, the end of the queue, ...). */
  external(status: NativePlaybackStatus, positionSec: number = this.positionSec()): void {
    this.anchor(positionSec, status);
    this.emit('onPlaybackState', this.snapshot());
  }

  /** Sends onPlaybackTime with the current position. */
  emitTime(): void {
    this.emit('onPlaybackTime', { positionSec: this.positionSec(), status: this.status });
  }

  emit<E extends keyof CliffwordMusicEvents>(event: E, payload: Parameters<CliffwordMusicEvents[E]>[0]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as (p: typeof payload) => void)(payload);
  }

  private anchor(positionSec: number, status: NativePlaybackStatus): void {
    this.anchorSec = positionSec;
    this.anchorAt = this.clock.now();
    this.status = status;
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private failIfAsked(method: string): void {
    const error = this.failNext.get(method);
    if (!error) return;
    this.failNext.delete(method);
    throw error;
  }
}
