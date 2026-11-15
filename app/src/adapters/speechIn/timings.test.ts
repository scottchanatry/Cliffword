import {
  PIECE_GAP_MS,
  estimateHeardTimings,
  estimatedWordMs,
  fillWordEnds,
  isStartsOnly,
  segmentsToWords,
  spokenMsOf,
  splitWords,
  timingsLookValid,
  totalMs,
  voicedRuns,
  wordWeight,
  wordsSpanMs,
  type LevelSample,
} from './timings';
import type { FinalTranscript, TranscriptWord } from './types';

/** Samples every 50 ms from `t0`: [dBFS, count] pairs. */
function samples(plan: [number, number][], t0 = 50): LevelSample[] {
  const out: LevelSample[] = [];
  let t = t0;
  for (const [db, count] of plan) {
    for (let i = 0; i < count; i++) {
      out.push({ t, db });
      t += 50;
    }
  }
  return out;
}

describe('segmentsToWords', () => {
  it('moves segment times to the session clock, keeps confidences in 0..1 and splits multi-word segments', () => {
    expect(
      segmentsToWords(
        [
          { segment: 'Marta', startTimeMillis: 0, endTimeMillis: 300, confidence: 0.8 },
          { segment: ' ', startTimeMillis: 300, endTimeMillis: 310, confidence: 0.1 },
          { segment: 'llegó tarde', startTimeMillis: 400, endTimeMillis: 1400, confidence: -1 },
        ],
        120,
      ),
    ).toEqual([
      { text: 'Marta', startMs: 120, endMs: 420, confidence: 0.8 },
      { text: 'llegó', startMs: 520, endMs: 1020 },
      { text: 'tarde', startMs: 1020, endMs: 1520 },
    ]);
  });

  it('recognizes start-only segments and fills their ends', () => {
    const startsOnly = [
      { segment: 'el', startTimeMillis: 0, endTimeMillis: 999, confidence: -1 },
      { segment: 'mercado', startTimeMillis: 1000, endTimeMillis: 1000, confidence: -1 },
    ];
    expect(isStartsOnly(startsOnly)).toBe(true);
    expect(isStartsOnly([{ segment: 'sí', startTimeMillis: 0, endTimeMillis: 250, confidence: 0.9 }])).toBe(false);
    expect(isStartsOnly([])).toBe(false);
    const words = fillWordEnds(segmentsToWords(startsOnly, 0), 1300);
    expect(words).toEqual([
      { text: 'el', startMs: 0, endMs: estimatedWordMs('el') },
      { text: 'mercado', startMs: 1000, endMs: 1300 },
    ]);
    // No limit after the last word: its estimate stands.
    expect(fillWordEnds([{ text: 'hola', startMs: 500, endMs: 500 }], 0)).toEqual([
      { text: 'hola', startMs: 500, endMs: 500 + estimatedWordMs('hola') },
    ]);
  });
});

describe('voicedRuns', () => {
  it('finds speech above the noise floor, bridges short gaps and drops clicks', () => {
    const levels = samples([
      [-55, 6], // 50..300 quiet room
      [-20, 6], // 350..600 speech
      [-55, 3], // 650..750 a short gap: bridged
      [-22, 4], // 800..950 speech
      [-55, 20], // 1000..1950 pause
      [-18, 1], // 2000 a click: dropped
      [-55, 5],
    ]);
    expect(voicedRuns(levels)).toEqual([{ startMs: 300, endMs: 950 }]);
  });

  it('adapts to a noisy room, and needs at least one sample', () => {
    const noisy = samples([
      [-35, 6],
      [-12, 6],
      [-35, 6],
    ]);
    expect(voicedRuns(noisy)).toEqual([{ startMs: 300, endMs: 600 }]);
    expect(voicedRuns([])).toEqual([]);
    expect(voicedRuns([{ t: Number.NaN, db: -10 }])).toEqual([]);
    expect(totalMs([{ startMs: 0, endMs: 100 }, { startMs: 200, endMs: 250 }])).toBe(150);
  });
});

describe('estimateHeardTimings', () => {
  it('spreads words over the span by length when there are no runs', () => {
    expect(estimateHeardTimings([['sí', 'claro']], { startMs: 0, endMs: 700 })).toEqual([
      { text: 'sí', startMs: 0, endMs: 200 },
      { text: 'claro', startMs: 200, endMs: 700 },
    ]);
    expect(estimateHeardTimings([[]], { startMs: 0, endMs: 700 })).toEqual([]);
  });

  it('puts each recognized piece in its cluster of runs, so the long pause stays between pieces', () => {
    const runs = [
      { startMs: 200, endMs: 500 },
      { startMs: 650, endMs: 800 }, // a short pause inside the first piece
      { startMs: 800 + PIECE_GAP_MS + 300, endMs: 2200 },
    ];
    const words = estimateHeardTimings([['hola', 'qué', 'tal'], ['bien']], { startMs: 0, endMs: 2400 }, runs);
    expect(words.map((w) => w.text)).toEqual(['hola', 'qué', 'tal', 'bien']);
    expect(words[3]).toEqual({ text: 'bien', startMs: 1800, endMs: 2200 });
    expect((words[2] as TranscriptWord).endMs).toBe(800);
  });

  it('falls back to voiced-time shares when pieces and clusters do not line up', () => {
    const runs = [
      { startMs: 0, endMs: 400 },
      { startMs: 1400, endMs: 1800 },
    ];
    const words = estimateHeardTimings([['uno', 'dos', 'tres', 'cuatro']], { startMs: 0, endMs: 2000 }, runs);
    expect(words.map((w) => [w.text, w.startMs >= 1400])).toEqual([
      ['uno', false],
      ['dos', false],
      ['tres', false],
      ['cuatro', true],
    ]);
  });
});

describe('spoken time and checks', () => {
  const final = (extra: Partial<FinalTranscript>): FinalTranscript => ({ text: 'hola', durationMs: 2000, source: 'speech', ...extra });

  it('spokenMsOf: measured, else the words, else the session; typed answers count nothing', () => {
    expect(spokenMsOf(final({ spokenMs: 800 }))).toBe(800);
    expect(spokenMsOf(final({ words: [{ text: 'hola', startMs: 300, endMs: 900 }] }))).toBe(600);
    expect(spokenMsOf(final({}))).toBe(2000);
    expect(spokenMsOf({ text: 'hola', durationMs: 0, source: 'typed' })).toBe(0);
    expect(wordsSpanMs(undefined)).toBe(0);
  });

  it('accepts sane measured timings and rejects the rest', () => {
    const ok = [
      { text: 'a', startMs: 0, endMs: 100 },
      { text: 'b', startMs: 150, endMs: 300 },
    ];
    expect(timingsLookValid(ok, 1000)).toBe(true);
    expect(timingsLookValid([{ text: 'a', startMs: 1.7e12, endMs: 1.7e12 + 1 }], 1000)).toBe(false);
    expect(timingsLookValid([{ text: 'a', startMs: 500, endMs: 600 }, { text: 'b', startMs: 100, endMs: 200 }], 1000)).toBe(false);
    expect(timingsLookValid([{ text: 'a', startMs: Number.NaN, endMs: 1 }], 1000)).toBe(false);
  });

  it('weighs words by letters and digits, in any script', () => {
    expect(wordWeight('mercado')).toBe(7);
    expect(wordWeight("'tá")).toBe(2);
    expect(wordWeight('東京')).toBe(2);
    expect(wordWeight('...')).toBe(1);
    expect(splitWords('Marta, ¿llegó tarde?')).toEqual(['Marta', 'llegó', 'tarde']);
  });
});
