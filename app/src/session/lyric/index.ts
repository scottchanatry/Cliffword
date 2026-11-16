/**
 * The Music tab's controller: createLyricController(deps) implements LyricController
 * (../contract.ts) over the engine's LyricSession for one song or brought text;
 * useLyricController(target) builds it for a route from useServices() and the app state
 * (shared by the routes of one song inside LyricControllersProvider).
 */
export { createLyricController, initialLyricViewModel } from './createLyricController';
export type { LyricControllerDeps, LyricControllerHandle, TimingLine } from './createLyricController';
export { LyricControllerRegistry, LyricControllersProvider, NO_LYRIC_ACTIONS, targetKey, useLyricController, useLyricControllerRegistry } from './useLyricController';
export type { UseLyricController } from './useLyricController';
export { loadLyricSource, sameSource, sessionIdFor } from './source';
export type { LoadedSource, LyricSourceState, LyricTarget } from './source';
export { lineTextOf, lyricCueForScreen, lyricHintWords } from './speech';
export { MAX_RESUME_GAP_MS, NO_PLAYBACK, TICK_MS, Track, systemTicker } from './track';
export type { SegmentOutcome, Ticker } from './track';
