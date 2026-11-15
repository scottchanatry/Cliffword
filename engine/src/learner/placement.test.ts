import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLACEMENT_OPTIONS,
  PlacementTracker,
  bandOf,
  bandRange,
  fitLogThreshold,
  rankOfFromPack,
} from './placement';
import { LearnerModel } from './model';
import { formKey, lexemeKey, SKILLS } from './types';

/** Seeded PRNG for noisy synthetic learners (no Math.random). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where inside the suggested band each successive probe word sits (log scale). */
const POSITIONS = [0.5, 0.25, 0.75, 0.125, 0.625, 0.375, 0.875];

/** Run placement against a synthetic learner until done. */
function runPlacement(answer: (rank: number) => boolean, tracker = new PlacementTracker()): PlacementTracker {
  let i = 0;
  while (!tracker.done && i < 1000) {
    const b = tracker.nextBand();
    const f = POSITIONS[i % POSITIONS.length] ?? 0.5;
    const rank = b.minRank * Math.pow(b.maxRank / b.minRank, f);
    tracker.record(`es:w${i}`, rank, answer(rank));
    i++;
  }
  return tracker;
}

const logistic = (threshold: number, slope: number) => (rank: number) =>
  1 / (1 + Math.exp(-slope * (Math.log(threshold) - Math.log(rank))));

describe('bands', () => {
  it('groups ranks into factor-of-two bands, exact powers included', () => {
    expect(bandOf(1)).toBe(0);
    expect(bandOf(2)).toBe(1);
    expect(bandOf(3)).toBe(1);
    expect(bandOf(64)).toBe(6);
    expect(bandOf(127)).toBe(6);
    expect(bandOf(1000)).toBe(9);
    expect(bandOf(1024)).toBe(10);
    expect(bandOf(8)).toBe(3);
  });

  it('clamps odd ranks', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(-5)).toBe(0);
    expect(bandOf(Number.NaN)).toBe(0);
    expect(bandOf(1e12)).toBe(DEFAULT_PLACEMENT_OPTIONS.maxBand);
  });

  it('describes band rank ranges', () => {
    expect(bandRange(10)).toEqual({ band: 10, minRank: 1024, maxRank: 2048, centerRank: Math.pow(2, 10.5) });
    expect(bandRange(3, { bandRatio: 10 }).minRank).toBe(1000);
  });
});

