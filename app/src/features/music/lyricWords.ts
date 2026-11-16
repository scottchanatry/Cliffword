/**
 * Words of a lyric line (or a sentence of a brought text) for drawing: the language pack's
 * segmenter through the engine's sentenceWords, never a split on spaces. Each word keeps its
 * lead and trail punctuation and its own space (spaceAfter, false in scripts without spaces),
 * and is marked where the engine's character spans fall on it: slang (underlined), explicit
 * and masked (hidden because explicit lyrics are off).
 */
import { estimateDurationMs, findSlangMatches, sentenceWords, type LanguagePack, type LyricLineView } from '@cliffword/engine';

/** A character span of the line, as the engine gives it (LyricLineView.slang / masked). */
export interface CharSpan {
  start: number;
  end: number;
}

export interface LineWord {
  /** Index among the line's word and number segments (the index EchoTile and cliffs use). */
  index: number;
  text: string;
  lead: string;
  trail: string;
  spaceAfter: boolean;
  /** Character span of the word in the line. */
  start: number;
  end: number;
  /** A slang span covers part of the word. */
  slang: boolean;
  /** That slang is explicit. */
  explicit: boolean;
  /** A masked span covers part of the word: draw it hidden. */
  masked: boolean;
  /** Spoken length at natural speed (tile width), ms. */
  durationMs: number;
}

const overlaps = (a: CharSpan, b: CharSpan) => a.start < b.end && b.start < a.end;

/**
 * The words of `text` with the given character spans laid over them. Spans come from the
 * engine (findSlangMatches offsets), so they fall on word boundaries; a span that covers
 * only part of a word marks the whole word.
 */
export function lineWords(
  pack: LanguagePack,
  text: string,
  spans: { slang?: readonly (CharSpan & { explicit?: boolean })[]; masked?: readonly CharSpan[] } = {},
): LineWord[] {
  const slang = spans.slang ?? [];
  const masked = spans.masked ?? [];
  return sentenceWords(pack, text, { register: 'street', regions: [] }).map((w) => {
    const span = { start: w.start, end: w.end };
    const hit = slang.filter((s) => overlaps(s, span));
    return {
      index: w.index,
      text: w.text,
      lead: w.lead,
      trail: w.trail,
      spaceAfter: w.spaceAfter,
      start: w.start,
      end: w.end,
      slang: hit.length > 0,
      explicit: hit.some((s) => s.explicit === true),
      masked: masked.some((s) => overlaps(s, span)),
      durationMs: estimateDurationMs(w.norm || w.text, pack, 1),
    };
  });
}

/** The words of an engine line view: its slang and masked spans laid over the words. */
export function lineViewWords(pack: LanguagePack, line: LyricLineView): LineWord[] {
  return lineWords(pack, line.text, { slang: line.slang, masked: line.masked });
}

/**
 * The line as a screen reader reads it: masked words replaced by `maskedLabel`, everything
 * else as written (punctuation and the line's own spaces kept).
 */
export function spokenLine(words: readonly LineWord[], maskedLabel: string): string {
  return words.map((w) => `${w.lead}${w.masked ? maskedLabel : w.text}${w.trail}${w.spaceAfter ? ' ' : ''}`).join('').trim();
}

/**
 * Slang spans of a raw line the engine sent without them (a cliff's previous line and the
 * text before the gap, the echo line, a register pair), from the register packs of
 * `regions` ([] or undefined: every pack). With showExplicit false the explicit ones are
 * also returned as masked, so a hidden word stays hidden on every screen.
 */
export function rawLineSpans(
  pack: LanguagePack,
  text: string,
  opts: { regions?: readonly string[]; showExplicit?: boolean } = {},
): { slang: (CharSpan & { explicit: boolean })[]; masked: CharSpan[] } {
  const matches = findSlangMatches(pack, text, { regions: opts.regions ?? [] });
  const slang = matches.map((m) => ({ start: m.start, end: m.end, explicit: m.entry.explicit }));
  const masked = opts.showExplicit === false ? slang.filter((s) => s.explicit).map(({ start, end }) => ({ start, end })) : [];
  return { slang, masked };
}

/** The words of a raw line with its slang and, when explicit lyrics are off, its explicit words masked. */
export function rawLineWords(pack: LanguagePack, text: string, opts: { regions?: readonly string[]; showExplicit?: boolean } = {}): LineWord[] {
  return lineWords(pack, text, rawLineSpans(pack, text, opts));
}
