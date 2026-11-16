import { tKey, type CatalogKey, type Translator } from '../../i18n';

/** Region names for lists and labels ("Puerto Rico · Casual"), by register-pack region code. */
const REGION_LABELS: Readonly<Record<string, CatalogKey>> = {
  PR: tKey('region.label.PR'),
  DO: tKey('region.label.DO'),
  CU: tKey('region.label.CU'),
  CO: tKey('region.label.CO'),
  CARIB: tKey('region.label.CARIB'),
};

/** The region's name, or the code itself for a region the catalog does not name yet. */
export function regionLabel(t: Translator['t'], code: string): string {
  const key = REGION_LABELS[code];
  return key ? t(key) : code;
}

/** The most frequent region among slang notes (first seen wins a tie), or null without slang. */
export function mainRegion(notes: readonly { regions: readonly string[] }[]): string | null {
  const counts = new Map<string, number>();
  for (const n of notes) for (const r of n.regions) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [r, c] of counts) {
    if (c > bestCount) {
      best = r;
      bestCount = c;
    }
  }
  return best;
}
