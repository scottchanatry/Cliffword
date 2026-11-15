/**
 * Apple Music through MusicKit: the learner's library and playback, for lyric cliffs and
 * sing-backs. Spotify is share-in only (see ../share).
 *
 * Implementations:
 * - FakeMusicPlayer: a scripted library and a clock-driven position; for tests.
 * - UnsupportedMusicPlayer: web and Android. authorize() and subscriptionStatus() return
 *   'unsupported'; everything else rejects with MusicPlayerError('unsupported').
 * - MusicKitPlayer: iOS, over the local Expo module modules/cliffword-music (MusicKit's
 *   ApplicationMusicPlayer and MusicLibraryRequest), built by createNativeMusicPlayer.
 *   @lomray/react-native-apple-music was evaluated and not used (legacy bridge module, position
 *   events once a second, no library search, no explicit flag).
 *
 * The app calls authorize() first and only uses the library and playback when it returns
 * 'authorized'.
 *
 * Lyric cliffs: pauseAt(lineEndMs) pauses playback at the end of a line, within
 * PAUSE_TOLERANCE_MS (a native timer on iOS checks the position every 10 ms near the target).
 */
import type { Unsubscribe } from '../listeners';

export type MusicAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unsupported';

export interface MusicSubscription {
  /** Can play songs from the Apple Music catalog (an active subscription). */
  canPlayCatalog: boolean;
  /** iCloud Music Library is on (library songs synced from other devices). */
  hasCloudLibrary: boolean;
  /** Could subscribe (the app may offer the subscription sheet). */
  canSubscribe: boolean;
}

export interface Song {
  /** Library or catalog id, as play() takes it. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  artworkUrl?: string;
  /** Marked explicit by Apple Music. Explicit lyrics are on by default in the app. */
  explicit?: boolean;
  /** ISRC, when MusicKit gives one (catalog songs; library songs often have none). */
  isrc?: string;
  /** The first genre name. */
  genre?: string;
}

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

/** An immutable snapshot of playback; a new object on every change. */
export interface PlaybackState {
  status: PlaybackStatus;
  song: Song | null;
  /** Position at `at`, in ms. */
  positionMs: number;
  /** Clock time (ms since epoch) when positionMs was read. */
  at: number;
}

/**
 * Library order: 'recentlyAdded' (newest first, the default), 'recentlyPlayed' (last played
 * first; never-played songs last) or 'title'.
 */
export type LibraryOrder = 'recentlyAdded' | 'recentlyPlayed' | 'title';

export interface LibraryQuery {
  /** Matches title or artist, ignoring case and accents. All songs when omitted. */
  query?: string;
  /** Default 'recentlyAdded'. */
  order?: LibraryOrder;
  /** Default 25. */
  limit?: number;
  /** Songs to skip, for paging. Default 0. */
  offset?: number;
}

/** How close to its target pauseAt() pauses on a device, in ms (the lyric-line budget). */
export const PAUSE_TOLERANCE_MS = 100;

export interface PauseAtOptions {
  /** Pause this many ms before the target (output latency, a breath before the line). Default 0. */
  leadMs?: number;
}

export type PauseAtCancelReason =
  /** clearPauseAt() */
  | 'cleared'
  /** Another pauseAt() replaced this one. */
  | 'replaced'
  /** seek() moved the position. */
  | 'seeked'
  /** play() loaded a song (the same or another). */
  | 'song-changed'
  /** The song ended first. */
  | 'ended'
  /** No song is loaded. */
  | 'no-song'
  /** The position was already more than PAUSE_TOLERANCE_MS past the target. */
  | 'past-target';

export type PauseAtResult =
  /** Paused at positionMs (within PAUSE_TOLERANCE_MS of targetMs on a device). */
  | { outcome: 'paused'; targetMs: number; positionMs: number }
  | { outcome: 'cancelled'; targetMs: number; reason: PauseAtCancelReason };

export type MusicPlayerErrorCode = 'unsupported' | 'not-authorized' | 'not-found' | 'no-subscription' | 'failed';

export class MusicPlayerError extends Error {
  readonly code: MusicPlayerErrorCode;

  constructor(code: MusicPlayerErrorCode, message?: string) {
    super(message ?? `Music player error: ${code}`);
    this.name = 'MusicPlayerError';
    this.code = code;
  }
}

export interface MusicPlayer {
  /** False where MusicKit does not exist (web, Android). */
  readonly available: boolean;
  /** Asks for Apple Music access if not decided yet; returns the result. */
  authorize(): Promise<MusicAuthorization>;
  /** Current access, without asking. */
  authorizationStatus(): Promise<MusicAuthorization>;
  subscriptionStatus(): Promise<MusicSubscription | 'unsupported'>;
  /** Songs in the learner's library. Needs 'authorized'. */
  librarySongs(query?: LibraryQuery): Promise<Song[]>;
  /** Plays the song from the start. */
  play(songId: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Moves to `ms` (clamped to the song). Keeps playing or paused. */
  seek(ms: number): Promise<void>;
  /** Current position in ms, extrapolated from the last state while playing. */
  positionMs(): number;
  /** The song loaded for playback, or null. */
  nowPlaying(): Song | null;
  /** The current playback snapshot. */
  state(): PlaybackState;
  /** Called with the new snapshot on every status, song or seek change (not on every tick). */
  onStateChange(listener: (state: PlaybackState) => void): Unsubscribe;
  /**
   * Pauses when playback reaches `ms - leadMs` (the end of a lyric line). One target at a time:
   * a new call replaces the previous one. It stays armed while the song is paused (an outside
   * pause or an interruption) and fires once playback reaches it.
   *
   * Resolves `{ outcome: 'paused', positionMs }` when it paused (or when playback was already
   * paused up to PAUSE_TOLERANCE_MS past the target), or `{ outcome: 'cancelled', reason }` when
   * something else came first (see PauseAtCancelReason). A target the position has already
   * reached, by up to PAUSE_TOLERANCE_MS, pauses at once. pause() and resume() leave the target
   * armed. Rejects only where the player is unsupported.
   */
  pauseAt(ms: number, opts?: PauseAtOptions): Promise<PauseAtResult>;
  /** Disarms pauseAt(); its promise resolves 'cancelled' with reason 'cleared'. */
  clearPauseAt(): void;
}
