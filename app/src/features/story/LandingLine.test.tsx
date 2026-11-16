import type { LandingPoint } from '@cliffword/engine';
import { placePoints, spreadPositions } from './LandingLine';

const point = (text: string, x: number, answer = false): LandingPoint => ({ text, prob: x, x, answer, actual: false });

describe('landing line layout', () => {
  it('keeps order and spreads tied dots at least 16 dp apart, inside the line', () => {
    expect(spreadPositions([100, 100, 100], 16, 0, 300)).toEqual([100, 116, 132]);
    expect(spreadPositions([290, 300, 300], 16, 0, 300)).toEqual([268, 284, 300]);
    expect(spreadPositions([10, 200], 16, 20, 300)).toEqual([20, 200]);
  });

  it('puts the answer above its dot and the others in free slots, the answer drawn last', () => {
    const placed = placePoints([point('reír', 0.1), point('llorar', 0.2), point('leer', 0.7), point('leerla', 0.8, true)], 342);
    expect(placed.map((p) => p.point.text)).toEqual(['reír', 'llorar', 'leer', 'leerla']);
    expect(placed.find((p) => p.point.answer)?.slot).toBe('answer');
    for (const p of placed.filter((q) => !q.point.answer)) expect(p.slot).not.toBeNull();
    // Surprising to expected: left to right.
    const lefts = placed.map((p) => p.left);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
  });

  it('drops a label rather than overlapping when every slot near it is taken', () => {
    const placed = placePoints([point('alpha', 0.9), point('bravo', 0.9), point('charlie', 0.9), point('delta', 0.9), point('echo', 0.9, true)], 342);
    const labelled = placed.filter((p) => p.slot !== null && p.slot !== 'answer');
    expect(labelled.length).toBeLessThan(4);
    expect(new Set(placed.map((p) => Math.round(p.left * 342))).size).toBe(5);
  });
});
