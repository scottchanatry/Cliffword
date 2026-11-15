/**
 * Sing-back: compare the line the learner sang or said (speech recognition output) with
 * the lyric line, word by word, and count what landed ("6 of 7 landed").
 *
 * There is no pitch or accent score. Singer pitch cannot be read from Apple Music audio,
 * so nothing here models the singer's melody; the learner's words are compared with the
 * line's words only. Comparison is tolerant: case, punctuation, accents and apostrophes
 * never matter (speech recognition and pasted lyrics disagree about them), and in street
 * register a clipped form and its full form are the same word ("'tá" = "está", "pa'l" =
 * "para el"). Long words with one letter off (recognition spelling noise) land too.
 */
import type { LanguagePack, Register, Segment, SlangEntry } from '../lang/types';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import { alignWords, type WordEquivalent } from './align';
import { findSlangMatches, registerEquivalents } from './slang';
import { charDistance, contentSegmentsOf, looseKey, normOf, type UiText } from './text';

export type EchoStatus = 'landed' | 'missed' | 'substituted';

/**
 * How a landed word matched: exact (same normalized word), loose (only accents,
 * apostrophes or case differ), register (a clipped/full equivalent, street register),
 * near (one letter off in a long word).
 */
export type EchoVia = 'exact' | 'loose' | 'register' | 'near';

export interface EchoWord {
  /** Index among the expected line's words (word and number segments). */
  index: number;
  /** The word as written in the line. */
  text: string;
  segment: Segment;
  status: EchoStatus;
  /** Set when status is landed. */
  via?: EchoVia;
  /** What was heard in its place (landed or substituted), as recognized. */
  heard?: string;
  /** Indices of the heard words aligned to it. */
  heardIndices: number[];
  /** Part of a slang form (the tile is underlined). */
  slang: boolean;
}

export interface EchoExtra {
  /** Index among the heard words. */
  index: number;
  text: string;
  segment: Segment;
}

export interface EchoResult {
  words: EchoWord[];
  /** Heard words with no expected word (extra or repeated words). */
  extra: EchoExtra[];
  landed: number;
  missed: number;
  substituted: number;
  /** Number of words in the line. */
  total: number;
  /** "N of M landed": PairPack.ui key "echo.landed" with n and m. */
  label: UiText;
}

export interface EchoOptions {
  register: Register;
  /** Register-pack regions for street equivalences and slang underlines; [] = every pack. */
  regions: readonly string[];
  /**
   * A heard word lands as 'near' when its letter distance to the expected word is at
   * most this share of the longer word's length. 0.2 allows one letter in five or more
   * (recognition writes "corrillo" for "corillo") while words of four letters or fewer
   * must match, because there one letter makes another word (esta/este, la/lo).
   */
  nearRatio: number;
  /**
   * Alignment cost of a near pair: below a plain substitution (1) so the aligner pairs
   * near words with each other, above 0 so a true match always wins.
   */
  nearCost: number;
  /**
   * Slang kinds whose form and neutral are the same word for sing-back, in street
   * register. Clipped forms only: singing "está" for "'tá" is the line, singing "grupo"
   * for "corillo" is a different word.
   */
  equivalentKinds: readonly SlangEntry['kind'][];
  /** Combining marks folded when the pack has no foldAccents. */
  accentMarks: string;
}

export const DEFAULT_ECHO_OPTIONS: Readonly<Omit<EchoOptions, 'register'>> = {
  regions: [],
  nearRatio: 0.2,
  nearCost: 0.5,
  equivalentKinds: ['clipped'],
  accentMarks: DEFAULT_ACCENT_MARKS,
};

/** True when two keys are one small spelling slip apart (see EchoOptions.nearRatio). */
function isNear(a: string, b: string, ratio: number): boolean {
  if (ratio <= 0 || a === b) return false;
  const len = Math.max(Array.from(a).length, Array.from(b).length);
  if (len === 0) return false;
  return charDistance(a, b) / len <= ratio;
}

