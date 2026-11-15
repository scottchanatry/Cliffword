/** Error codes on the module's rejected calls (error.code), set in CliffwordMusicModule.swift. */
export const MUSIC_ERROR_CODES = {
  notAuthorized: 'ERR_MUSIC_NOT_AUTHORIZED',
  notFound: 'ERR_MUSIC_NOT_FOUND',
  noSubscription: 'ERR_MUSIC_NO_SUBSCRIPTION',
  failed: 'ERR_MUSIC_FAILED',
} as const;
