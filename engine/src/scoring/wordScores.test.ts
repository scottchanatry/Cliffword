import { describe, expect, it } from 'vitest';
import type { Segment } from '../lang/types';
import { createMockModel } from '../model/mock';
import { TopNBoundedModel } from '../model/topN';
import { totalLogprob, type TokenScore } from '../model/types';
import {
  DEFAULT_HEAT_OPTIONS,
  alignTokensToWords,
  boundedWords,
  frequencyBaseline,
  heatFor,
  meanTokenLogprob,
  scoreWords,
  sentenceLogprob,
  wordScoresFromTokens,
} from './wordScores';
import { CountingModel, createStubPack, stubSegment } from './testStubs';

const lm = createMockModel();
const pack = createStubPack();

/** Build tokens from consecutive texts with the given logprobs. */
function toks(parts: Array<[string, number]>): TokenScore[] {
  let pos = 0;
  return parts.map(([text, logprob]) => {
    const t = { text, start: pos, end: pos + text.length, logprob };
    pos += text.length;
    return t;
  });
}

/** Segments from explicit pieces and kinds. */
function segs(parts: Array<[string, Segment['kind']]>): Segment[] {
  let pos = 0;
  return parts.map(([text, kind]) => {
    const s: Segment = { text, norm: kind === 'space' ? '' : text.toLowerCase(), start: pos, end: pos + text.length, kind };
    pos += text.length;
    return s;
  });
}

describe('alignTokensToWords', () => {
  it('merges sub-word tokens into one word (cansado = " cans" + "ado")', async () => {
    const tokens = await lm.scoreContinuation('Estoy', ' muy cansado.');
    expect(tokens.map((t) => t.text)).toEqual([' muy', ' cans', 'ado', '.']);
    const sums = alignTokensToWords(tokens, stubSegment(' muy cansado.'));
    expect(sums).toHaveLength(2);
    expect(sums[0]).toBeCloseTo(tokens[0]!.logprob, 12);
    expect(sums[1]).toBeCloseTo(tokens[1]!.logprob + tokens[2]!.logprob, 12);
  });

  it('gives a token to its word when its other characters are punctuation', () => {
    const sums = alignTokensToWords(toks([['hola.', -3]]), stubSegment('hola.'));
    expect(sums).toEqual([-3]);
  });

  it('attaches whitespace-only and punctuation-only tokens to no word', () => {
    const text = 'a  b ?';
    const tokens = toks([['a', -1], ['  ', -5], ['b', -2], [' ?', -7]]);
    expect(alignTokensToWords(tokens, stubSegment(text))).toEqual([-1, -2]);
  });

  it('splits a token spanning two words in proportion to characters', () => {
    // A pack that splits clitics: dá | me | lo, while the model has one token "melo".
    const s = segs([['dá', 'word'], ['me', 'word'], ['lo', 'word']]);
    const sums = alignTokensToWords(toks([['dá', -1], ['melo', -4]]), s);
    expect(sums).toEqual([-1, -2, -2]);
  });

  it('splits unevenly and ignores spaces inside a spanning token', () => {
    const s = stubSegment('ab cde');
    // token "b cd" covers b (word 0) and cd (word 1): 1 vs 2 non-space characters.
    const tokens: TokenScore[] = [
      { text: 'a', start: 0, end: 1, logprob: -1 },
      { text: 'b cd', start: 1, end: 5, logprob: -3 },
      { text: 'e', start: 5, end: 6, logprob: -0.5 },
    ];
    const sums = alignTokensToWords(tokens, s);
    expect(sums[0]).toBeCloseTo(-2, 12);
    expect(sums[1]).toBeCloseTo(-2.5, 12);
  });

  it('works for scripts without spaces', () => {
    // 私は学生です segmented as 私|は|学生|です; tokens 私は (2 words) and 学生です (2 words).
    const s = segs([['私', 'word'], ['は', 'word'], ['学生', 'word'], ['です', 'word']]);
    const sums = alignTokensToWords(toks([['私は', -2], ['学生です', -8]]), s);
    expect(sums).toEqual([-1, -1, -4, -4]);
  });

  it('clamps -Infinity and NaN token logprobs to the floor', () => {
    const sums = alignTokensToWords(toks([['a', -Infinity], [' b', Number.NaN]]), stubSegment('a b'), -50);
    expect(sums).toEqual([-50, -50]);
  });

  it('tolerates token offsets beyond the text and empty inputs', () => {
    const s = stubSegment('ab');
    // Characters past the last segment belong to no word, so the token stays with "ab".
    expect(alignTokensToWords([{ text: 'abc', start: 0, end: 3, logprob: -3 }], s)).toEqual([-3]);
    expect(alignTokensToWords([{ text: 'b', start: -1, end: 2, logprob: -1 }], s)).toEqual([-1]);
    expect(alignTokensToWords([], s)).toEqual([0]);
    expect(alignTokensToWords(toks([['.', -1]]), stubSegment('.'))).toEqual([]);
  });
});

