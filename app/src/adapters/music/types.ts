/**
 * Apple Music through MusicKit: the learner's library and playback, for lyric cliffs and
 * sing-backs. Spotify is share-in only (see ../share).
 *
 * Implementations:
 * - FakeMusicPlayer: a scripted library and a clock-driven position; for tests.
 * - UnsupportedMusicPlayer: web and Android. authorize() and subscriptionStatus() return
 *   'unsupported'; everything else rejects with MusicPlayerError('unsupported').
 * - A MusicKit adapter over @lomray/react-native-apple-music (later stage), iOS only.
 *
 * The app calls authorize() first and only uses the library and playback when it returns
 * 'authorized'.
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

export interface LibraryQuery {
  /** Matches title or artist, ignoring case and accents. All songs when omitted. */
  query?: string;
  /** Default 25. */
  limit?: number;
}

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
}
