import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import { createDefaultSpanishPack } from '../packs';
import { scoringPrefix } from '../scoring/context';
import { parseLyrics } from './parse';
import { surpriseMap } from './surprise';
import { cjkPack, recordingModel } from './testPacks';

const pack = createDefaultSpanishPack();
const model = createMockModel();
const TEXT = "Esta noche salimos a janguear. El corillo ya 'tá listo pa' bailar.";
/** Thresholds every word reaches, so heat shows only what is exempt. */
const HOT = { thresholds: [-1, -1, -1] as [number, number, number], sentenceStartAllowance: 0 };

describe('surpriseMap', () => {
  it('scores every word of every sentence, with offsets in the brought text', async () => {
    const units = await surpriseMap(model, pack, TEXT, 'neutral');
    expect(units.map((u) => [u.id, u.text, u.start, u.end])).toEqual([
      ['s0', 'Esta noche salimos a janguear.', 0, 30],
      ['s1', "El corillo ya 'tá listo pa' bailar.", 31, 66],
    ]);
    expect(units[1]?.words.map((w) => w.segment.text)).toEqual(['El', 'corillo', 'ya', "'tá", 'listo', "pa'", 'bailar']);
    for (const u of units) {
      for (const w of u.words) {
        expect(TEXT.slice(w.segment.start, w.segment.end)).toBe(w.segment.text);
        expect(w.surprisal).toBeGreaterThanOrEqual(0);
      }
      expect(u.maxHeat).toBe(Math.max(0, ...u.words.map((w) => w.heat)));
    }
  });

  it('scores each sentence after the previous one, under the register prefix', async () => {
    const neutral = recordingModel(createMockModel());
    await surpriseMap(neutral.model, pack, TEXT, 'neutral');
    expect(neutral.calls.map((c) => [c.context, c.text])).toEqual([
      ['Frase en español:\n', 'Esta noche salimos a janguear.'],
      ['Frase en español:\nEsta noche salimos a janguear.', " El corillo ya 'tá listo pa' bailar."],
    ]);
    const street = recordingModel(createMockModel());
    await surpriseMap(street.model, pack, TEXT, 'street');
    const prefix = scoringPrefix(pack, { register: 'street', words: ['janguear', 'corillo', "'tá", "pa'"] });
    expect(street.calls[1]?.context).toBe(`${prefix}Esta noche salimos a janguear.`);
    const alone = recordingModel(createMockModel());
    await surpriseMap(alone.model, pack, TEXT, 'neutral', { contextUnits: 0 });
    expect(alone.calls[1]?.context).toBe('Frase en español:\n');
  });

  it('never shades slang in street register, including slang written without its marks', async () => {
    const text = "El corillo ya 'tá listo pa bailar.";
    const street = await surpriseMap(model, pack, text, 'street', { heat: HOT });
    const heat = Object.fromEntries((street[0]?.words ?? []).map((w) => [w.segment.text, w.heat]));
    expect(heat).toEqual({ El: 3, corillo: 0, ya: 3, "'tá": 0, listo: 3, pa: 0, bailar: 3 });
    expect(street[0]?.slang.map((m) => m.entry.form)).toEqual(['corillo', "'tá", "pa'"]);
    const neutral = await surpriseMap(model, pack, text, 'neutral', { heat: HOT });
    expect(neutral[0]?.words.every((w) => w.heat === 3)).toBe(true);
  });

  it("combines the caller's exempt predicate with the slang exemption", async () => {
    const units = await surpriseMap(model, pack, "El corillo ya 'tá listo.", 'street', {
      heat: { ...HOT, exempt: (seg) => seg.norm === 'listo' },
    });
    expect(units[0]?.words.filter((w) => w.heat === 0).map((w) => w.segment.text)).toEqual(['corillo', "'tá", 'listo']);
  });

  it('maps parsed lyrics line by line, skipping ad-libs', async () => {
    const lyrics = parseLyrics("Esta noche salimos a janguear\n(Ay, mami)\nEl corillo ya 'tá listo pa' bailar", pack);
    const rec = recordingModel(createMockModel());
    const units = await surpriseMap(rec.model, pack, lyrics, 'street');
    expect(units.map((u) => u.id)).toEqual(['l0', 'l2']);
    expect(rec.calls[1]?.context.endsWith('Esta noche salimos a janguear\n')).toBe(true);
    expect(rec.calls[1]?.text).toBe("El corillo ya 'tá listo pa' bailar");
    const l2 = units[1];
    for (const w of l2?.words ?? []) expect(l2?.text.slice(w.segment.start, w.segment.end)).toBe(w.segment.text);
  });

  it('does not need spaces between words', async () => {
    const units = await surpriseMap(model, cjkPack, '我爱你。你爱我吗？', 'neutral');
    expect(units.map((u) => u.words.length)).toEqual([3, 4]);
  });

  it('returns nothing for text without words', async () => {
    expect(await surpriseMap(model, pack, ' ... \n', 'neutral')).toEqual([]);
  });
});
