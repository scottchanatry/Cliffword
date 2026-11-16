import type { Heat, SurpriseUnit } from '@cliffword/engine';
import type { LineWord } from '../music/lyricWords';

/**
 * Heat per word of one sentence of a brought text, from the engine's surprise map. The map's
 * word offsets are in the brought text, the sentence's words are in the sentence, so each
 * score is matched by its offset minus the unit's start. Words without a score are unshaded.
 */
export function sentenceHeat(unit: SurpriseUnit | undefined, words: readonly LineWord[]): Map<number, Heat> {
  const out = new Map<number, Heat>();
  if (!unit) return out;
  const byStart = new Map<number, Heat>();
  for (const w of unit.words) byStart.set(w.segment.start - unit.start, w.heat);
  for (const w of words) {
    const heat = byStart.get(w.start);
    if (heat !== undefined && heat > 0) out.set(w.index, heat);
  }
  return out;
}
