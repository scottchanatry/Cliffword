/**
 * What a library row says about a song (C3: "Rayo K. · Puerto Rico · lots of slang"): where its
 * slang is heard and how much of it there is, from the engine's slang notes.
 *
 * - The summary reads every register pack the language pack holds (regions []), not only the
 *   learner's selected regions: where a song's slang comes from is a fact about the song, and a
 *   learner who picks songs needs it before choosing regions.
 * - Amount: slang occurrences (repeats counted, explicit included) per sung word. 'none' when
 *   there is no slang (the row reads "neutral Spanish"); otherwise little below SOME_SLANG, some
 *   below LOTS_OF_SLANG, lots above.
 * - Region: the region code with the most occurrences; a specific region wins a tie over the
 *   shared Caribbean pack (CARIB), and the earliest occurrence wins any other tie.
 */
import { songSlangNotes, type LanguagePack, type Lyrics, type PairPack } from '@cliffword/engine';
import type { SlangAmount, SongSummary } from '../features/music/types';

/** Slang per sung word from which a song has "some" slang (about one word in 40). */
export const SOME_SLANG = 0.025;
/** Slang per sung word from which a song has "lots of" slang (about one word in 12). */
export const LOTS_OF_SLANG = 0.08;

/** The shared pack's code: slang heard across the Caribbean. */
const SHARED_REGION = 'CARIB';

export function slangAmount(occurrences: number, words: number): SlangAmount {
  if (occurrences <= 0) return 'none';
  const density = occurrences / Math.max(1, words);
  if (density >= LOTS_OF_SLANG) return 'lots';
  if (density >= SOME_SLANG) return 'some';
  return 'little';
}

export function songSummary(lyrics: Lyrics, pack: LanguagePack, pair: PairPack): SongSummary {
  const notes = songSlangNotes(lyrics, pack, pair, { regions: [], showExplicit: true });
  const words = lyrics.lines.reduce((sum, l) => sum + l.wordCount * Math.max(1, l.repeatCount), 0);
  const occurrences = notes.reduce((sum, n) => sum + n.count, 0);
  const byRegion = new Map<string, number>();
  for (const n of notes) for (const r of n.note.regions) byRegion.set(r, (byRegion.get(r) ?? 0) + n.count);
  let region: string | null = null;
  let best = 0;
  for (const [code, count] of byRegion) {
    const better = count > best || (count === best && region === SHARED_REGION && code !== SHARED_REGION);
    if (better) {
      region = code;
      best = count;
    }
  }
  return {
    region,
    slang: slangAmount(occurrences, words),
    slangCount: occurrences,
    slangLexemes: notes.length,
    lines: lyrics.lines.length,
    explicit: notes.filter((n) => n.note.explicit).reduce((sum, n) => sum + n.count, 0),
    timed: lyrics.timed,
  };
}

/**
 * One or two letters for the library square, from the first letters of the title's first two
 * words (the pack's segmenter, never a split on spaces), skipping short connecting words when
 * the title has enough longer ones. In a script written without spaces (the first two words
 * touch) it is the first character only. Data, not interface text.
 */
export function monogram(title: string, pack: Pick<LanguagePack, 'segment'>): string {
  const words = pack.segment(title).filter((s) => s.kind === 'word' || s.kind === 'number');
  const first = (s: string) => Array.from(s)[0] ?? '';
  const [a, b] = words;
  if (!a) return first(title.trim()).toLocaleUpperCase();
  if (!b || a.end === b.start) return first(a.text).toLocaleUpperCase();
  const significant = words.filter((w) => Array.from(w.text).length > 2);
  const pick = significant.length >= 2 ? significant.slice(0, 2) : [a, b];
  return pick.map((w) => first(w.text)).join('').toLocaleUpperCase();
}