describe('PlacementTracker staircase', () => {
  it('starts at the band of startRank and suggests it', () => {
    const t = new PlacementTracker();
    expect(t.nextBand().band).toBe(bandOf(DEFAULT_PLACEMENT_OPTIONS.startRank));
    expect(t.done).toBe(false);
    expect(t.isDone()).toBe(false);
  });

  it('gets harder after success (fast until the first failure) and easier after failure', () => {
    const t = new PlacementTracker();
    const b0 = t.nextBand().band;
    t.record('es:casa', t.nextBand().centerRank, true);
    expect(t.nextBand().band).toBe(b0 + 2);
    t.record('es:x', t.nextBand().centerRank, false);
    expect(t.nextBand().band).toBe(b0 + 1);
    t.record('es:y', t.nextBand().centerRank, true);
    expect(t.nextBand().band).toBe(b0 + 2);
  });

  it('does not climb on successes with words easier than the target', () => {
    const t = new PlacementTracker();
    t.record('es:a', 64, true);
    const band = t.nextBand().band;
    t.record('es:el', 2, true);
    t.record('es:de', 1, true);
    expect(t.nextBand().band).toBe(band);
  });

  it('stalls after two failures at one band with no success there in between', () => {
    const t = new PlacementTracker({ minItems: 0 });
    t.record('es:a', 300, false);
    expect(t.stalled).toBe(false);
    t.record('es:b', 100, true);
    t.record('es:c', 400, false);
    expect(t.stalled).toBe(true);
    expect(t.done).toBe(true);
  });

  it('a success at the band or harder clears earlier failures there', () => {
    const t = new PlacementTracker({ minItems: 0 });
    t.record('es:a', 300, false);
    t.record('es:b', 400, true);
    t.record('es:c', 300, false);
    expect(t.stalled).toBe(false);
  });

  it('stall ends placement only after minItems, and maxItems always ends it', () => {
    const t = new PlacementTracker({ minItems: 5, maxItems: 8 });
    t.record('es:a', 300, false);
    t.record('es:b', 300, false);
    expect(t.stalled).toBe(true);
    expect(t.done).toBe(false);
    for (let i = 0; i < 3; i++) t.record(`es:c${i}`, 10, true);
    expect(t.done).toBe(true);
    const u = new PlacementTracker({ maxItems: 8 });
    for (let i = 0; i < 8; i++) u.record(`es:k${i}`, 4, true);
    expect(u.stalled).toBe(false);
    expect(u.done).toBe(true);
  });

  it('never suggests a band outside [minBand, maxBand]', () => {
    const t = new PlacementTracker();
    for (let i = 0; i < 30; i++) t.record(`es:w${i}`, t.nextBand().centerRank, true);
    expect(t.nextBand().band).toBe(DEFAULT_PLACEMENT_OPTIONS.maxBand);
    const u = new PlacementTracker({ stallFailures: 99 });
    for (let i = 0; i < 30; i++) u.record(`es:w${i}`, u.nextBand().centerRank, false);
    expect(u.nextBand().band).toBe(DEFAULT_PLACEMENT_OPTIONS.minBand);
  });

  it('keeps defaults for options passed as undefined', () => {
    const t = new PlacementTracker({ maxItems: undefined, slope: 2 });
    expect(t.options.maxItems).toBe(DEFAULT_PLACEMENT_OPTIONS.maxItems);
    expect(t.options.slope).toBe(2);
  });

  it('rejects invalid ranks without recording', () => {
    const t = new PlacementTracker();
    expect(t.record('es:a', 0, true)).toBe(false);
    expect(t.record('es:a', -3, true)).toBe(false);
    expect(t.record('es:a', Number.NaN, true)).toBe(false);
    expect(t.record('es:a', Number.POSITIVE_INFINITY, true)).toBe(false);
    expect(t.items()).toEqual([]);
    expect(t.record("es:'tá", 5000, true)).toBe(true);
    expect(t.items()).toEqual([{ key: "es:'tá", rank: 5000, success: true }]);
  });
});

describe('fitLogThreshold', () => {
  it('returns the prior centre with no data', () => {
    const r = fitLogThreshold([], 1.5, Math.log(1000), 3);
    expect(r.theta).toBeCloseTo(Math.log(1000), 9);
    expect(r.standardError).toBeCloseTo(3, 9);
  });

  it('is finite for perfectly separated answers and lands between them', () => {
    const items = [
      { rank: 100, success: true },
      { rank: 200, success: true },
      { rank: 400, success: true },
      { rank: 1600, success: false },
      { rank: 3200, success: false },
    ];
    const r = fitLogThreshold(items, 1.5, Math.log(1000), 3);
    expect(Number.isFinite(r.theta)).toBe(true);
    expect(Math.exp(r.theta)).toBeGreaterThan(400);
    expect(Math.exp(r.theta)).toBeLessThan(1600);
    expect(r.standardError).toBeLessThan(3);
  });

  it('sets the derivative of the log posterior to zero', () => {
    const items = [
      { rank: 50, success: true },
      { rank: 500, success: false },
      { rank: 700, success: true },
      { rank: 5000, success: false },
    ];
    const slope = 1.5;
    const mu = Math.log(1000);
    const { theta } = fitLogThreshold(items, slope, mu, 3);
    let g = -(theta - mu) / 9;
    for (const it of items) g += slope * ((it.success ? 1 : 0) - 1 / (1 + Math.exp(-slope * (theta - Math.log(it.rank)))));
    expect(Math.abs(g)).toBeLessThan(1e-9);
  });

  it('moves up when more hard words are known', () => {
    const base = [{ rank: 100, success: true }, { rank: 2000, success: false }];
    const more = [...base, { rank: 1500, success: true }];
    expect(fitLogThreshold(more, 1.5, 7, 3).theta).toBeGreaterThan(fitLogThreshold(base, 1.5, 7, 3).theta);
  });
});

