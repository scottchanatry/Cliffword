/**
 * Width of a blank word tile from its estimated spoken length (ViewWord.durationMs, which
 * already follows the speech rate): about 0.115 dp per ms, so a two-syllable word at the
 * beginner rate (~400 ms) is ~46 dp and a one-syllable word ~23 dp, as in the B1 preview.
 * Clamped so a very short word stays visible and a long one never fills a row.
 */
export const TILE_MS_TO_DP = 0.115;
export const TILE_MIN_WIDTH = 14;
export const TILE_MAX_WIDTH = 120;

export function tileWidth(durationMs: number): number {
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  return Math.round(Math.min(TILE_MAX_WIDTH, Math.max(TILE_MIN_WIDTH, ms * TILE_MS_TO_DP)));
}
