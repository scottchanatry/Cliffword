/**
 * Cliffword's Apple Music module (app/modules/cliffword-music, iOS only, autolinked from
 * ./modules): MusicKit library browsing, ApplicationMusicPlayer playback and a native timer that
 * pauses at the end of a lyric line. src/adapters/music/MusicKitPlayer.ts wraps it behind the
 * app's MusicPlayer contract; only src/adapters/music/createNativeMusicPlayer.ts imports this
 * file (its .web.ts twin keeps the module out of the web bundle).
 *
 * The export is null where the binary has no such module: Android, a build from before it
 * existed, and Jest. Times are in seconds here; the adapter converts to ms.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

export type NativeMusicAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'restricted';

export type NativeLibraryOrder = 'recentlyAdded' | 'recentlyPlayed' | 'title';

/** MusicKit's playback status; 'stopped' also means no song loaded. */
export type NativePlaybackStatus = 'playing' | 'paused' | 'stopped' | 'interrupted' | 'seeking';

/** A library song. Missing optional fields come as undefined (the Swift side leaves nil out). */
export interface NativeSong {
  /** Library id, as play() takes it. */
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  durationSec?: number | null;
  /** MusicKit artwork URL (300 px); library items can carry a non-http scheme. */
  artworkUrl?: string | null;
  explicit: boolean;
  isrc?: string | null;
  genre?: string | null;
  /** False when the song has no play parameters (for example a cloud item not available here). */
  playable: boolean;
}

export interface NativeSubscription {
  canPlayCatalog: boolean;
  hasCloudLibrary: boolean;
  canSubscribe: boolean;
}

export interface NativePlaybackState {
  status: NativePlaybackStatus;
  positionSec: number;
  rate: number;
  /** The song play() loaded, or absent when none is. */
  songId?: string | null;
  song?: NativeSong | null;
}

export interface NativeTimeEvent {
  positionSec: number;
  status: NativePlaybackStatus;
}

export interface NativeScheduledPauseEvent {
  /** The token passed to schedulePause(). */
  token: number;
  targetSec: number;
  positionSec: number;
  /** True when the position was already well past the target (an outside seek): nothing was paused. */
  missed: boolean;
}

export type CliffwordMusicEvents = {
  onPlaybackState: (state: NativePlaybackState) => void;
  onPlaybackTime: (event: NativeTimeEvent) => void;
  onScheduledPause: (event: NativeScheduledPauseEvent) => void;
};

export { MUSIC_ERROR_CODES } from './codes';

export declare class CliffwordMusicModule extends NativeModule<CliffwordMusicEvents> {
  authorizationStatus(): NativeMusicAuthorization;
  requestAuthorization(): Promise<NativeMusicAuthorization>;
  subscription(): Promise<NativeSubscription>;
  librarySongs(query: string | null, order: NativeLibraryOrder, limit: number, offset: number): Promise<NativeSong[]>;
  play(songId: string): Promise<NativePlaybackState>;
  pause(): Promise<NativePlaybackState>;
  resume(): Promise<NativePlaybackState>;
  seek(positionSec: number): Promise<NativePlaybackState>;
  playbackState(): Promise<NativePlaybackState>;
  /** onPlaybackTime interval while playing, ms (0 turns it off). Default 250. */
  setTimeUpdateInterval(ms: number): void;
  /** Arms the native line-end pause (one at a time; a new token replaces the old one). */
  schedulePause(token: number, targetSec: number): void;
  cancelScheduledPause(): void;
}

const CliffwordMusic: CliffwordMusicModule | null = requireOptionalNativeModule<CliffwordMusicModule>('CliffwordMusic');

export default CliffwordMusic;