describe('placement convergence on synthetic learners', () => {
  const thresholds = [20, 80, 150, 500, 1000, 2000, 3000, 8000, 20_000, 40_000];

  it('lands within a factor of two for deterministic learners who know every word up to their threshold', () => {
    for (const T of thresholds) {
      const t = runPlacement((rank) => rank <= T);
      const est = t.estimate().thresholdRank;
      expect(est, `threshold ${T}`).toBeGreaterThanOrEqual(T / 2);
      expect(est, `threshold ${T}`).toBeLessThanOrEqual(T * 2);
      expect(t.done).toBe(true);
      expect(t.items().length).toBeLessThanOrEqual(DEFAULT_PLACEMENT_OPTIONS.maxItems);
    }
  });

  it('mostly lands within a factor of two for noisy learners (seeded logistic answers)', () => {
    let within = 0;
    let total = 0;
    const ratios: number[] = [];
    for (const slope of [1.5, 3]) {
      for (const T of [150, 500, 2000, 8000]) {
        for (let seed = 1; seed <= 25; seed++) {
          const rnd = mulberry32(seed * 7919 + T);
          const p = logistic(T, slope);
          const t = runPlacement((rank) => rnd() < p(rank));
          const ratio = t.estimate().thresholdRank / T;
          ratios.push(ratio);
          total++;
          if (ratio >= 0.5 && ratio <= 2) within++;
          // Never wildly off.
          expect(ratio).toBeGreaterThan(0.25);
          expect(ratio).toBeLessThan(4);
        }
      }
    }
    expect(within / total).toBeGreaterThanOrEqual(0.9);
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)] ?? 0;
    expect(median).toBeGreaterThan(0.7);
    expect(median).toBeLessThan(1.4);
  });

  it('is deterministic', () => {
    const a = runPlacement((rank) => rank <= 1234).estimate();
    const b = runPlacement((rank) => rank <= 1234).estimate();
    expect(a).toEqual(b);
  });
});

