import { describe, expect, it } from 'vitest';
import { alignWords, alignmentCost, type AlignStep } from './align';

const ops = (steps: readonly AlignStep[]) => steps.map((s) => s.op);

/** Every index of both sequences appears in exactly one step, in order. */
function expectCovers(steps: readonly AlignStep[], n: number, m: number) {
  expect(steps.flatMap((s) => s.expected)).toEqual(Array.from({ length: n }, (_, i) => i));
  expect(steps.flatMap((s) => s.heard)).toEqual(Array.from({ length: m }, (_, i) => i));
}

describe('alignWords', () => {
  it('matches identical sequences at cost 0', () => {
    const steps = alignWords(['el', 'corillo', 'ya'], ['el', 'corillo', 'ya']);
    expect(ops(steps)).toEqual(['match', 'match', 'match']);
    expect(alignmentCost(steps)).toBe(0);
  });

  it('finds a substitution, a missing word and an extra word', () => {
    const steps = alignWords(['a', 'b', 'c', 'd'], ['a', 'x', 'd', 'e']);
    // Of the cost-3 alignments, one that matches d wins over substituting b, c and d.
    expect(steps.filter((s) => s.op === 'match').map((s) => [s.expected, s.heard])).toEqual([
      [[0], [0]],
      [[3], [2]],
    ]);
    expect(ops(steps).sort()).toEqual(['delete', 'insert', 'match', 'match', 'substitute']);
    expect(steps[steps.length - 1]).toMatchObject({ op: 'insert', heard: [3] });
    expect(alignmentCost(steps)).toBe(3);
    expectCovers(steps, 4, 4);
  });

  it('handles empty sides', () => {
    expect(alignWords([], [])).toEqual([]);
    expect(ops(alignWords(['a', 'b'], []))).toEqual(['delete', 'delete']);
    expect(ops(alignWords([], ['a']))).toEqual(['insert']);
  });

  it('uses the substitution cost to pair similar words', () => {
    const near = (a: string, b: string) => (a === b ? 0 : a[0] === b[0] ? 0.5 : 1);
    const steps = alignWords(['corillo', 'ya'], ['ya', 'corrillo', 'ya'], { substituteCost: near });
    // Pairing corillo with corrillo (0.5) plus one insert beats any other alignment.
    expect(steps.map((s) => [s.op, s.expected, s.heard, s.cost])).toEqual([
      ['insert', [], [0], 1],
      ['substitute', [0], [1], 0.5],
      ['match', [1], [2], 0],
    ]);
  });

  it('matches multi-word equivalents in either direction', () => {
    const eq = [[['pal'], ['para', 'el']]] as const;
    const a = alignWords(['vamos', 'pal', 'party'], ['vamos', 'para', 'el', 'party'], { equivalents: eq });
    expect(a.map((s) => [s.op, s.expected, s.heard, s.equivalent ?? false])).toEqual([
      ['match', [0], [0], false],
      ['match', [1], [1, 2], true],
      ['match', [2], [3], false],
    ]);
    const b = alignWords(['vamos', 'para', 'el', 'party'], ['vamos', 'pal', 'party'], { equivalents: eq });
    expect(b[1]).toMatchObject({ op: 'match', expected: [1, 2], heard: [1], equivalent: true });
    expect(alignmentCost(b)).toBe(0);
  });

  it('is deterministic and prefers pairing words over leaving them out', () => {
    const one = alignWords(['a', 'b'], ['c', 'd']);
    expect(ops(one)).toEqual(['substitute', 'substitute']);
    expect(alignWords(['a', 'b'], ['c', 'd'])).toEqual(one);
  });

  it('respects custom delete and insert costs', () => {
    // Free inserts: extra heard words cost nothing, so the expected words still match.
    const steps = alignWords(['a', 'b'], ['x', 'a', 'y', 'b', 'z'], { insertCost: 0 });
    expect(alignmentCost(steps)).toBe(0);
    expect(steps.filter((s) => s.op === 'match').map((s) => s.heard[0])).toEqual([1, 3]);
  });
});
