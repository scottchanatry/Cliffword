import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import { echoLine } from './echo';
import { cjkPack } from './testPacks';

const pack = createDefaultSpanishPack();
const LINE = "El corillo ya 'tá listo pa' bailar";

describe('echoLine', () => {
  it('counts every word landed when the line is sung back exactly', () => {
    const r = echoLine(LINE, "el corillo ya 'tá listo pa' bailar", pack, { register: 'street' });
    expect(r.landed).toBe(7);
    expect(r.total).toBe(7);
    expect(r.words.every((w) => w.status === 'landed' && w.via === 'exact')).toBe(true);
    expect(r.label).toEqual({ key: 'echo.landed', params: { n: 7, m: 7 } });
  });

  it('marks a missed word and an extra word, like "6 of 7 landed"', () => {
    const r = echoLine(LINE, 'el corillo ya listo pa bailar bailar', pack, { register: 'street' });
    expect(r.words.map((w) => w.status)).toEqual(['landed', 'landed', 'landed', 'missed', 'landed', 'landed', 'landed']);
    expect(r.words[3]?.heard).toBeUndefined();
    expect(r.extra.map((e) => e.text)).toEqual(['bailar']);
    expect([r.landed, r.missed, r.substituted, r.total]).toEqual([6, 1, 0, 7]);
    expect(r.label.params).toEqual({ n: 6, m: 7 });
  });

  it('ignores case, punctuation, accents and apostrophes', () => {
    const r = echoLine("¡Mírala! 'Tá lista, pa' bailar.", 'mirala ta lista pa bailar', pack, { register: 'neutral' });
    expect(r.landed).toBe(5);
    expect(r.words.map((w) => w.via)).toEqual(['loose', 'loose', 'exact', 'loose', 'exact']);
  });

  it('accepts full forms for clipped ones in street register only', () => {
    const heard = 'el corillo ya está listo para bailar';
    const street = echoLine(LINE, heard, pack, { register: 'street' });
    expect(street.landed).toBe(7);
    expect(street.words[3]).toMatchObject({ text: "'tá", status: 'landed', via: 'register', heard: 'está' });
    expect(street.words[5]).toMatchObject({ text: "pa'", status: 'landed', via: 'register', heard: 'para' });
    const neutral = echoLine(LINE, heard, pack, { register: 'neutral' });
    expect(neutral.landed).toBe(5);
    expect(neutral.words[3]).toMatchObject({ status: 'substituted', heard: 'está' });
  });

  it('works the other way round: a clipped form for a full one in the line', () => {
    const r = echoLine('El corillo ya está listo para bailar', "el corillo ya 'tá listo pa' bailar", pack, { register: 'street' });
    expect(r.landed).toBe(7);
  });

  it('matches a clipped form against several full words ("pa\'l" = "para el")', () => {
    const r = echoLine("Vamos pa'l party", 'vamos para el party', pack, { register: 'street' });
    expect(r.landed).toBe(3);
    expect(r.words[1]).toMatchObject({ text: "pa'l", via: 'register', heard: 'para el', heardIndices: [1, 2] });
    expect(r.extra).toEqual([]);
    const back = echoLine('Vamos para el party', "vamos pa'l party", pack, { register: 'street' });
    expect(back.landed).toBe(4);
  });

  it('does not treat other slang as the same word', () => {
    const r = echoLine(LINE, 'el grupo ya está listo para bailar', pack, { register: 'street' });
    expect(r.words[1]).toMatchObject({ text: 'corillo', status: 'substituted', heard: 'grupo' });
    expect(r.landed).toBe(6);
  });

  it('lets a long word with one letter off land as near, but not a short one', () => {
    const r = echoLine(LINE, 'el corrillo ya ta listo pa bailar', pack, { register: 'street' });
    expect(r.words[1]).toMatchObject({ status: 'landed', via: 'near', heard: 'corrillo' });
    const short = echoLine('esta casa', 'este casa', pack, { register: 'neutral' });
    expect(short.words[0]).toMatchObject({ status: 'substituted', heard: 'este' });
    const strict = echoLine(LINE, 'el corrillo ya ta listo pa bailar', pack, { register: 'street', nearRatio: 0 });
    expect(strict.words[1]?.status).toBe('substituted');
  });

  it('underlines slang words', () => {
    const r = echoLine(LINE, '', pack, { register: 'street' });
    expect(r.words.filter((w) => w.slang).map((w) => w.text)).toEqual(['corillo', "'tá", "pa'"]);
    expect(r.landed).toBe(0);
    expect(r.missed).toBe(7);
  });

  it('handles an empty line', () => {
    const r = echoLine('', 'hola', pack, { register: 'street' });
    expect(r.total).toBe(0);
    expect(r.extra.map((e) => e.text)).toEqual(['hola']);
    expect(r.label.params).toEqual({ n: 0, m: 0 });
  });

  it('does not need spaces between words', () => {
    const r = echoLine('我爱你。', '我爱他', cjkPack, { register: 'neutral' });
    expect(r.total).toBe(3);
    expect(r.words.map((w) => w.status)).toEqual(['landed', 'landed', 'substituted']);
  });
});
