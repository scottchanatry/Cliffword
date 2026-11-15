/**
 * The Music tab flow through the module's public API, with the real Spanish and en-es
 * packs and the mock model: paste a song, list its slang (A3), show a line in neutral and
 * street side by side (C2), stop the track at a cliff and score the answer (C1), sing the
 * line back (B4).
 */
import { describe, expect, it } from 'vitest';
import { createMockModel } from '../model/mock';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import {
  echoLine,
  lyricCliffs,
  parseLyrics,
  registerPairs,
  scoreLyricAnswer,
  slangNotes,
  songSlangNotes,
} from './index';

const pack = createDefaultSpanishPack({ regions: ['PR'] });
const pair = createDefaultPairPack({ regions: ['PR'] });
const model = createMockModel();

const PASTED = [
  '3 ContributorsLuna de Santurce Lyrics',
  '[Verso 1: Rayo K.]',
  'Esta noche salimos a janguear,',
  'el corillo ya ’tá listo pa’ bailar',
  '',
  '[Coro]',
  'Dale, dale (x2)',
  'que la noche es de nosotros',
  'You might also like',
  '',
  '[Coro]5Embed',
].join('\n');

describe('Music tab flow', () => {
  it('goes from pasted lyrics to slang notes, register pairs, a scored cliff and a sing-back', async () => {
    const lyrics = parseLyrics(PASTED, pack);
    expect(lyrics.lines.map((l) => l.text)).toEqual([
      'Esta noche salimos a janguear,',
      "el corillo ya 'tá listo pa' bailar",
      'Dale, dale',
      'que la noche es de nosotros',
    ]);
    expect(lyrics.sections.map((s) => [s.label, s.repeatOf])).toEqual([
      ['Verso 1', undefined],
      ['Coro', undefined],
      ['Coro', 1],
    ]);

    // A3: the song's slang, once each.
    const song = songSlangNotes(lyrics, pack, pair);
    expect(song.map((s) => s.note.form)).toEqual(['janguear', 'corillo', "'tá", "pa'", 'dale']);
    // "Dale, dale (x2)": two per line, sung twice.
    expect(song.find((s) => s.note.form === 'dale')?.count).toBe(4);

    // C2: neutral and street side by side.
    const line = lyrics.lines[1]?.text ?? '';
    const sides = registerPairs(line, pack);
    expect(sides.neutral).toBe('el grupo ya está listo para bailar');
    expect(sides.substitutions.map((s) => `${s.neutral} → ${s.street}`)).toEqual(['grupo → corillo', "está → 'tá", "para → pa'"]);

    // C1: the track stops before the end of the line; the learner says it neutral.
    const units = await lyricCliffs(model, pack, lyrics, { register: 'street', lines: [1] });
    const cliff = units[0]?.cliffs[0];
    expect(cliff?.answer).toBe("pa' bailar");
    const result = await scoreLyricAnswer(model, pack, cliff!, 'para bailar', { register: 'street' });
    expect(result.credit).toBe('full');
    expect(result.equivalence?.kind).toBe('neutral_for_street');

    // B4: sing the line back; one word missed.
    const echo = echoLine(line, 'el corillo ya listo para bailar', pack, { register: 'street' });
    expect(echo.label).toEqual({ key: 'echo.landed', params: { n: 6, m: 7 } });
    expect(echo.words.find((w) => w.status === 'missed')?.text).toBe("'tá");
    expect(echo.words.filter((w) => w.slang).map((w) => w.text)).toEqual(['corillo', "'tá", "pa'"]);

    // Slang notes for the line, with glosses from the pair pack.
    expect(slangNotes(line, pack, pair).map((n) => `${n.text}: ${n.gloss}`)).toEqual([
      'corillo: group of friends, crew',
      "'tá: is, you are (clipped \"está\")",
      "pa': for, to (clipped \"para\")",
    ]);
  });
});
