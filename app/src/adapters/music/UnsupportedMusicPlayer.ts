/**
 * MusicPlayer where Apple Music cannot run (web, Android): the app shows the share-in and
 * pasted-lyrics paths instead.
 */
import type { Unsubscribe } from '../listeners';
import { MusicPlayerError, type MusicAuthorization, type MusicPlayer, type PlaybackState, type Song } from './types';

const unsupported = () => Promise.reject(new MusicPlayerError('unsupported'));

export class UnsupportedMusicPlayer implements MusicPlayer {
  readonly available = false;
  private readonly idle: PlaybackState = { status: 'idle', song: null, positionMs: 0, at: 0 };

  async authorize(): Promise<MusicAuthorization> {
    return 'unsupported';
  }

  async authorizationStatus(): Promise<MusicAuthorization> {
    return 'unsupported';
  }

  async subscriptionStatus(): Promise<'unsupported'> {
    return 'unsupported';
  }

  librarySongs(): Promise<Song[]> {
    return unsupported();
  }

  play(): Promise<void> {
    return unsupported();
  }

  pause(): Promise<void> {
    return unsupported();
  }

  resume(): Promise<void> {
    return unsupported();
  }

  seek(): Promise<void> {
    return unsupported();
  }

  positionMs(): number {
    return 0;
  }

  nowPlaying(): Song | null {
    return null;
  }

  state(): PlaybackState {
    return this.idle;
  }

  onStateChange(): Unsubscribe {
    return () => undefined;
  }
}
