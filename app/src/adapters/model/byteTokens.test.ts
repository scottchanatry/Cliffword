import fs from 'fs';
import path from 'path';
import type { TokenScore } from '@cliffword/engine';
import { checkTokenScores } from '../../../../engine/src/model/http';
import { checkScores, isWholePiece, tokenScoresFromBytes, utf8Boundaries, utf8ByteLength, type ByteRangeToken } from './byteTokens';

const enc = new TextEncoder();

/** Byte-range tokens for the given pieces (strings or raw byte arrays) with logprobs. */
function bytesOf(pieces: (string | number[])[], logprobs: number[]): ByteRangeToken[] {
  let off = 0;
  return pieces.map((p, i) => {
    const n = typeof p === 'string' ? enc.encode(p).length : p.length;
    const t = { byte_start: off, byte_end: off + n, logprob: logprobs[i] as number };
    off += n;
    return t;
  });
}

describe('utf8Boundaries', () => {
  it('maps byte offsets of character boundaries to UTF-16 indices', () => {
    const { boundaries, bytes } = utf8Boundaries(' ñ🌞a');
    // ' ' 1 byte, 'ñ' 2 bytes, '🌞' 4 bytes (2 UTF-16 units), 'a' 1 byte
    expect(bytes).toBe(8);
    expect([...boundaries.entries()]).toEqual([
      [0, 0],
      [1, 1],
      [3, 2],
      [7, 4],
      [8, 5],
    ]);
    expect(utf8ByteLength('niño')).toBe(5);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('tokenScoresFromBytes', () => {
  it('keeps whole-character tokens and turns byte offsets into string offsets', () => {
    const text = 'El niño está';
    const toks = tokenScoresFromBytes(text, bytesOf(['El', ' niño', ' está'], [-1, -2, -3]));
    expect(toks).toEqual([
      { text: 'El', start: 0, end: 2, logprob: -1 },
      { text: ' niño', start: 2, end: 7, logprob: -2 },
      { text: ' está', start: 7, end: 12, logprob: -3 },
    ]);
  });

  it('keeps the leading space on the token that starts a word', () => {
    expect(tokenScoresFromBytes(' mercado', bytesOf([' mercado'], [-5.6]))).toEqual([
      { text: ' mercado', start: 0, end: 8, logprob: -5.6 },
    ]);
  });

  it('merges tokens that end inside a character and sums their logprobs (ñ split in two bytes)', () => {
    // " ñandú" as Qwen3 cuts it: " \xc3" + "\xb1" + "and" + "ú"
    const text = ' ñandú';
    const toks = tokenScoresFromBytes(text, bytesOf([[0x20, 0xc3], [0xb1], 'and', 'ú'], [-1, -0.5, -2, -0.25]));
    expect(toks).toEqual([
      { text: ' ñ', start: 0, end: 2, logprob: -1.5 },
      { text: 'and', start: 2, end: 5, logprob: -2 },
      { text: 'ú', start: 5, end: 6, logprob: -0.25 },
    ]);
  });

  it('merges an emoji cut into four byte tokens into one token of two UTF-16 units', () => {
    const text = 'sol 🌞!';
    const sun = Array.from(enc.encode('🌞'));
    const toks = tokenScoresFromBytes(
      text,
      bytesOf(['sol', [0x20, sun[0] as number], [sun[1] as number], [sun[2] as number], [sun[3] as number], '!'], [-1, -0.1, -0.2, -0.3, -0.4, -2]),
    );
    expect(toks.map((t) => [t.text, t.start, t.end])).toEqual([
      ['sol', 0, 3],
      [' 🌞', 3, 6],
      ['!', 6, 7],
    ]);
    expect(toks[1]!.logprob).toBeCloseTo(-1.0, 12);
    expect(toks.map((t) => t.text).join('')).toBe(text);
  });

  it('marks a merged token as an upper bound when any part is one', () => {
    const text = 'ñ';
    const toks = tokenScoresFromBytes(text, [
      { byte_start: 0, byte_end: 1, logprob: -1, upperBound: true },
      { byte_start: 1, byte_end: 2, logprob: -2 },
    ]);
    expect(toks).toEqual([{ text: 'ñ', start: 0, end: 1, logprob: -3, upperBound: true }]);
  });

  it('carries -Infinity through', () => {
    expect(tokenScoresFromBytes('a', [{ byte_start: 0, byte_end: 1, logprob: -Infinity }])[0]!.logprob).toBe(-Infinity);
  });

  it('rejects gaps, overlaps, short coverage and a cut last character', () => {
    expect(() => tokenScoresFromBytes('ab', [{ byte_start: 1, byte_end: 2, logprob: -1 }])).toThrow(/starts at byte 1/);
    expect(() => tokenScoresFromBytes('ab', bytesOf(['a'], [-1]))).toThrow(/cover 1 of 2 bytes/);
    expect(() => tokenScoresFromBytes('ñ', bytesOf([[0xc3]], [-1]))).toThrow(/end inside a character/);
    expect(() => tokenScoresFromBytes('a', [{ byte_start: 0, byte_end: 0, logprob: -1 }])).toThrow(/empty/);
    expect(() => tokenScoresFromBytes('a', [{ byte_start: 0, byte_end: 3, logprob: -1 }])).toThrow(/past the text/);
    expect(tokenScoresFromBytes('', [])).toEqual([]);
  });
});

describe('checkScores', () => {
  it('accepts what the engine accepts and clamps rounding above 0', () => {
    const toks: TokenScore[] = [{ text: 'a', start: 0, end: 1, logprob: 1e-9 }];
    expect(checkScores('a', toks)[0]!.logprob).toBe(0);
    expect(() => checkScores('ab', [{ text: 'a', start: 0, end: 1, logprob: -1 }])).toThrow(/cover 1 of 2/);
    expect(() => checkScores('a', [{ text: 'a', start: 0, end: 1, logprob: 0.5 }])).toThrow(/> 0/);
    expect(() => checkScores('a', [{ text: 'a', start: 0, end: 1, logprob: NaN }])).toThrow(/NaN/);
  });
});

describe('isWholePiece', () => {
  it('skips empty pieces, sanitized partial characters and llama.rn byte displays', () => {
    expect(isWholePiece(' se')).toBe(true);
    expect(isWholePiece('ñ')).toBe(true);
    expect(isWholePiece('')).toBe(false);
    expect(isWholePiece('�')).toBe(false);
    expect(isWholePiece('byte: \\xc3')).toBe(false);
  });
});

/**
 * Real output of the native scorer (CliffwordScore.cpp on Qwen3-1.7B-Q4_K_M), recorded by
 * native-tests/scoring/compare.py: raw byte-range tokens, their merged form (model_server.py's
 * rule, computed in Python) and proof/model_server.py's own answer.
 */
describe('Qwen3 fixture from the native scorer', () => {
  interface FixtureCase {
    label: string;
    context: string;
    text: string;
    raw: { id: number; byte_start: number; byte_end: number; logprob: number }[];
    expected: TokenScore[];
    server: TokenScore[];
  }
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'qwen3-native-scores.json'), 'utf8')) as {
    cases: FixtureCase[];
  };

  it('has cases with split characters, emoji, a leading space and an empty context', () => {
    const labels = fixture.cases.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['leading space', 'leading space, ñ', 'emoji, ¡', 'empty context', 'split UTF-8 tokens']));
    expect(fixture.cases.some((c) => c.raw.length > c.expected.length)).toBe(true);
  });

  it.each(fixture.cases.map((c) => [c.label, c] as const))('%s: converts like model_server.py', (_label, c) => {
    const toks = tokenScoresFromBytes(c.text, c.raw);
    // Same segmentation and offsets as the Python merge and as the server.
    expect(toks.map((t) => [t.text, t.start, t.end])).toEqual(c.expected.map((t) => [t.text, t.start, t.end]));
    expect(toks.map((t) => [t.text, t.start, t.end])).toEqual(c.server.map((t) => [t.text, t.start, t.end]));
    toks.forEach((t, i) => {
      expect(t.logprob).toBeCloseTo(c.expected[i]!.logprob, 10);
      expect(Math.abs(t.logprob - c.server[i]!.logprob)).toBeLessThan(1e-4);
    });
    // The engine's own validator accepts it.
    expect(checkTokenScores(c.text, toks)).toHaveLength(toks.length);
    expect(checkScores(c.text, toks)).toHaveLength(toks.length);
  });
});
