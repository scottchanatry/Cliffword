/**
 * Feature flags for this build. Flipping one shows code that is kept in the repo but out of the
 * test build's interface.
 *
 * - MUSIC_ENABLED: the Music tab (songs, pasted lyrics, Apple Music) and brought text. Off: no
 *   Music tab, the music and text routes redirect to the Story tab, and neither onboarding nor
 *   Settings mention music. Turning it back on also needs the cliffword-music module linked again
 *   (package.json expo.autolinking.exclude) and NSAppleMusicUsageDescription in app.json.
 * - RETELL_ENABLED: the timed retell after each episode (the engine's options.library.retell).
 */
export const MUSIC_ENABLED: boolean = false;

export const RETELL_ENABLED: boolean = false;
