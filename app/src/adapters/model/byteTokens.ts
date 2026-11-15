/**
 * From native token byte ranges to the engine's TokenScore (UTF-16 offsets).
 *
 * The native scorer (llama.rn patch, CliffwordScore.cpp) reports each token of the scored text
 * as a byte range of its UTF-8 encoding. A byte-level BPE token can end inside a multi-byte
 * character (Qwen3 splits " ñandú" as " ñ", "and", "ú", and some emoji and CJK characters into
 * single bytes). As in proof/model_server.py, a token whose range ends inside a character is
 * merged with the following token(s) and their logprobs are summed, so every returned token
 * covers whole characters, its text is an exact substring of the text, the texts concatenate
 * back to it, and start/end are JavaScript string indices (UTF-16 code units).
 */
import type { TokenScore } from '@cliffword/engine';

export interface ByteRangeToken {
  byte_start: number;
  byte_end: number;
  logprob: number;
  /** The logprob is only an upper bound (forced-decoding fallback). */
  upperBound?: boolean;
}

/** UTF-8 length of one code point (a lone surrogate counts as U+FFFD, 3 bytes, as encoders send it). */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * The UTF-8 byte offset of every character boundary of `text`, mapped to its UTF-16 index.
 * `bytes` is the UTF-8 length of the whole text.
 */
export function utf8Boundaries(text: string): { boundaries: Map<number, number>; bytes: number } {
  const boundaries = new Map<number, number>([[0, 0]]);
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const units = cp > 0xffff ? 2 : 1;
    bytes += utf8Length(cp);
    i += units;
    boundaries.set(bytes, i);
  }
  return { boundaries, bytes };
}

/** UTF-8 length of `text`. */
export function utf8ByteLength(text: string): number {
  return utf8Boundaries(text).bytes;
}

/**
 * Converts native tokens (contiguous byte ranges covering the UTF-8 of `text`, in order) into
 * TokenScores, merging tokens that end inside a character. Throws when the ranges are not
 * contiguous, do not cover the text, or the last one ends inside a character.
 */
export function tokenScoresFromBytes(text: string, tokens: readonly ByteRangeToken[]): TokenScore[] {
  const { boundaries, bytes } = utf8Boundaries(text);
  const out: TokenScore[] = [];
  let pos = 0; // byte offset where the next token must start
  let groupStart = 0; // UTF-16 index where the pending group starts
  let acc = 0;
  let bounded = false;
  let pending = false;
  tokens.forEach((t, i) => {
    if (t.byte_start !== pos) throw new Error(`token ${i} starts at byte ${t.byte_start}, expected ${pos}`);
    if (!(t.byte_end > t.byte_start)) throw new Error(`token ${i} is empty (bytes ${t.byte_start}..${t.byte_end})`);
    if (t.byte_end > bytes) throw new Error(`token ${i} ends at byte ${t.byte_end}, past the text (${bytes} bytes)`);
    pos = t.byte_end;
    acc += t.logprob;
    bounded = bounded || t.upperBound === true;
    pending = true;
    const end = boundaries.get(t.byte_end);
    if (end === undefined) return; // ends inside a character: merge with the next token
    const score: TokenScore = { text: text.slice(groupStart, end), start: groupStart, end, logprob: acc };
    if (bounded) score.upperBound = true;
    out.push(score);
    groupStart = end;
    acc = 0;
    bounded = false;
    pending = false;
  });
  if (pending) throw new Error(`the tokens of ${JSON.stringify(text)} end inside a character`);
  if (pos !== bytes) throw new Error(`the tokens cover ${pos} of ${bytes} bytes of ${JSON.stringify(text)}`);
  return out;
}

/**
 * Checks what the engine relies on (model/types.ts): non-empty token texts that are exact
 * substrings at contiguous offsets covering the text, and logprobs that are numbers <= 0 or
 * -Infinity (a tiny positive rounding error is clamped to 0). The same rules as the engine's
 * checkTokenScores (engine/src/model/http.ts). Returns the tokens; throws on the first problem.
 */
export function checkScores(text: string, tokens: TokenScore[]): TokenScore[] {
  let pos = 0;
  tokens.forEach((t, i) => {
    if (t.text === '') throw new Error(`token ${i} is empty`);
    if (t.start !== pos || t.end !== t.start + t.text.length || text.slice(t.start, t.end) !== t.text) {
      throw new Error(`token ${i} ${JSON.stringify(t.text)} at ${t.start}..${t.end} does not continue the text at ${pos}`);
    }
    if (Number.isNaN(t.logprob)) throw new Error(`token ${i} ${JSON.stringify(t.text)} has a NaN logprob`);
    if (t.logprob > 0) {
      if (t.logprob > 1e-6) throw new Error(`token ${i} ${JSON.stringify(t.text)} has logprob ${t.logprob} > 0`);
      t.logprob = 0;
    }
    pos = t.end;
  });
  if (pos !== text.length) throw new Error(`the tokens cover ${pos} of ${text.length} characters`);
  return tokens;
}

/**
 * True when `piece` (a token's text as llama.rn reports it) is whole characters: not empty, no
 * U+FFFD from a sanitized partial character, and not llama.rn's display form of a lone byte
 * ("byte: \\xc3"). Pieces that fail are skipped by nextTokens, as in model_server.py.
 */
export function isWholePiece(piece: string): boolean {
  return piece !== '' && !piece.includes('\uFFFD') && !/^byte: \\x[0-9a-f]{1,2}$/i.test(piece);
}
