import { describe, expect, it } from 'vitest';
import type { Segment } from '../lang/types';
import type { TokenScore } from '../model/types';
import { createDefaultSpanishPack } from '../packs';
import { scoringContext, scoringPrefix, slangExemption, slangIn } from './context';
import { contextStartsSentence, wordScoresFromTokens } from './wordScores';

const pack = createDefaultSpanishPack({ regions: ['PR'] });

function toks(parts: Array<[string, number]>): TokenScore[] {
  let pos = 0;
  return parts.map(([text, logprob]) => {
    const t = { text, start: pos, end: pos + text.length, logprob };
    pos += text.length;
    return t;
  });
}

describe('scoringPrefix', () => {
  it('uses the measured neutral prefix for Spanish', () => {
    expect(scoringPrefix(pack)).toBe('Frase en español:\n');
    expect(scoringContext(pack, 'Marta llegó tarde.')).toBe('Frase en español:\nMarta llegó tarde.');
  });

  it('names the given slang words in the street prefix of the first region', () => {
    const p = scoringPrefix(pack, { register: 'street', regions: ['PR', 'CARIB'], words: ['janguear', "'tá"] });
    expect(p.startsWith('Conversación entre panas en Puerto Rico')).toBe(true);
    expect(p).toContain("janguear, 'tá");
    expect(p.endsWith(':\n')).toBe(true);
    expect(p).not.toContain('{words}');
  });

  it('fills the street prefix up to minWords and caps it at maxWords', () => {
    const filled = scoringPrefix(pack, { register: 'street', regions: ['PR'], words: [] });
    const named = filled.split('como ')[1]!.replace(':\n', '').split(', ');
    expect(named).toHaveLength(3);
    const many = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const capped = scoringPrefix(pack, { register: 'street', regions: ['PR'], words: many, maxWords: 2 });
    expect(capped).toContain('como a1, a2:');
  });

  it('falls back to the neutral prefix when no register pack has one', () => {
    const bare = createDefaultSpanishPack({ regions: [] });
    expect(scoringPrefix(bare, { register: 'street' })).toBe('Frase en español:\n');
  });
});

describe('slangIn', () => {
  it('finds single words, clipped forms and phrases in text order', () => {
    const found = slangIn(pack, "Mano, el corillo 'tá listo pa' janguear.");
    expect(found).toEqual(expect.arrayContaining(['corillo', "'tá", "pa'", 'janguear']));
    expect(found.indexOf('corillo')).toBeLessThan(found.indexOf('janguear'));
  });

  it('respects the region filter', () => {
    const all = createDefaultSpanishPack();
    expect(slangIn(all, 'Ese asere es buena gente.', ['PR'])).not.toContain('asere');
    expect(slangIn(all, 'Ese asere es buena gente.', ['CU'])).toContain('asere');
  });
});

describe('slangExemption and heat', () => {
  it('keeps surprisal but zeroes heat for slang words', () => {
    const segments = pack.segment('Vamos a janguear.');
    const tokens = toks([['Vamos', -1], [' a', -1], [' jang', -15], ['uear', -12], ['.', -1]]);
    const exempt = slangExemption(pack, ['PR', 'CARIB']);
    const plain = wordScoresFromTokens(tokens, segments);
    const street = wordScoresFromTokens(tokens, segments, { exempt });
    expect(plain[2]!.heat).toBe(3);
    expect(street[2]!.heat).toBe(0);
    expect(street[2]!.surprisal).toBeCloseTo(27, 9);
    expect(exempt({ text: 'casa', norm: 'casa', start: 0, end: 4, kind: 'word' } as Segment)).toBe(false);
  });

  it('gives the first word of each sentence an allowance', () => {
    const segments = pack.segment('Trabajo mucho. Duermo poco.');
    // 8.5 nats: heat 1 mid-sentence (>= 7), heat 0 at a sentence start (8.5 - 2.5 < 7).
    const tokens = toks([['Trabajo', -8.5], [' mucho', -8.5], ['.', -1], [' Duermo', -8.5], [' poco', -8.5], ['.', -1]]);
    const heats = wordScoresFromTokens(tokens, segments).map((w) => w.heat);
    expect(heats).toEqual([0, 1, 0, 1]);
    const mid = wordScoresFromTokens(tokens, segments, { startsSentence: false }).map((w) => w.heat);
    expect(mid).toEqual([1, 1, 0, 1]);
  });

  it('treats a prefix ending in a line break as a sentence start', () => {
    expect(contextStartsSentence('Frase en español:\n')).toBe(true);
    expect(contextStartsSentence('')).toBe(true);
    expect(contextStartsSentence('Marta llegó.')).toBe(true);
    expect(contextStartsSentence('Marta llegó tarde al')).toBe(false);
  });
});
