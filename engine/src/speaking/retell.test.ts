import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import {
  DEFAULT_RETELL_OPTIONS,
  RETELL_LANES,
  contentLemmas,
  laneRemainingMs,
  retellCoverage,
  retellMetrics,
  retellProgress,
  retellRoundUi,
} from './retell';
import type { TimedWord } from './retell';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();

/**
 * A round of `n` words spanning exactly `spanMs` from 0, with `pauses` silences of
 * `pauseLen` ms spread evenly and short gaps (20% of a slot, well under 700 ms) elsewhere.
 */
function round(n: number, spanMs: number, pauses: number, pauseLen = 1200): TimedWord[] {
  const shortGaps = n - 1 - pauses;
  const slot = (spanMs - pauses * pauseLen) / (0.8 * n + 0.2 * shortGaps);
  const pauseAfter = new Set(Array.from({ length: pauses }, (_, k) => Math.floor(((k + 1) * n) / (pauses + 1)) - 1));
  const words: TimedWord[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? spanMs : t + 0.8 * slot;
    words.push({ text: `palabra${i}`, startMs: t, endMs: end });
    t = end + (pauseAfter.has(i) ? pauseLen : 0.2 * slot);
  }
  return words;
}

describe('retellMetrics', () => {
  it('reproduces the design: 71 words a minute with 5 pauses, then 84 with 1', () => {
    const r1 = retellMetrics(round(71, 60000, 5), { laneMs: RETELL_LANES[0] });
    expect(r1.wordCount).toBe(71);
    expect(r1.spokenMs).toBeCloseTo(60000, 6);
    expect(r1.wordsPerMinute).toBeCloseTo(71, 6);
    expect(r1.pauseCount).toBe(5);
    expect(r1.pauses.every((p) => p.durationMs >= DEFAULT_RETELL_OPTIONS.pauseMs)).toBe(true);
    expect(r1.overrun).toBe(0);

    const r2 = retellMetrics(round(63, 45000, 1), { laneMs: RETELL_LANES[1] });
    expect(r2.wordsPerMinute).toBeCloseTo(84, 6);
    expect(r2.pauseCount).toBe(1);

    expect(retellProgress([r1, r2])).toEqual({
      rounds: 2,
      wordsPerMinute: { from: 71, to: 84, change: 13 },
      pauses: { from: 5, to: 1, change: -4 },
      faster: true,
      fewerPauses: true,
    });
  });

  it('places each pause after the word before it, for holes between tiles', () => {
    const words: TimedWord[] = [
      { text: 'Marta', startMs: 0, endMs: 400 },
      { text: 'fue', startMs: 500, endMs: 700 },
      { text: 'al', startMs: 1500, endMs: 1600 }, // 800 ms silence: a pause
      { text: 'mercado', startMs: 1650, endMs: 2100 },
      { text: 'y', startMs: 2799, endMs: 2900 }, // 699 ms: not a pause
      { text: 'compró', startMs: 3600, endMs: 4000 }, // exactly 700 ms: a pause
    ];
    const m = retellMetrics(words);
    expect(m.pauses).toEqual([
      { afterIndex: 1, startMs: 700, endMs: 1500, durationMs: 800 },
      { afterIndex: 4, startMs: 2900, endMs: 3600, durationMs: 700 },
    ]);
    expect(m.spokenMs).toBe(4000);
    expect(m.wordsPerMinute).toBeCloseTo(90, 10);
    expect(retellMetrics(words, { pauseMs: 500 }).pauseCount).toBe(3);
  });

  it('drops words after the lane and clips a word that runs past its end', () => {
    const words: TimedWord[] = [
      { text: 'uno', startMs: 1000, endMs: 1500 },
      { text: 'dos', startMs: 29800, endMs: 30400 },
      { text: 'tres', startMs: 30000, endMs: 30500 },
      { text: 'cuatro', startMs: 31000, endMs: 31500 },
    ];
    const m = retellMetrics(words, { laneMs: 30000 });
    expect(m.wordCount).toBe(2);
    expect(m.overrun).toBe(2);
    expect(m.words[1]).toEqual({ text: 'dos', startMs: 29800, endMs: 30000 });
    expect(m.spokenMs).toBe(29000);
    expect(m.leadingSilenceMs).toBe(1000);
    // An unlimited lane keeps everything.
    expect(retellMetrics(words, { laneMs: Infinity }).wordCount).toBe(4);
  });

  it('measures from the lane start given on the same clock as the words', () => {
    const t0 = Date.UTC(2026, 10, 15, 9, 0, 0);
    const words: TimedWord[] = [
      { text: 'hola', startMs: t0 + 2000, endMs: t0 + 2500 },
      { text: 'tarde', startMs: t0 + 46000, endMs: t0 + 46500 },
    ];
    const m = retellMetrics(words, { laneStartMs: t0, laneMs: 45000 });
    expect(m.wordCount).toBe(1);
    expect(m.overrun).toBe(1);
    expect(m.leadingSilenceMs).toBe(2000);
  });

  it('counts the leading silence as a pause only when asked', () => {
    const words: TimedWord[] = [{ text: 'hola', startMs: 3000, endMs: 3500 }, { text: 'amigo', startMs: 3600, endMs: 4000 }];
    expect(retellMetrics(words).pauseCount).toBe(0);
    expect(retellMetrics(words, { countLeadingSilence: true }).pauses).toEqual([{ afterIndex: -1, startMs: 0, endMs: 3000, durationMs: 3000 }]);
  });

  it('cleans recognizer output: unsorted, overlapping, empty and invalid words', () => {
    const words: TimedWord[] = [
      { text: 'b', startMs: 300, endMs: 2000 }, // long word overlapping the next
      { text: 'a', startMs: 0, endMs: 400 },
      { text: ' ', startMs: 2100, endMs: 2200 },
      { text: 'c', startMs: 1500, endMs: 1900 },
      { text: 'd', startMs: Number.NaN, endMs: 10 },
      { text: 'e', startMs: 2600, endMs: 2500 }, // end before start
    ];
    const m = retellMetrics(words);
    expect(m.words.map((w) => w.text)).toEqual(['a', 'b', 'c', 'e']);
    expect(m.words[3]).toEqual({ text: 'e', startMs: 2600, endMs: 2600 });
    // Gaps are measured from the latest end so far (2000), so c inside b is no pause and e is 600 ms later.
    expect(m.pauseCount).toBe(0);
    expect(m.spokenMs).toBe(2600);
  });

  it('gives no rate for no words and floors the span for a handful of quick ones', () => {
    expect(retellMetrics([])).toMatchObject({ wordCount: 0, wordsPerMinute: 0, spokenMs: 0, pauseCount: 0, leadingSilenceMs: 0 });
    const two = retellMetrics([{ text: 'sí', startMs: 0, endMs: 200 }, { text: 'no', startMs: 250, endMs: 400 }]);
    expect(two.wordsPerMinute).toBe(120); // 2 words over the 1 s floor, not 300 a minute
  });
});

