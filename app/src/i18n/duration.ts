/**
 * Durations for display. The pattern is a catalog string ('time.clock': '{m}:{ss}'), so a
 * language can reorder or change the separator; this file only splits the number.
 */

/** Whole minutes and zero-padded seconds of `ms` (negative and non-finite values count as 0). */
export function clockParts(ms: number): { m: number; ss: string } {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return { m: Math.floor(total / 60), ss: String(total % 60).padStart(2, '0') };
}