describe('priors', () => {
  const ranks: Record<string, number> = { 'es:de': 2, 'es:casa': 150, 'es:mercado': 900, 'es:puesto': 4000, 'es:corillo': 30_000 };
  const rankOf = (k: string) => ranks[k];

  function placedAt(T: number): PlacementTracker {
    return runPlacement((rank) => rank <= T);
  }

  it('frequent words get higher priors than rare ones, bounded on both sides', () => {
    const prior = placedAt(1000).prior(rankOf);
    const order = ['es:de', 'es:casa', 'es:mercado', 'es:puesto', 'es:corillo'].map((k) => prior(k, 'meaning'));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThanOrEqual(order[i - 1] ?? 1);
    expect(order[2]).toBeLessThan(order[1] ?? 1);
    expect(order[3]).toBeLessThan(order[2] ?? 1);
    expect(order[4]).toBeLessThan(order[3] ?? 1);
    expect(prior('es:de', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.maxPrior);
    expect(prior('es:corillo', 'speaking')).toBeGreaterThanOrEqual(DEFAULT_PLACEMENT_OPTIONS.minPrior);
  });

  it('a stronger learner gets higher priors', () => {
    expect(placedAt(8000).prior(rankOf)('es:puesto', 'meaning')).toBeGreaterThan(placedAt(500).prior(rankOf)('es:puesto', 'meaning'));
  });

  it('scales skills: meaning >= written >= sound >= speaking', () => {
    const prior = placedAt(2000).prior(rankOf);
    const [m, w, s, sp] = (['meaning', 'written', 'sound', 'speaking'] as const).map((sk) => prior('es:mercado', sk));
    expect(m).toBeGreaterThanOrEqual(w ?? 0);
    expect(w).toBeGreaterThanOrEqual(s ?? 0);
    expect(s).toBeGreaterThan(sp ?? 1);
  });

  it('treats words missing from the list as rare, uses the lexeme rank for forms, floors cognates', () => {
    const prior = placedAt(1000).prior(rankOf, ['es:hospital', formKey('es', 'chocolate', { number: 'p' })]);
    expect(prior('es:janguear', 'meaning')).toBeLessThan(0.05);
    expect(prior(formKey('es', 'casa', { number: 'p' }), 'meaning')).toBe(prior('es:casa', 'meaning'));
    expect(prior('es:hospital', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.cognatePrior.meaning);
    expect(prior('es:chocolate', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.cognatePrior.meaning);
    for (const s of SKILLS) {
      const p = prior('es:nada', s);
      expect(p).toBeGreaterThanOrEqual(DEFAULT_PLACEMENT_OPTIONS.minPrior);
      expect(p).toBeLessThanOrEqual(DEFAULT_PLACEMENT_OPTIONS.maxPrior);
    }
  });

  it('feeds a LearnerModel', () => {
    const model = new LearnerModel({ prior: placedAt(1000).prior(rankOf) });
    const now = Date.UTC(2026, 10, 15);
    expect(model.pKnown('es:casa', 'meaning', now)).toBeGreaterThan(0.8);
    expect(model.pKnown('es:puesto', 'meaning', now)).toBeLessThan(0.2);
    // A form of a known lexeme inherits through back-off as well as through its own prior.
    expect(model.pKnown(formKey('es', 'casa', { number: 'p' }), 'meaning', now)).toBeGreaterThan(0.8);
  });

  it('brandNew gives cognates a moderate meaning prior and everything else a very low one', () => {
    const prior = PlacementTracker.brandNew([lexemeKey('es', 'hospital'), lexemeKey('es', 'música')]);
    expect(prior('es:hospital', 'meaning')).toBe(0.5);
    expect(prior('es:música', 'meaning')).toBe(0.5);
    expect(prior('es:musica', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.brandNewPrior);
    expect(prior('es:hospital', 'speaking')).toBeLessThan(prior('es:hospital', 'meaning'));
    expect(prior(formKey('es', 'hospital', { number: 'p' }), 'meaning')).toBe(0.5);
    expect(prior('es:casa', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.brandNewPrior);
    expect(prior('', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.brandNewPrior);
    expect(PlacementTracker.brandNew([])('es:hospital', 'meaning')).toBe(DEFAULT_PLACEMENT_OPTIONS.brandNewPrior);
    const custom = PlacementTracker.brandNew(['es:radio'], { brandNewPrior: 0.01 });
    expect(custom('es:x', 'sound')).toBe(0.01);
  });
});

describe('rankOfFromPack', () => {
  const pack = {
    code: 'es',
    frequencyRank: (lemma: string) => ({ de: 2, casa: 150, "'tá": 900 } as Record<string, number>)[lemma],
  };

  it('strips the language prefix and asks the pack', () => {
    const rankOf = rankOfFromPack(pack);
    expect(rankOf('es:casa')).toBe(150);
    expect(rankOf("es:'tá")).toBe(900);
    expect(rankOf(formKey('es', 'casa', { number: 'p' }))).toBe(150);
    expect(rankOf('es:desconocido')).toBeUndefined();
    expect(rankOf('en:casa')).toBeUndefined();
    expect(rankOf('casa')).toBeUndefined();
  });
});

describe('snapshot', () => {
  it('round-trips through JSON and replays to the same state', () => {
    const t = runPlacement((rank) => rank <= 700, new PlacementTracker({ maxItems: 9 }));
    const r = PlacementTracker.restore(JSON.parse(JSON.stringify(t.snapshot())));
    expect(r.estimate()).toEqual(t.estimate());
    expect(r.nextBand()).toEqual(t.nextBand());
    expect(r.done).toBe(t.done);
    expect(r.stalled).toBe(t.stalled);
    expect(r.options.maxItems).toBe(9);
    expect(() => PlacementTracker.restore({ version: 3 } as never)).toThrow();
  });
});