describe('heatFor', () => {
  const th = [4, 7, 10] as const;
  it('counts thresholds reached', () => {
    expect(heatFor(0, th)).toBe(0);
    expect(heatFor(3.99, th)).toBe(0);
    expect(heatFor(4, th)).toBe(1);
    expect(heatFor(6.9, th)).toBe(1);
    expect(heatFor(7, th)).toBe(2);
    expect(heatFor(10, th)).toBe(3);
    expect(heatFor(Infinity, th)).toBe(3);
  });

  it('maps NaN and negative surprisal to 0', () => {
    expect(heatFor(Number.NaN, th)).toBe(0);
    expect(heatFor(-3, th)).toBe(0);
  });

  it('has ascending defaults', () => {
    const [a, b, c] = DEFAULT_HEAT_OPTIONS.thresholds;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe('scoreWords', () => {
  it('scores each word with merged pieces and leaves punctuation out', async () => {
    const ws = await scoreWords(lm, pack, 'Estoy', ' muy cansado.');
    expect(ws.map((w) => w.segment.text)).toEqual(['muy', 'cansado']);
    expect(ws.map((w) => w.wordIndex)).toEqual([0, 1]);
    for (const w of ws) {
      expect(w.surprisal).toBeCloseTo(-w.logprob, 12);
      expect(w.heat).toBe(0);
    }
  });

  it('uses exactly one model call', async () => {
    const m = new CountingModel(lm);
    await scoreWords(m, pack, '', 'Marta empezó a leer la nota.');
    expect(m.scoreCalls).toBe(1);
    expect(m.nextCalls).toBe(0);
  });

  it('returns [] without calling the model for empty or punctuation-only text', async () => {
    const m = new CountingModel(lm);
    expect(await scoreWords(m, pack, 'Hola', '')).toEqual([]);
    expect(await scoreWords(m, pack, 'Hola', ' ¿?!...')).toEqual([]);
    expect(await scoreWords(m, pack, 'Hola', '   ')).toEqual([]);
    expect(m.totalCalls).toBe(0);
  });

  it('handles accents and inverted punctuation', async () => {
    const ws = await scoreWords(lm, pack, '', '¿Dónde estás?');
    expect(ws.map((w) => w.segment.norm)).toEqual(['dónde', 'estás']);
    const tokens = await lm.scoreContinuation('', '¿Dónde estás?');
    // The "¿" token belongs to no word.
    expect(ws[0]!.logprob).toBeCloseTo(tokens[1]!.logprob, 12);
  });

  it('shades words with missing accents more than the accented words', async () => {
    const good = await scoreWords(lm, pack, '', '¿Dónde estás?');
    const bad = await scoreWords(lm, pack, '', '¿Donde estas?');
    expect(bad[0]!.surprisal).toBeGreaterThan(good[0]!.surprisal);
    expect(bad[1]!.heat).toBeGreaterThan(good[1]!.heat);
  });

  it("scores clipped street forms ('tá, pa') as single words", async () => {
    const text = "El corillo ya 'tá listo pa' bailar.";
    const ws = await scoreWords(lm, pack, '', text);
    expect(ws.map((w) => w.segment.text)).toEqual(['El', 'corillo', 'ya', "'tá", 'listo', "pa'", 'bailar']);
    const tokens = await lm.scoreContinuation('', text);
    const ta = tokens.find((t) => t.text === " 'tá")!;
    expect(ws[3]!.logprob).toBeCloseTo(ta.logprob, 12);
    expect(ws.every((w) => w.heat === 0)).toBe(true);
  });

  it('gives unknown words the highest heat', async () => {
    const ws = await scoreWords(lm, pack, '', 'Marta empezó a xyzzy la nota.');
    expect(ws[3]!.segment.text).toBe('xyzzy');
    expect(ws[3]!.heat).toBe(3);
    expect(ws[0]!.heat).toBe(0);
    expect(ws[1]!.heat).toBe(0);
  });

  it('keeps the capitalized sentence start in the segment and lowercases its norm', async () => {
    const ws = await scoreWords(lm, pack, '', 'Estoy cansado.');
    expect(ws[0]!.segment.text).toBe('Estoy');
    expect(ws[0]!.segment.norm).toBe('estoy');
    expect(ws[0]!.heat).toBe(0);
  });

  it('depends on the context', async () => {
    const after = await scoreWords(lm, pack, 'Estoy muy', ' cansado');
    const other = await scoreWords(lm, pack, 'Marta empezó a', ' cansado');
    expect(after[0]!.logprob).toBeGreaterThan(other[0]!.logprob);
  });

  it('skips numbers when indexing words', async () => {
    const ws = await scoreWords(lm, pack, '', 'Compró 3 manzanas.');
    expect(ws.map((w) => [w.segment.text, w.wordIndex])).toEqual([
      ['Compró', 0],
      ['manzanas', 1],
    ]);
  });

  it('applies custom thresholds', async () => {
    const ws = await scoreWords(lm, pack, 'Estoy', ' muy cansado.', { thresholds: [0.001, 0.002, 0.003] });
    expect(ws.every((w) => w.heat === 3)).toBe(true);
  });

  it('subtracts the baseline before applying thresholds', async () => {
    const text = 'Marta empezó a xyzzy.';
    const plain = await scoreWords(lm, pack, '', text);
    const relieved = await scoreWords(lm, pack, '', text, { baseline: (norm) => (norm === 'xyzzy' ? 12 : 0) });
    expect(relieved[3]!.heat).toBeLessThan(plain[3]!.heat);
    // surprisal itself is not changed by the baseline
    expect(relieved[3]!.surprisal).toBeCloseTo(plain[3]!.surprisal, 12);
    const harsher = await scoreWords(lm, pack, '', text, { baseline: (norm) => (norm === 'marta' ? -20 : 0) });
    expect(harsher[0]!.heat).toBe(3);
    const ignored = await scoreWords(lm, pack, '', text, { baseline: () => Number.NaN });
    expect(ignored.map((w) => w.heat)).toEqual(plain.map((w) => w.heat));
  });
});

describe('wordScoresFromTokens', () => {
  it('passes the segment to the baseline hook', () => {
    const seen: string[] = [];
    wordScoresFromTokens(toks([['hola', -1], [' mundo', -2]]), stubSegment('hola mundo'), {
      baseline: (norm, seg) => {
        seen.push(`${norm}@${seg.start}`);
        return 0;
      },
    });
    expect(seen).toEqual(['hola@0', 'mundo@5']);
  });

  it('reports a surprisal of +0 for a certain word', () => {
    const [w] = wordScoresFromTokens(toks([['hola', 0]]), stubSegment('hola'));
    expect(Object.is(w!.surprisal, 0)).toBe(true);
  });
});

describe('frequencyBaseline', () => {
  const base = frequencyBaseline(pack);

  it('is 0 for common lemmas and unknown words', () => {
    expect(base('el', undefined as never)).toBe(0);
    expect(base('muy', undefined as never)).toBe(0);
    expect(base('xyzzy', undefined as never)).toBe(0);
  });

  it('grows with the log rank of the lemma found by analyze', () => {
    // cansada -> lemma cansado, rank 2000: 0.5 * ln(2000 / 500)
    expect(base('cansada', undefined as never)).toBeCloseTo(0.5 * Math.log(4), 12);
    expect(base('llorar', undefined as never)).toBeGreaterThan(base('cansada', undefined as never));
  });

  it('respects options and the cap', () => {
    const steep = frequencyBaseline(pack, { natsPerLogRank: 10, maxBaseline: 3 });
    expect(steep('llorar', undefined as never)).toBe(3);
    const none = frequencyBaseline(pack, { commonRank: 10_000 });
    expect(none('llorar', undefined as never)).toBe(0);
  });
});

describe('sentenceLogprob', () => {
  it('equals the sum of token logprobs', async () => {
    const tokens = await lm.scoreContinuation('', 'Estoy muy cansado.');
    expect(await sentenceLogprob(lm, '', 'Estoy muy cansado.')).toBeCloseTo(totalLogprob(tokens), 12);
  });

  it('prefers the grammatical sentence', async () => {
    expect(await sentenceLogprob(lm, '', 'Estoy cansado.')).toBeGreaterThan(await sentenceLogprob(lm, '', 'Soy cansado.'));
  });

  it('stays finite when a token has probability zero', async () => {
    // " cans" is not a whole word, so the full stop after it gets -Infinity from the mock.
    const raw = await lm.scoreContinuation('Marta empezó a', ' cans.');
    expect(raw[1]!.logprob).toBe(-Infinity);
    const lp = await sentenceLogprob(lm, 'Marta empezó a', ' cans.', -100);
    expect(lp).toBeCloseTo(raw[0]!.logprob - 100, 9);
  });

  it('is 0 for empty text', async () => {
    expect(await sentenceLogprob(lm, 'Hola', '')).toBe(0);
  });
});

describe('meanTokenLogprob', () => {
  it('averages token logprobs', () => {
    expect(meanTokenLogprob(toks([['a', -1], ['b', -3]]))).toBe(-2);
  });

  it('is 0 for no tokens and clamps -Infinity', () => {
    expect(meanTokenLogprob([])).toBe(0);
    expect(meanTokenLogprob(toks([['a', -Infinity], ['b', 0]]), -10)).toBe(-5);
  });
});

describe('bounded tokens (top-N runtime)', () => {
  /** Like toks(), with the indices of the tokens that are only upper bounds. */
  const btoks = (parts: Array<[string, number]>, bounded: number[]): TokenScore[] =>
    toks(parts).map((t, i) => (bounded.includes(i) ? { ...t, upperBound: true } : t));

  it('marks every word a bounded token contributes to, and no other', () => {
    const text = ' muy cansado ya.';
    const tokens = btoks([[' muy', -1], [' cans', -9], ['ado', -0.5], [' ya', -2], ['.', -3]], [2, 4]);
    expect(boundedWords(tokens, stubSegment(text))).toEqual([false, true, false]);
    // A bounded token split over two words marks both; a punctuation-only one marks none.
    const spanning = btoks([['ab', -1], ['c d', -4], ['!', -2]], [1, 2]);
    expect(boundedWords(spanning, stubSegment('abc d!'))).toEqual([true, true]);
    expect(boundedWords(btoks([['a', -1], [' ?', -7]], [1]), stubSegment('a ?'))).toEqual([false]);
    expect(boundedWords([], [])).toEqual([]);
  });

  it('keeps heat and surprisal as computed, and flags the word (its surprisal is a lower bound)', () => {
    const text = 'Marta lee notas.';
    const parts: Array<[string, number]> = [['Marta', -2], [' lee', -10], [' notas', -1], ['.', -0.5]];
    const exact = wordScoresFromTokens(toks(parts), stubSegment(text));
    const bounded = wordScoresFromTokens(btoks(parts, [1]), stubSegment(text));
    expect(bounded.map((w) => [w.surprisal, w.heat])).toEqual(exact.map((w) => [w.surprisal, w.heat]));
    expect(bounded.map((w) => w.bounded)).toEqual([undefined, true, undefined]);
    expect(bounded[1]!.heat).toBeGreaterThan(0);
    // Exact scores keep their shape: no bounded key at all.
    expect(exact.every((w) => !('bounded' in w))).toBe(true);
  });

  it('through TopNBoundedModel over the mock: surprisal and heat can only be lower, and only on flagged words', async () => {
    const text = 'Marta empezó a leer la nota en voz alta.';
    const exact = await scoreWords(lm, pack, '', text);
    let flagged = 0;
    for (const n of [1, 3, 10]) {
      const ws = await scoreWords(new TopNBoundedModel(lm, { n }), pack, '', text);
      expect(ws.map((w) => w.segment.text)).toEqual(exact.map((w) => w.segment.text));
      ws.forEach((w, i) => {
        const e = exact[i]!;
        if (w.bounded) {
          flagged++;
          expect(w.surprisal).toBeLessThanOrEqual(e.surprisal + 1e-9);
          expect(w.heat).toBeLessThanOrEqual(e.heat);
        } else {
          expect(w.surprisal).toBeCloseTo(e.surprisal, 12);
          expect(w.heat).toBe(e.heat);
        }
      });
    }
    expect(flagged).toBeGreaterThan(0);
    expect(await scoreWords(new TopNBoundedModel(lm, { n: 100_000 }), pack, '', text)).toEqual(exact);
  });
});
