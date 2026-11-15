import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import { createDefaultSpanishPack } from '../packs';
import { scoringPrefix } from '../scoring/context';
import {
  DEFAULT_LYRIC_CLIFF_OPTIONS,
  DEFAULT_TEXT_CLIFF_WEIGHTS,
  broughtTextCliffs,
  lyricCliffs,
  scoreLyricAnswer,
  type LyricAnswerTarget,
  type TextCliff,
  type UnitCliffs,
} from './cliffs';
import { parseLyrics } from './parse';
import { cjkPack, fixedLearner, recordingModel } from './testPacks';

const pack = createDefaultSpanishPack();
const model = createMockModel();
const SONG = "Esta noche salimos a janguear\nEl corillo ya 'tá listo pa' bailar";
const lyrics = parseLyrics(SONG, pack);

function cliffOf(units: readonly UnitCliffs[], id: string, answer: string): TextCliff {
  const c = units.find((u) => u.id === id)?.cliffs.find((x) => x.answer === answer);
  if (!c) throw new Error(`no cliff "${answer}" in ${id}`);
  return c;
}

describe('lyricCliffs', () => {
  it('ranks line-final chunks and slang targets in street register', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    expect(units.map((u) => u.id)).toEqual(['l0', 'l1']);
    const l1 = units[1] as UnitCliffs;
    expect(l1.cliffs.length).toBeGreaterThan(0);
    expect(l1.cliffs.length).toBeLessThanOrEqual(DEFAULT_LYRIC_CLIFF_OPTIONS.limit);
    const top = l1.cliffs[0] as TextCliff;
    expect(top).toMatchObject({ answer: "pa' bailar", words: ["pa'", 'bailar'], wordIndex: 5, wordCount: 2, boundary: 'unit' });
    expect(top.accepted).toEqual(["pa' bailar", 'para bailar']);
    expect(top.slang.map((m) => m.entry.form)).toEqual(["pa'"]);
    expect(top.key).toBe("es:pa'");
    expect(top.keys).toEqual(["es:pa'", 'es:bailar']);
    expect(top.reasons.join('; ')).toContain('slang');
    // Ranked best first.
    for (let i = 1; i < l1.cliffs.length; i++) expect((l1.cliffs[i - 1] as TextCliff).score).toBeGreaterThanOrEqual((l1.cliffs[i] as TextCliff).score);
  });

  it('never hides the first word of a line, and spans match the line text', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', limit: 20, maxPositions: 10 });
    for (const u of units) {
      const line = lyrics.lines.find((l) => l.id === u.id);
      for (const c of u.cliffs) {
        expect(c.wordIndex).toBeGreaterThan(0);
        expect(line?.text.slice(c.start, c.end)).toBe(c.answer);
        expect(c.unitId).toBe(u.id);
      }
    }
  });

  it('scores after the street prefix naming the slang, with the previous line as context', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    const c = cliffOf(units, 'l1', "pa' bailar");
    const prefix = scoringPrefix(pack, { register: 'street', words: ['janguear', 'corillo', "'tá", "pa'"] });
    expect(c.context).toBe(`${prefix}Esta noche salimos a janguear\nEl corillo ya 'tá listo `);
    expect(c.before).toBe("Esta noche salimos a janguear\nEl corillo ya 'tá listo ");
    const neutral = await lyricCliffs(model, pack, lyrics, { register: 'neutral' });
    expect(cliffOf(neutral, 'l1', "pa' bailar").context.startsWith('Frase en español:\n')).toBe(true);
  });

  it('gives slang no bonus in neutral register but still accepts its neutral form', async () => {
    const street = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    const neutral = await lyricCliffs(model, pack, lyrics, { register: 'neutral' });
    const s = cliffOf(street, 'l1', "pa' bailar");
    const n = cliffOf(neutral, 'l1', "pa' bailar");
    expect(s.score - n.score).toBeCloseTo(DEFAULT_TEXT_CLIFF_WEIGHTS.slang, 9);
    expect(n.accepted).toEqual(["pa' bailar", 'para bailar']);
  });

  it('does not exclude slang words for low model probability (the model cannot judge slang)', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', probFloor: 1.01, cliffWords: 1, limit: 10, maxPositions: 10 });
    const answers = units.flatMap((u) => u.cliffs.map((c) => c.answer));
    expect(answers.sort()).toEqual(["'tá", 'corillo', 'janguear', "pa'"]);
  });

  it('hides at most cliffWords words', async () => {
    for (const cliffWords of [1, 3]) {
      const units = await lyricCliffs(model, pack, lyrics, { register: 'street', cliffWords, limit: 20, maxPositions: 10 });
      const lens = units.flatMap((u) => u.cliffs.map((c) => c.wordCount));
      expect(Math.max(...lens)).toBeLessThanOrEqual(cliffWords);
      if (cliffWords === 3) expect(lens).toContain(3);
    }
  });

  it('analyses only the requested lines', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', lines: [1, 7, -1] });
    expect(units.map((u) => u.id)).toEqual(['l1']);
  });

  it('bounds the model calls with maxPositions', async () => {
    const one = recordingModel(createMockModel());
    await lyricCliffs(one.model, pack, lyrics, { register: 'street', lines: [1], maxPositions: 1 });
    const four = recordingModel(createMockModel());
    await lyricCliffs(four.model, pack, lyrics, { register: 'street', lines: [1], maxPositions: 4 });
    expect(one.calls.length).toBeGreaterThan(0);
    expect(one.calls.length).toBeLessThan(four.calls.length);
    expect(one.calls.length).toBeLessThanOrEqual(1 + 50);
    // The one position analysed is the line end.
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', lines: [1], maxPositions: 1, limit: 10 });
    expect(new Set(units[0]?.cliffs.map((c) => c.wordIndex))).toEqual(new Set([6]));
  });

  it('leaves explicit slang out when explicit lyrics are off', async () => {
    const song = parseLyrics("Esta noche salimos a janguear\nEse cabrón ya 'tá bellaco", pack);
    const on = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0, limit: 20, maxPositions: 10 });
    const off = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0, limit: 20, maxPositions: 10, showExplicit: false });
    const words = (u: readonly UnitCliffs[]) => u.flatMap((x) => x.cliffs.flatMap((c) => c.words));
    expect(words(on)).toEqual(expect.arrayContaining(['bellaco']));
    expect(words(off)).not.toContain('bellaco');
    expect(words(off)).not.toContain('cabrón');
    expect(words(off)).toContain("'tá");
  });

  it('never hides a name or a number, and stops before them instead', async () => {
    const song = parseLyrics("Esta noche salimos con Yadiel\nSon las 3 y ya 'tá listo", pack);
    const units = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0, limit: 20, maxPositions: 10, cliffWords: 3 });
    const answers = units.flatMap((u) => u.cliffs.map((c) => c.answer));
    for (const a of answers) {
      expect(a).not.toContain('Yadiel');
      expect(a).not.toContain('3');
    }
    // The line ends in a name, so the cliff stops before it.
    expect(units[0]?.cliffs.map((c) => c.answer)).toEqual(expect.arrayContaining(['con', 'salimos con']));
    expect(units[0]?.cliffs.every((c) => c.boundary === 'none')).toBe(true);
    expect(units[1]?.cliffs.map((c) => c.answer)).toContain('las');
  });

  it('never cuts a slang phrase', async () => {
    const song = parseLyrics('Ese tema nuevo está a fuego', pack);
    const short = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0, cliffWords: 1, limit: 20, maxPositions: 10 });
    expect(short[0]?.cliffs.map((c) => c.answer)).not.toContain('fuego');
    const long = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0, cliffWords: 2, limit: 20, maxPositions: 10 });
    const phrase = cliffOf(long, 'l0', 'a fuego');
    expect(phrase.slang.map((m) => m.entry.form)).toEqual(['a fuego']);
    expect(phrase.accepted).toEqual(['a fuego', 'excelente']);
  });

  it("prefers words the learner understands but cannot say, and the learner's targets", async () => {
    const base = await lyricCliffs(model, pack, lyrics, { register: 'neutral', lines: [1], cliffWords: 1, limit: 10, maxPositions: 10 });
    const gap = await lyricCliffs(model, pack, lyrics, {
      register: 'neutral',
      lines: [1],
      cliffWords: 1,
      limit: 10,
      maxPositions: 10,
      learner: fixedLearner({ "es:'tá": { meaning: 1, speaking: 0 } }),
      now: 1_700_000_000_000,
    });
    expect(base[0]?.cliffs[0]?.answer).not.toBe("'tá");
    expect(gap[0]?.cliffs[0]?.answer).toBe("'tá");
    const targeted = await lyricCliffs(model, pack, lyrics, { register: 'neutral', lines: [1], cliffWords: 1, targets: ['es:corillo'], limit: 10, maxPositions: 10 });
    expect(targeted[0]?.cliffs[0]?.answer).toBe('corillo');
  });

  it('treats a repeated line as heard: fair even when the model finds it unlikely', async () => {
    const song = parseLyrics('Marta come pan\nOtra cosa distinta\nMarta come pan', pack);
    const units = await lyricCliffs(model, pack, song, { register: 'neutral', probFloor: 1.01, limit: 10 });
    expect(units[0]?.cliffs).toEqual([]);
    expect(units[2]?.cliffs.length).toBeGreaterThan(0);
    expect(units[2]?.cliffs.every((c) => c.repeat && c.reasons.some((r) => r.startsWith('heard before')))).toBe(true);
  });

  it('skips ad-lib lines, in cliffs and in context', async () => {
    const song = parseLyrics("Esta noche salimos a janguear\n(Ay, mami, ay)\nEl corillo ya 'tá listo pa' bailar", pack);
    const units = await lyricCliffs(model, pack, song, { register: 'street' });
    expect(units[1]?.cliffs).toEqual([]);
    const c = cliffOf(units, 'l2', "pa' bailar");
    expect(c.before).toBe("Esta noche salimos a janguear\nEl corillo ya 'tá listo ");
    const withAdlibs = await lyricCliffs(model, pack, song, { register: 'street', skipAdlibs: false, lines: [1], probFloor: 0 });
    expect(withAdlibs[0]?.cliffs.length).toBeGreaterThan(0);
  });

  it('carries the start time of timed lines', async () => {
    const song = parseLyrics("[00:10.00]Esta noche salimos a janguear\n[00:13.50]El corillo ya 'tá listo pa' bailar", pack);
    const units = await lyricCliffs(model, pack, song, { register: 'street' });
    expect(units[1]?.cliffs[0]?.startMs).toBe(13500);
  });

  it('is deterministic', async () => {
    const a = await lyricCliffs(createMockModel(), pack, lyrics, { register: 'street' });
    const b = await lyricCliffs(createMockModel(), pack, lyrics, { register: 'street' });
    expect(a).toEqual(b);
  });

  it('works for a language without spaces', async () => {
    const song = parseLyrics('我爱你\n你爱我吗', cjkPack);
    const units = await lyricCliffs(model, cjkPack, song, { register: 'neutral', probFloor: 0, cliffWords: 2 });
    for (const u of units) {
      for (const c of u.cliffs) {
        expect(c.wordIndex).toBeGreaterThan(0);
        expect(c.answer.length).toBe(c.wordCount);
      }
    }
    expect(units[1]?.cliffs[0]?.answer).toBe('我吗');
  });
});

