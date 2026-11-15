import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY_OPTIONS,
  DEFAULT_RUNG_OPTIONS,
  cliffRungFor,
  deriveParams,
  estimateVocabulary,
  momentum,
  showText,
  vocabLevel,
  type RecentStats,
} from './difficulty';
import { DEFAULT_PRIOR, LearnerModel } from './model';
import { formKey, lexemeKey, type DifficultyParams, type LearnerView, type Skill } from './types';

const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const DAY = 86_400_000;

/** Learner view stub with fixed probabilities per key and skill. */
function stubView(table: Record<string, Partial<Record<Skill, number>>>, fallback = 0): LearnerView {
  return {
    pKnown: (key, skill) => table[key]?.[skill] ?? fallback,
    knownKeys: () => Object.keys(table),
  };
}

const BREEZING: RecentStats = { successRate: 1, replaysPerSentence: 0, pausesPerMinute: 0 };
const STRUGGLING: RecentStats = { successRate: 0.2, replaysPerSentence: 4, pausesPerMinute: 20 };
const NEUTRAL: RecentStats = { successRate: 0.8, replaysPerSentence: 0.5, pausesPerMinute: 4 };

/** Vocabulary sweep: dense at the low end, geometric above. */
function sweep(): number[] {
  const out: number[] = [];
  for (let v = 0; v <= 50; v++) out.push(v);
  for (let v = 60; v < 200_000; v *= 1.15) out.push(Math.round(v));
  out.push(1e6, 1e9);
  return out;
}

