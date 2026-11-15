export type {
  LibraryOrder,
  LibraryQuery,
  MusicAuthorization,
  MusicPlayer,
  MusicPlayerErrorCode,
  MusicSubscription,
  PauseAtCancelReason,
  PauseAtOptions,
  PauseAtResult,
  PlaybackState,
  PlaybackStatus,
  Song,
} from './types';
export { MusicPlayerError, PAUSE_TOLERANCE_MS } from './types';
export { decidePause, PausePoller, PauseSlot, pauseTarget, systemTimers } from './linePause';
export type { PauseDecision, PausePollerOptions, PausePollTarget, Timers } from './linePause';
export { FAKE_SONGS, FakeMusicPlayer } from './FakeMusicPlayer';
export type { FakeMusicPlayerOptions } from './FakeMusicPlayer';
export { UnsupportedMusicPlayer } from './UnsupportedMusicPlayer';
// MusicKitPlayer and createNativeMusicPlayer stay out of this barrel: the factory imports the
// native module (modules/cliffword-music), which must not reach the web bundle.