describe('scoreLyricAnswer', () => {
  const run = async (answer: string, register: 'street' | 'neutral', target: LyricAnswerTarget, opts = {}) =>
    scoreLyricAnswer(model, pack, target, answer, { register, ...opts });

  it("gives the lyric's own words full credit", async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', cliffWords: 1, limit: 10, maxPositions: 10 });
    const r = await run("Pa'", 'street', cliffOf(units, 'l1', "pa'"));
    expect(r).toMatchObject({ credit: 'full', reason: 'actual' });
    expect(r.equivalence).toBeUndefined();
    expect(r.model.reason).toBe('actual');
  });

  it('accepts the neutral equivalent of a slang target and says why', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', cliffWords: 1, limit: 10, maxPositions: 10 });
    for (const register of ['street', 'neutral'] as const) {
      const r = await run('está', register, cliffOf(units, 'l1', "'tá"));
      expect(r).toMatchObject({ credit: 'full', reason: 'likely' });
      expect(r.equivalence).toEqual({
        kind: 'neutral_for_street',
        pairs: [{ street: "'tá", neutral: 'está' }],
        explain: { key: 'lyrics.answer.neutralForStreet', params: { answer: 'está', lyric: "'tá", street: "'tá", neutral: 'está' } },
      });
      // The model alone could not give it credit.
      expect(r.model.credit).not.toBe('full');
    }
  });

  it('accepts the lyric written without its marks (speech recognition drops them)', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    const r = await run('pa bailar', 'street', cliffOf(units, 'l1', "pa' bailar"));
    expect(r).toMatchObject({ credit: 'full', reason: 'actual', scored: "pa' bailar" });
    expect(r.equivalence?.kind).toBe('spelling');
    expect(r.equivalence?.explain.key).toBe('lyrics.answer.spelling');
  });

  it('handles multi-word cliffs: neutral form, other slang with the same meaning', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    const target = cliffOf(units, 'l1', "pa' bailar");
    expect(await run('para bailar', 'street', target)).toMatchObject({ credit: 'full', equivalence: { kind: 'neutral_for_street' } });
    const variant = await run('para perrear', 'street', target);
    expect(variant).toMatchObject({ credit: 'full', reason: 'likely', equivalence: { kind: 'street_variant' } });
    expect(variant.equivalence?.pairs).toEqual([
      { street: "pa'", neutral: 'para' },
      { street: 'perrear', neutral: 'bailar' },
    ]);
    expect(await run('para perrear', 'neutral', target)).toMatchObject({ credit: 'partial', reason: 'plausible' });
  });

  it('accepts slang where the lyric has the neutral form', async () => {
    // A cliff in the middle of a line, built by hand: lyricCliffs prefers line ends.
    const target = { context: `${scoringPrefix(pack, { register: 'street' })}Mañana salgo con mi `, before: 'Mañana salgo con mi ', answer: 'grupo' };
    // The n-gram mock smooths unseen words to about 1e-3, far above a real model, so the
    // model-only credit here pins the mock-scale floor 0.005 that DEFAULT_CREDIT_OPTIONS
    // .partialFloor had before the real-model measurement lowered it to 1e-4.
    const mockFloor = { credit: { partialFloor: 0.005 } };
    const street = await run('corillo', 'street', target, mockFloor);
    expect(street.model.credit).toBe('none');
    expect(street).toMatchObject({ credit: 'full', reason: 'likely', equivalence: { kind: 'street_for_neutral', pairs: [{ street: 'corillo', neutral: 'grupo' }] } });
    expect(street.equivalence?.explain.key).toBe('lyrics.answer.streetForNeutral');
    const neutral = await run('corillo', 'neutral', target, mockFloor);
    expect(neutral).toMatchObject({ credit: 'partial', reason: 'plausible', equivalence: { kind: 'street_for_neutral' } });
    const strict = await run('corillo', 'neutral', target, { ...mockFloor, streetCreditInNeutral: 'none' });
    expect(strict).toMatchObject({ credit: 'none', equivalence: { kind: 'street_for_neutral' } });
  });

  it('never lowers the credit the model gave', async () => {
    // The mock corpus has "listo pa' bailar", so the model itself likes the street form.
    const song = parseLyrics('El corillo ya está listo para bailar', pack);
    const units = await lyricCliffs(model, pack, song, { register: 'street', probFloor: 0 });
    const r = await run("pa' bailar", 'neutral', cliffOf(units, 'l0', 'para bailar'));
    expect(r.model.credit).toBe('full');
    expect(r).toMatchObject({ credit: 'full', equivalence: { kind: 'street_for_neutral' } });
  });

  it('judges other answers in neutral form when slang is involved', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street' });
    const r = await run('bailar', 'street', cliffOf(units, 'l1', "pa' bailar"));
    // Shorter than the cliff: at most partial.
    expect(r).toMatchObject({ credit: 'partial', answer: 'bailar', equivalence: { kind: 'judged_neutral' } });
    expect(r.model.credit).toBe('none');
    const wrong = await run('para comer', 'street', cliffOf(units, 'l1', "pa' bailar"));
    expect(wrong.credit).toBe('none');
    expect(wrong.equivalence).toBeUndefined();
  });

  it('takes the neutral credit as an option', async () => {
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', cliffWords: 1, limit: 10, maxPositions: 10 });
    const r = await run('para', 'street', cliffOf(units, 'l1', "pa'"), { neutralCredit: 'partial' });
    expect(r).toMatchObject({ credit: 'partial', reason: 'plausible', equivalence: { kind: 'neutral_for_street' } });
  });

  it('works on a bare target and on answers without words', async () => {
    const target = { context: "Frase en español:\nEl corillo ya 'tá listo ", answer: "pa'" };
    expect(await scoreLyricAnswer(model, pack, target, 'para', { register: 'street' })).toMatchObject({ credit: 'full' });
    const empty = await scoreLyricAnswer(model, pack, target, '¿?', { register: 'street' });
    expect(empty.credit).toBe('none');
  });
});