describe('retell progress, lanes and labels', () => {
  it('compares the first round with the latest one', () => {
    expect(retellProgress([])).toBeNull();
    const only = retellProgress([{ wordsPerMinute: 70.6, pauseCount: 3 }]);
    expect(only).toEqual({ rounds: 1, wordsPerMinute: { from: 71, to: 71, change: 0 }, pauses: { from: 3, to: 3, change: 0 }, faster: false, fewerPauses: false });
    const three = retellProgress([
      { wordsPerMinute: 71, pauseCount: 5 },
      { wordsPerMinute: 90, pauseCount: 0 },
      { wordsPerMinute: 84, pauseCount: 1 },
    ]);
    expect(three?.wordsPerMinute).toEqual({ from: 71, to: 84, change: 13 });
    expect(three?.pauses).toEqual({ from: 5, to: 1, change: -4 });
  });

  it('has three shrinking lanes: 60, 45 and 30 seconds', () => {
    expect(RETELL_LANES).toEqual([60000, 45000, 30000]);
    expect(retellRoundUi(0)).toEqual({ key: 'retell.round', params: { round: 1, rounds: 3, seconds: 60 } });
    expect(retellRoundUi(2)).toEqual({ key: 'retell.round', params: { round: 3, rounds: 3, seconds: 30 } });
    expect(retellRoundUi(7).params?.round).toBe(3);
    expect(pair.ui['retell.round']).toContain('{seconds}');
  });

  it('counts down a lane without going negative', () => {
    expect(laneRemainingMs(45000, 26000)).toBe(19000); // "0:19 left in this lane"
    expect(laneRemainingMs(45000, 50000)).toBe(0);
    expect(laneRemainingMs(45000, -5)).toBe(45000);
  });
});

describe('retellCoverage', () => {
  const story = 'Marta llegó tarde al mercado. Compró pan y una fruta muy dulce en un puesto.';

  it('takes the content lemmas of a story in order, names included', () => {
    const lemmas = contentLemmas(story, pack);
    expect(lemmas).toContain('marta');
    expect(lemmas).toContain('llegar');
    expect(lemmas).toContain('mercado');
    expect(lemmas).toContain('comprar');
    expect(lemmas).toContain('puesto');
    expect(lemmas).not.toContain('muy');
    expect(lemmas).not.toContain('el');
    expect(lemmas.indexOf('llegar')).toBeLessThan(lemmas.indexOf('comprar'));
  });

  it('says which story lemmas the retell used, by lemma and loosely', () => {
    const said = 'Marta fue al mercado y compro pan';
    const c = retellCoverage(said, story, pack);
    expect(c.covered).toEqual(expect.arrayContaining(['marta', 'mercado', 'comprar', 'pan']));
    expect(c.missing).toEqual(expect.arrayContaining(['llegar', 'fruta', 'puesto']));
    expect(c.covered.length + c.missing.length).toBe(c.total);
    expect(c.share).toBeCloseTo(c.covered.length / c.total, 10);
  });

  it('takes timed words or a lemma list too', () => {
    const words: TimedWord[] = [
      { text: 'Compró', startMs: 0, endMs: 300 },
      { text: 'fruta', startMs: 400, endMs: 700 },
    ];
    expect(retellCoverage(words, ['comprar', 'fruta', 'mercado'], pack)).toEqual({
      covered: ['comprar', 'fruta'], missing: ['mercado'], total: 3, share: 2 / 3,
    });
    expect(retellCoverage('', [], pack)).toEqual({ covered: [], missing: [], total: 0, share: 0 });
  });
});