/**
 * Compare a sung or spoken line with the expected line.
 *
 * Method: both texts are segmented with the pack (words and numbers; never split on
 * spaces), each word gets looseKey (normalized, accents folded, apostrophes removed),
 * and the heard keys are aligned to the expected keys with alignWords: a pair costs 0
 * when the keys are equal, nearCost when they are near (see nearRatio), else 1; in
 * street register the clipped/full equivalences of the applicable register packs
 * (registerEquivalents with equivalentKinds) match at cost 0, also across word counts
 * ("pa'l" = "para el"). Every expected word is then landed (matched, equivalent or
 * near), substituted (another word in its place) or missed (nothing heard for it);
 * heard words with no place are extra. Slang underlines come from findSlangMatches.
 */
export function echoLine(
  expected: string,
  heard: string,
  pack: LanguagePack,
  opts: Partial<EchoOptions> & { register: Register },
): EchoResult {
  const o: EchoOptions = { ...DEFAULT_ECHO_OPTIONS, ...opts };
  const exp = contentSegmentsOf(pack, expected);
  const hrd = contentSegmentsOf(pack, heard);
  const expNorm = exp.map((s) => normOf(pack, s));
  const hrdNorm = hrd.map((s) => normOf(pack, s));
  const key = (n: string): string => looseKey(pack, n, o.accentMarks);
  const ek = expNorm.map(key);
  const hk = hrdNorm.map(key);

  const equivalents: WordEquivalent[] = [];
  if (o.register === 'street') {
    const seen = new Set<string>();
    for (const eq of registerEquivalents(pack, o.regions, o.equivalentKinds)) {
      const a = eq.street.map(key);
      const b = eq.neutral.map(key);
      const id = `${a.join(' ')}\u0001${b.join(' ')}`;
      if (a.join(' ') === b.join(' ') || seen.has(id)) continue;
      seen.add(id);
      equivalents.push([a, b]);
    }
  }

  const steps = alignWords(ek, hk, {
    substituteCost: (a, b) => (a === b ? 0 : isNear(a, b, o.nearRatio) ? o.nearCost : 1),
    equivalents,
  });

  const slangStarts = new Set<number>();
  for (const m of findSlangMatches(pack, expected, { regions: o.regions })) {
    for (const s of exp) if (s.start >= m.start && s.end <= m.end) slangStarts.add(s.start);
  }

  const words: EchoWord[] = exp.map((segment, index) => ({
    index,
    text: segment.text,
    segment,
    status: 'missed' as EchoStatus,
    heardIndices: [],
    slang: slangStarts.has(segment.start),
  }));
  const extra: EchoExtra[] = [];
  const heardText = (idx: readonly number[]): string => idx.map((j) => (hrd[j] as Segment).text).join(' ');

  for (const step of steps) {
    if (step.op === 'insert') {
      for (const j of step.heard) extra.push({ index: j, text: (hrd[j] as Segment).text, segment: hrd[j] as Segment });
      continue;
    }
    if (step.op === 'delete') continue; // stays missed
    for (const i of step.expected) {
      const w = words[i] as EchoWord;
      w.heardIndices = [...step.heard];
      w.heard = heardText(step.heard);
      if (step.op === 'match') {
        w.status = 'landed';
        if (step.equivalent) w.via = 'register';
        else {
          const j = step.heard[0] as number;
          w.via = expNorm[i] === hrdNorm[j] ? 'exact' : 'loose';
        }
      } else if (step.cost <= o.nearCost) {
        w.status = 'landed';
        w.via = 'near';
      } else {
        w.status = 'substituted';
      }
    }
  }

  let landed = 0;
  let missed = 0;
  let substituted = 0;
  for (const w of words) {
    if (w.status === 'landed') landed++;
    else if (w.status === 'missed') missed++;
    else substituted++;
  }
  return {
    words,
    extra,
    landed,
    missed,
    substituted,
    total: words.length,
    label: { key: 'echo.landed', params: { n: landed, m: words.length } },
  };
}