describe('broughtTextCliffs', () => {
  const TEXT = 'Marta llegó tarde al mercado. Compró pan y leche, y volvió a casa.';

  it('splits the text into sentences and ranks multi-word cliffs in each', async () => {
    const units = await broughtTextCliffs(model, pack, TEXT, { register: 'neutral', limit: 10 });
    expect(units.map((u) => [u.id, u.text, u.start])).toEqual([
      ['s0', 'Marta llegó tarde al mercado.', 0],
      ['s1', 'Compró pan y leche, y volvió a casa.', 30],
    ]);
    for (const u of units) {
      expect(TEXT.slice(u.start, u.start + u.text.length)).toBe(u.text);
      for (const c of u.cliffs) {
        expect(u.text.slice(c.start, c.end)).toBe(c.answer);
        expect(u.text.slice(c.position.segment.start, c.position.segment.end)).toBe(c.words[0]);
        expect(c.wordCount).toBeLessThanOrEqual(3);
        expect(c.wordIndex).toBeGreaterThan(0);
      }
    }
    expect(units[0]?.cliffs[0]).toMatchObject({ answer: 'tarde al mercado', wordCount: 3, boundary: 'unit' });
    expect(units.flatMap((u) => u.cliffs.map((c) => c.wordCount)).some((n) => n > 1)).toBe(true);
  });

  it('scores each sentence after the sentences before it', async () => {
    const units = await broughtTextCliffs(model, pack, TEXT, { register: 'neutral', sentences: [1] });
    expect(units.map((u) => u.id)).toEqual(['s1']);
    const c = units[0]?.cliffs[0];
    expect(c?.context.startsWith('Frase en español:\nMarta llegó tarde al mercado. Compró')).toBe(true);
  });

  it('finds clause-final chunks inside a sentence', async () => {
    const units = await broughtTextCliffs(model, pack, TEXT, { register: 'neutral', limit: 20, maxPositions: 10, probFloor: 0 });
    const clause = units[1]?.cliffs.filter((c) => c.boundary === 'clause') ?? [];
    expect(clause.map((c) => c.answer)).toContain('leche');
    // A chunk never crosses the comma.
    expect(units[1]?.cliffs.map((c) => c.answer)).not.toContain('leche, y');
  });

  it('keeps idioms from the register packs whole and accepts their neutral form', async () => {
    const units = await broughtTextCliffs(model, pack, 'El tema nuevo de Rayo está a fuego.', { register: 'street', probFloor: 0, limit: 10, maxPositions: 10 });
    const idiom = cliffOf(units, 's0', 'a fuego');
    expect(idiom.accepted).toEqual(['a fuego', 'excelente']);
    expect(units[0]?.cliffs.map((c) => c.answer)).not.toContain('fuego');
  });

  it('splits transcripts at line breaks and marks repeated sentences', async () => {
    const units = await broughtTextCliffs(model, pack, 'vamos a la playa\nhoy no\nvamos a la playa', { register: 'neutral', probFloor: 1.01, limit: 10 });
    expect(units.map((u) => u.text)).toEqual(['vamos a la playa', 'hoy no', 'vamos a la playa']);
    expect(units[0]?.cliffs).toEqual([]);
    expect(units[2]?.cliffs.length).toBeGreaterThan(0);
    const joined = await broughtTextCliffs(model, pack, 'vamos a la playa\nhoy no', { register: 'neutral', splitLines: false });
    expect(joined).toHaveLength(1);
  });
});
