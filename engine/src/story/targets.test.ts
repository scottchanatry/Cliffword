import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGET_OPTIONS, chooseTargets } from './targets';
import { stubLearner } from './testStubs';

const LIST = ['es:el', 'es:de', 'es:casa', 'es:perro', 'es:comprar', 'es:ferretería'];

describe('chooseTargets', () => {
  it('takes the most frequent unknown lexemes first', () => {
    const learner = stubLearner({ 'es:el': 0.99, 'es:de': 0.99, 'es:casa': 0.9 }, 0.01);
    const out = chooseTargets({ learner, now: 0, frequencyKeys: LIST, options: { count: 2 } });
    expect(out.map((t) => [t.key, t.reason])).toEqual([
      ['es:perro', 'new'],
      ['es:comprar', 'new'],
    ]);
    expect(out[0]?.pMeaning).toBe(0.01);
  });

  it('defaults to one target and skips excluded keys (form keys reduced to lexemes)', () => {
    expect(DEFAULT_TARGET_OPTIONS.count).toBe(1);
    const learner = stubLearner({}, 0);
    const out = chooseTargets({ learner, now: 0, frequencyKeys: LIST, exclude: ['es:el#gender=m'] });
    expect(out.map((t) => t.key)).toEqual(['es:de']);
  });

  it('moves on to extra lexemes, then practice, then review when the list is known', () => {
    const learner = stubLearner(
      {
        'es:el': { meaning: 0.99, speaking: 0.95 },
        'es:de': { meaning: 0.99, speaking: 0.2 },
        'es:casa': { meaning: 0.95, speaking: 0.4 },
        'es:perro': { meaning: 0.7, speaking: 0.1 },
        'es:comprar': { meaning: 0.99, speaking: 0.9 },
        'es:ferretería': { meaning: 0.6, speaking: 0.9 },
        "es:'tá": { meaning: 0.99 },
      },
      0.01,
    );
    const out = chooseTargets({
      learner,
      now: 0,
      frequencyKeys: LIST,
      extra: ["es:'tá", 'es:corillo', 'es:de'],
      options: { count: 5 },
    });
    expect(out.map((t) => [t.key, t.reason])).toEqual([
      ['es:corillo', 'extra'],
      ['es:de', 'practice'],
      ['es:casa', 'practice'],
      ['es:ferretería', 'review'],
      ['es:perro', 'review'],
    ]);
  });

  it('returns every usable key when fewer than count exist, and nothing for count 0', () => {
    const learner = stubLearner({}, 0.99);
    expect(chooseTargets({ learner, now: 0, frequencyKeys: ['es:a', 'es:a', 'es:b'], options: { count: 5 } })).toHaveLength(2);
    expect(chooseTargets({ learner, now: 0, frequencyKeys: LIST, options: { count: 0 } })).toEqual([]);
    expect(chooseTargets({ learner, now: 0, frequencyKeys: [] })).toEqual([]);
  });

  it('is deterministic', () => {
    const learner = stubLearner({ 'es:casa': 0.3 }, 0.9);
    const a = chooseTargets({ learner, now: 0, frequencyKeys: LIST, options: { count: 3 } });
    const b = chooseTargets({ learner, now: 0, frequencyKeys: LIST, options: { count: 3 } });
    expect(a).toEqual(b);
  });
});