describe('vocabLevel', () => {
  it('is 0 at zero, strictly increasing, below 1, and handles odd input', () => {
    expect(vocabLevel(0)).toBe(0);
    let prev = -1;
    for (const v of sweep()) {
      const x = vocabLevel(v);
      expect(x).toBeGreaterThan(prev);
      expect(x).toBeLessThanOrEqual(1);
      prev = x;
    }
    expect(vocabLevel(DEFAULT_DIFFICULTY_OPTIONS.vocabMidpoint)).toBeGreaterThan(0.45);
    expect(vocabLevel(-5)).toBe(0);
    expect(vocabLevel(Number.NaN)).toBe(0);
    expect(vocabLevel(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('vocabLevel: documented curve (alg-8)', () => {
  it('matches the values in the vocabSpread comment', () => {
    expect(vocabLevel(200)).toBeCloseTo(0.13, 2);
    expect(vocabLevel(2000)).toBeCloseTo(0.5, 2);
    expect(vocabLevel(8000)).toBeCloseTo(0.76, 2);
    expect(vocabLevel(20000)).toBeCloseTo(0.87, 2);
  });
});

describe('momentum', () => {
  it('is 0 without stats and at the targets', () => {
    expect(momentum(undefined)).toBe(0);
    expect(momentum(NEUTRAL)).toBeCloseTo(0, 12);
    expect(momentum({ successRate: 0.8, replaysPerSentence: 0.5 })).toBeCloseTo(0, 12);
  });

  it('is positive when breezing, negative when struggling, always inside (-1, 1)', () => {
    expect(momentum(BREEZING)).toBeGreaterThan(0.5);
    expect(momentum(STRUGGLING)).toBeLessThan(-0.5);
    const extremes: RecentStats[] = [
      { successRate: 5, replaysPerSentence: -3, pausesPerMinute: -1 },
      { successRate: -1, replaysPerSentence: 1e9, pausesPerMinute: 1e9 },
      { successRate: Number.NaN, replaysPerSentence: Number.POSITIVE_INFINITY },
      { successRate: Number.NaN, replaysPerSentence: Number.NaN, pausesPerMinute: Number.NaN },
    ];
    for (const r of extremes) {
      const m = momentum(r);
      expect(Number.isFinite(m)).toBe(true);
      expect(Math.abs(m)).toBeLessThanOrEqual(1);
    }
    // All signals missing or unusable: neutral.
    expect(momentum(extremes[3])).toBe(0);
  });

  it('uses pauses when given and ignores them when missing', () => {
    const base = { successRate: 0.8, replaysPerSentence: 0.5 };
    expect(momentum({ ...base, pausesPerMinute: 0 })).toBeGreaterThan(0);
    expect(momentum({ ...base, pausesPerMinute: 30 })).toBeLessThan(0);
  });
});

describe('deriveParams', () => {
  const recents: (RecentStats | undefined)[] = [undefined, NEUTRAL, BREEZING, STRUGGLING];

  it('is monotonic in vocabulary for any fixed recent performance', () => {
    for (const recent of recents) {
      let prev: DifficultyParams | undefined;
      for (const vocab of sweep()) {
        const p = deriveParams({ vocab, recent });
        if (prev) {
          expect(p.sentenceWords.min).toBeGreaterThanOrEqual(prev.sentenceWords.min);
          expect(p.sentenceWords.max).toBeGreaterThanOrEqual(prev.sentenceWords.max);
          expect(p.speechRate).toBeGreaterThanOrEqual(prev.speechRate);
          expect(p.cliffWords).toBeGreaterThanOrEqual(prev.cliffWords);
          expect(p.newWordsPerSentence).toBeGreaterThanOrEqual(prev.newWordsPerSentence);
          expect(p.tileThreshold).toBeLessThanOrEqual(prev.tileThreshold);
        }
        prev = p;
      }
    }
  });

  it('moves clearly from beginner to advanced', () => {
    const lo = deriveParams({ vocab: 0 });
    const hi = deriveParams({ vocab: 50_000 });
    expect(hi.sentenceWords.max).toBeGreaterThan(lo.sentenceWords.max * 3);
    expect(hi.speechRate).toBeGreaterThan(lo.speechRate + 0.25);
    expect(hi.cliffWords).toBeGreaterThan(3.5);
    expect(lo.cliffWords).toBe(1);
    expect(hi.newWordsPerSentence).toBeGreaterThan(lo.newWordsPerSentence * 3);
    expect(hi.tileThreshold).toBeLessThan(lo.tileThreshold);
  });

  it('is smooth: a one-word change in vocabulary moves every setting only a little', () => {
    for (const v of [0, 1, 5, 20, 100, 500, 2000, 10_000]) {
      const a = deriveParams({ vocab: v, recent: NEUTRAL });
      const b = deriveParams({ vocab: v + 1, recent: NEUTRAL });
      expect(Math.abs(b.sentenceWords.max - a.sentenceWords.max)).toBeLessThan(0.05);
      expect(Math.abs(b.speechRate - a.speechRate)).toBeLessThan(0.005);
      expect(Math.abs(b.cliffWords - a.cliffWords)).toBeLessThan(0.02);
      expect(Math.abs(b.newWordsPerSentence - a.newWordsPerSentence)).toBeLessThan(0.005);
    }
  });

  it('keeps the known band within 0.93 to 0.99 for a grid of inputs', () => {
    const vocabs = [0, 1, 10, 100, 1000, 5000, 20_000, 1e7, -10, Number.NaN, Number.POSITIVE_INFINITY];
    const successes = [0, 0.3, 0.6, 0.8, 0.95, 1, -1, 2, Number.NaN];
    const replays = [0, 0.5, 2, 10, 1000, -1, Number.NaN];
    const pauses = [undefined, 0, 4, 30, 1e6, Number.NaN];
    for (const vocab of vocabs) {
      for (const successRate of successes) {
        for (const replaysPerSentence of replays) {
          for (const pausesPerMinute of pauses) {
            const p = deriveParams({ vocab, recent: { successRate, replaysPerSentence, pausesPerMinute } });
            expect(p.knownBand.min).toBeGreaterThanOrEqual(0.93);
            expect(p.knownBand.max).toBeLessThanOrEqual(0.99);
            expect(p.knownBand.min).toBeLessThanOrEqual(p.knownBand.max);
            for (const x of [p.sentenceWords.min, p.sentenceWords.max, p.speechRate, p.cliffWords, p.newWordsPerSentence, p.tileThreshold]) {
              expect(Number.isFinite(x)).toBe(true);
            }
            expect(p.sentenceWords.min).toBeLessThanOrEqual(p.sentenceWords.max);
            expect(p.cliffWords).toBeGreaterThanOrEqual(1);
            expect(p.newWordsPerSentence).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('breezing speeds up and struggling slows down', () => {
    for (const vocab of [0, 300, 3000, 30_000]) {
      const n = deriveParams({ vocab, recent: NEUTRAL });
      const b = deriveParams({ vocab, recent: BREEZING });
      const s = deriveParams({ vocab, recent: STRUGGLING });
      expect(b.speechRate).toBeGreaterThan(n.speechRate);
      expect(s.speechRate).toBeLessThan(n.speechRate);
      expect(b.newWordsPerSentence).toBeGreaterThan(n.newWordsPerSentence);
      expect(s.newWordsPerSentence).toBeLessThan(n.newWordsPerSentence);
      expect(b.sentenceWords.max).toBeGreaterThan(s.sentenceWords.max);
      expect(b.tileThreshold).toBeLessThan(s.tileThreshold);
      expect(b.knownBand.min).toBeLessThan(s.knownBand.min);
    }
  });

  it('keeps recent-performance adjustments bounded', () => {
    const a = DEFAULT_DIFFICULTY_OPTIONS.adjust;
    const worst: RecentStats[] = [
      { successRate: 1, replaysPerSentence: 0, pausesPerMinute: 0 },
      { successRate: 0, replaysPerSentence: 1e9, pausesPerMinute: 1e9 },
    ];
    for (const vocab of sweep()) {
      const n = deriveParams({ vocab });
      for (const recent of worst) {
        const p = deriveParams({ vocab, recent });
        const eps = 1e-9;
        expect(Math.abs(p.speechRate / n.speechRate - 1)).toBeLessThanOrEqual(a.speechRate + eps);
        expect(Math.abs(p.sentenceWords.min / n.sentenceWords.min - 1)).toBeLessThanOrEqual(a.sentenceLength + eps);
        expect(Math.abs(p.sentenceWords.max / n.sentenceWords.max - 1)).toBeLessThanOrEqual(a.sentenceLength + eps);
        expect(Math.abs(p.knownBand.min - n.knownBand.min)).toBeLessThanOrEqual(a.knownBand + eps);
        expect(Math.abs(p.knownBand.max - n.knownBand.max)).toBeLessThanOrEqual(a.knownBand + eps);
        expect(Math.abs(p.tileThreshold - n.tileThreshold)).toBeLessThanOrEqual(a.tileThreshold + eps);
        expect(Math.abs(p.cliffWords - n.cliffWords)).toBeLessThanOrEqual(a.cliffWords * (n.cliffWords - 1) + eps);
        // Combined effect on new words stays within a modest factor.
        expect(p.newWordsPerSentence / n.newWordsPerSentence).toBeGreaterThan(0.6);
        expect(p.newWordsPerSentence / n.newWordsPerSentence).toBeLessThan(1.5);
        expect(p.speechRate).toBeGreaterThanOrEqual(DEFAULT_DIFFICULTY_OPTIONS.speechRateLimits.min);
        expect(p.speechRate).toBeLessThanOrEqual(DEFAULT_DIFFICULTY_OPTIONS.speechRateLimits.max);
      }
    }
  });

  it('never hides more than the documented 4 words, at any momentum (alg-8)', () => {
    let max = 0;
    for (const vocab of [...sweep(), 1e7]) {
      for (const recent of [undefined, BREEZING, NEUTRAL, STRUGGLING]) max = Math.max(max, deriveParams({ vocab, recent }).cliffWords);
    }
    expect(max).toBeLessThanOrEqual(DEFAULT_DIFFICULTY_OPTIONS.cliffWords.to);
    expect(Math.round(max)).toBeLessThanOrEqual(4);
  });

  it('gives a zero-knowledge learner a next step: new words keep coming', () => {
    const p = deriveParams({ vocab: 0, recent: STRUGGLING });
    expect(p.newWordsPerSentence).toBeGreaterThan(0.15);
    expect(p.sentenceWords.min).toBeGreaterThanOrEqual(2.5);
    expect(p.speechRate).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps new words consistent with the band: (1 - band.min) * mean length', () => {
    for (const vocab of [0, 100, 5000]) {
      const p = deriveParams({ vocab, recent: BREEZING });
      const mean = (p.sentenceWords.min + p.sentenceWords.max) / 2;
      expect(p.newWordsPerSentence).toBeCloseTo((1 - p.knownBand.min) * mean, 12);
    }
  });

  it('accepts custom options', () => {
    const opts = { ...DEFAULT_DIFFICULTY_OPTIONS, speechRate: { from: 0.5, to: 0.9 } };
    expect(deriveParams({ vocab: 0 }, opts).speechRate).toBeCloseTo(0.6, 12); // clamped at the 0.6 limit
    expect(deriveParams({ vocab: 1e12 }, opts).speechRate).toBeCloseTo(0.9, 6);
  });
});

describe('cliffRungFor', () => {
  it('picks options, hint or free from pKnown(speaking)', () => {
    const view = stubView({
      'es:a': { speaking: 0.1 },
      'es:b': { speaking: DEFAULT_RUNG_OPTIONS.optionsBelow },
      'es:c': { speaking: 0.45 },
      'es:d': { speaking: DEFAULT_RUNG_OPTIONS.hintBelow },
      'es:e': { speaking: 0.95, meaning: 0 },
    });
    expect(cliffRungFor(view, 'es:a', T0)).toBe('options');
    expect(cliffRungFor(view, 'es:b', T0)).toBe('hint');
    expect(cliffRungFor(view, 'es:c', T0)).toBe('hint');
    expect(cliffRungFor(view, 'es:d', T0)).toBe('free');
    expect(cliffRungFor(view, 'es:e', T0)).toBe('free');
    expect(cliffRungFor(view, 'es:unknown', T0)).toBe('options');
  });

  it('promotes a clearly recognized word to at least a hint', () => {
    const view = stubView({
      'es:a': { speaking: 0.05, meaning: 0.9, sound: 0.8 },
      'es:b': { speaking: 0.05, meaning: 0.9, sound: 0.5 },
      'es:c': { speaking: 0.7, meaning: 0.9, sound: 0.9 },
    });
    expect(cliffRungFor(view, 'es:a', T0)).toBe('hint');
    expect(cliffRungFor(view, 'es:b', T0)).toBe('options');
    expect(cliffRungFor(view, 'es:c', T0)).toBe('free');
    expect(cliffRungFor(view, 'es:a', T0, { promoteOnRecognition: 2 })).toBe('options');
  });

  it('honours custom thresholds and treats NaN as unknown', () => {
    const view = stubView({ 'es:a': { speaking: 0.5 }, 'es:nan': { speaking: Number.NaN } });
    expect(cliffRungFor(view, 'es:a', T0, { optionsBelow: 0.6, hintBelow: 0.8 })).toBe('options');
    expect(cliffRungFor(view, 'es:a', T0, { hintBelow: 0.4 })).toBe('free');
    expect(cliffRungFor(view, 'es:nan', T0)).toBe('options');
  });

  it('climbs the rungs as a real learner model gains speaking evidence', () => {
    const m = new LearnerModel();
    const key = "es:pa'";
    expect(cliffRungFor(m, key, T0)).toBe('options');
    const rungs: string[] = [];
    for (let i = 0; i < 14; i++) {
      const at = T0 + i * DAY;
      const rung = cliffRungFor(m, key, at);
      rungs.push(rung);
      m.apply({ type: 'cliff_answer', key, at, credit: 'full', rung });
    }
    expect(rungs[0]).toBe('options');
    expect(rungs).toContain('hint');
    // Never steps back while every answer is right.
    const order = { options: 0, hint: 1, free: 2 } as const;
    for (let i = 1; i < rungs.length; i++) {
      expect(order[rungs[i] as keyof typeof order]).toBeGreaterThanOrEqual(order[rungs[i - 1] as keyof typeof order]);
    }
    expect(cliffRungFor(m, key, T0 + 13 * DAY)).toBe('free');
  });

  it('a learner who hears a word daily reaches the hint rung sooner', () => {
    const quiet = new LearnerModel();
    const exposed = new LearnerModel();
    const firstHint = (m: LearnerModel, heardPerDay: number): number => {
      for (let d = 0; d < 20; d++) {
        for (let h = 0; h < heardPerDay; h++) m.apply({ type: 'heard', key: 'es:fruta', at: T0 + d * DAY + h * 600_000 });
        const at = T0 + d * DAY + 3_600_000;
        const rung = cliffRungFor(m, 'es:fruta', at);
        if (rung !== 'options') return d;
        m.apply({ type: 'cliff_answer', key: 'es:fruta', at, credit: 'full', rung });
      }
      return 99;
    };
    expect(firstHint(exposed, 3)).toBeLessThan(firstHint(quiet, 0));
  });
});

describe('showText', () => {
  const params = { tileThreshold: 0.8 };

  it('shows text while pKnown(sound) is below the tile threshold', () => {
    const view = stubView({ 'es:sí': { sound: 0.95 }, 'es:si': { sound: 0.2 }, 'es:edge': { sound: 0.8 } });
    expect(showText(view, 'es:sí', T0, params)).toBe(false);
    expect(showText(view, 'es:si', T0, params)).toBe(true);
    expect(showText(view, 'es:edge', T0, params)).toBe(false);
    expect(showText(view, 'es:nunca', T0, params)).toBe(true);
    expect(showText(stubView({ x: { sound: Number.NaN } }), 'x', T0, params)).toBe(true);
  });

  it('a brand-new learner sees text; a word heard often becomes a tile, and fades back after a long gap', () => {
    const m = new LearnerModel();
    const key = "es:'tá";
    const p = deriveParams({ vocab: 0 });
    expect(showText(m, key, T0, p)).toBe(true);
    let at = T0;
    for (let day = 0; day < 10; day++) {
      for (let i = 0; i < 8; i++) {
        at = T0 + day * DAY + i * 60_000;
        m.apply({ type: 'heard', key, at });
      }
    }
    expect(showText(m, key, at, p)).toBe(false);
    expect(showText(m, key, at + 3 * 365 * DAY, p)).toBe(true);
  });
});

describe('estimateVocabulary', () => {
  it('sums pKnown(meaning) over the list plus lexemes with evidence, counting each lexeme once', () => {
    const view = stubView(
      {
        'es:casa': { meaning: 0.9 },
        'es:perro': { meaning: 0.5 },
        [formKey('es', 'tener', { tense: 'pret' })]: { meaning: 0.7 },
        'es:tener': { meaning: 0.8 },
        "es:'tá": { meaning: 0.6 },
      },
      0.01,
    );
    const list = ['es:casa', 'es:perro', 'es:casa', 'es:tener', 'es:gato', ''];
    // casa .9 + perro .5 + tener .8 + gato .01 + 'tá .6 (outside the list, has evidence)
    expect(estimateVocabulary(view, T0, list)).toBeCloseTo(2.81, 12);
  });

  it('handles an empty list and an empty learner', () => {
    expect(estimateVocabulary(stubView({}), T0, [])).toBe(0);
    expect(estimateVocabulary(stubView({ 'es:sol': { meaning: 1 } }), T0, [])).toBe(1);
  });

  it('works with a real learner model: prior mass plus evidence, and grows as words are learned', () => {
    const m = new LearnerModel();
    const list = Array.from({ length: 1000 }, (_, i) => lexemeKey('es', `w${i}`));
    expect(estimateVocabulary(m, T0, list)).toBeCloseTo(1000 * DEFAULT_PRIOR, 9);
    for (let i = 0; i < 50; i++) {
      for (let d = 0; d < 3; d++) {
        m.apply({ type: 'spoke_correct', key: formKey('es', `w${i}`, { number: 'p' }), at: T0 + d * DAY });
      }
    }
    const v = estimateVocabulary(m, T0 + 2 * DAY, list);
    expect(v).toBeGreaterThan(1000 * DEFAULT_PRIOR + 10);
    expect(v).toBeLessThan(1000 * DEFAULT_PRIOR + 50);
  });
});
