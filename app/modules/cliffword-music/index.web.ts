/**
 * Web twin of index.ts: there is no Apple Music module on the web. The app never imports this
 * module there (createNativeMusicPlayer.web.ts returns UnsupportedMusicPlayer); the twin only
 * keeps an accidental import from reaching expo's native module loader.
 */
import type { CliffwordMusicModule } from './index';

export type {
  CliffwordMusicEvents,
  CliffwordMusicModule,
  NativeLibraryOrder,
  NativeMusicAuthorization,
  NativePlaybackState,
  NativePlaybackStatus,
  NativeScheduledPauseEvent,
  NativeSong,
  NativeSubscription,
  NativeTimeEvent,
} from './index';
export { MUSIC_ERROR_CODES } from './codes';

const CliffwordMusic: CliffwordMusicModule | null = null;

export default CliffwordMusic;
