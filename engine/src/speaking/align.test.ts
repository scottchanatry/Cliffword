import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import type { LanguagePack, Segment } from '../lang/types';
import { alignTranscript, clippedEquivalences } from './align';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();

function outcomes(expected: string, heard: string, register: 'neutral' | 'street' = 'neutral') {
  return alignTranscript(expected, heard, pack, { register }).words.map((w) => [w.text, w.outcome] as const);
}

describe('alignTranscript', () => {
  it('lands every word of a matching transcript, ignoring case, accents and punctuation', () => {
    const a = alignTranscript('Marta llegó tarde al mercado.', 'marta llego tarde al mercado', pack);
    expect(a.understood).toBe(5);
    expect(a.total).toBe(5);
    expect(a.share).toBe(1);
    expect(a.extra).toEqual([]);
    expect(a.words.map((w) => w.match)).toEqual(['exact', 'loose', 'exact', 'exact', 'exact']);
    expect(a.words[1]).toMatchObject({ index: 1, text: 'llegó', heard: 'llego', heardIndices: [1], outcome: 'landed' });
  });

  it('reports "Understood N of M words" as a pair-pack lookup', () => {
    const a = alignTranscript('Marta llegó tarde al mercado.', 'marta llego al mercado', pack);
    expect(a.ui).toEqual({ key: 'stats.understood', params: { n: 4, m: 5 } });
    expect(pair.ui[a.ui.key]).toContain('{n}');
    expect(pair.ui[a.ui.key]).toContain('{m}');
  });

  it('marks missed, substituted and extra words', () => {
    const a = alignTranscript('Marta llegó tarde al mercado.', 'marta llegó tarda al mercado grande', pack);
    expect(a.words.map((w) => w.outcome)).toEqual(['landed', 'landed', 'substituted', 'landed', 'landed']);
    expect(a.words[2]).toMatchObject({ text: 'tarde', heard: 'tarda', match: null });
    expect(a.extra).toEqual([{ index: 5, text: 'grande', norm: 'grande', start: 29, end: 35, after: 4 }]);

    const missed = alignTranscript('Marta llegó tarde al mercado.', 'marta llego al mercado', pack);
    expect(missed.words[2]).toMatchObject({ text: 'tarde', outcome: 'missed', heard: '', heardIndices: [] });

    const extra = alignTranscript('al mercado', 'eh al mercado', pack);
    expect(extra.extra).toMatchObject([{ text: 'eh', after: -1 }]);
    expect(extra.understood).toBe(2);
  });

  it('lines a near miss up with its own word rather than a neighbour', () => {
    // "compro" is closer to "compré" than to "pan".
    const a = alignTranscript('Compré pan', 'compro', pack);
    expect(a.words.map((w) => [w.text, w.outcome, w.heard])).toEqual([
      ['Compré', 'substituted', 'compro'],
      ['pan', 'missed', ''],
    ]);
  });

  it('handles empty texts', () => {
    expect(alignTranscript('', 'hola', pack)).toMatchObject({ words: [], understood: 0, total: 0, share: 0 });
    expect(alignTranscript('', 'hola', pack).extra.map((x) => x.after)).toEqual([-1]);
    expect(alignTranscript('Hola.', '', pack).words.map((w) => w.outcome)).toEqual(['missed']);
    expect(alignTranscript('¡...!', '', pack).total).toBe(0);
  });

  it('accepts a recognizer that drops the apostrophes of clipped forms, in any register', () => {
    expect(outcomes("Esa vaina 'tá brutal pa' la gente", 'esa vaina ta brutal pa la gente')).toEqual([
      ['Esa', 'landed'], ['vaina', 'landed'], ["'tá", 'landed'], ['brutal', 'landed'], ["pa'", 'landed'], ['la', 'landed'], ['gente', 'landed'],
    ]);
  });

  it('matches clipped and full forms only in street register', () => {
    const expected = "Esa vaina 'tá brutal pa' la gente";
    const said = 'Esa vaina está brutal para la gente.';
    const street = alignTranscript(expected, said, pack, { register: 'street' });
    expect(street.understood).toBe(7);
    expect(street.words[2]).toMatchObject({ text: "'tá", heard: 'está', match: 'register' });
    expect(street.words[4]).toMatchObject({ text: "pa'", heard: 'para', match: 'register' });
    const neutral = alignTranscript(expected, said, pack, { register: 'neutral' });
    expect(neutral.understood).toBe(5);
    expect(neutral.words[2]?.outcome).toBe('substituted');

    // The other way round: the story says it in full, the learner clips it.
    expect(outcomes('Estoy muy cansado', "'toy muy cansao", 'street').every(([, o]) => o === 'landed')).toBe(true);
    expect(outcomes('Estoy muy cansado', "'toy muy cansao", 'neutral').map(([, o]) => o)).toEqual(['substituted', 'landed', 'substituted']);
  });

  it('matches -ado and -ao in street register (with or without the apostrophe)', () => {
    const a = alignTranscript('Estoy cansado y mojado', "estoy cansao y moja'o", pack, { register: 'street' });
    expect(a.words.map((w) => w.match)).toEqual(['exact', 'suffix', 'exact', 'suffix']);
    expect(alignTranscript('Los pelados', 'los pelaos', pack, { register: 'street' }).understood).toBe(2);
    expect(alignTranscript('cansado', 'cansao', pack, { register: 'neutral' }).understood).toBe(0);
    // The ending data comes from the options when given.
    expect(alignTranscript('cansado', 'cansao', pack, { register: 'street', streetSuffixes: [] }).understood).toBe(0);
  });

  it('matches a multi-word clipped form as a unit ("pa\'l" ~ "para el")', () => {
    const one = alignTranscript("Vamo' pa'l campo", 'vamos para el campo', pack, { register: 'street' });
    expect(one.understood).toBe(3);
    expect(one.words[1]).toMatchObject({ text: "pa'l", heard: 'para el', heardIndices: [1, 2], match: 'register' });
    expect(one.extra).toEqual([]);
    const two = alignTranscript('Vamos para el campo', "vamo pa'l campo", pack, { register: 'street' });
    expect(two.understood).toBe(4);
    expect(two.words.slice(1, 3).map((w) => w.heard)).toEqual(["pa'l", "pa'l"]);
  });

  it('lands a word the recognizer split or joined', () => {
    const a = alignTranscript("Vamos pa'lante", 'vamos pa lante', pack);
    expect(a.understood).toBe(2);
    expect(a.words[1]).toMatchObject({ heard: 'pa lante', match: 'loose' });
  });

  it('only counts clippings as street equivalents, not other slang meanings', () => {
    const eq = clippedEquivalences(pack);
    expect(eq.get('ta')?.has('esta')).toBe(true);
    expect(eq.get('pa')?.has('para')).toBe(true);
    // mai (neutral mamá) and klk (neutral "qué tal") are other words, not shortened ones.
    expect(eq.has('mai')).toBe(false);
    expect(eq.has('klk')).toBe(false);
    // Non-clipped slang never stands in for its neutral meaning.
    expect(alignTranscript('Es chévere', 'es genial', pack, { register: 'street' }).understood).toBe(1);
  });

  it('applies only the register packs of the given regions, as scoring does', () => {
    // CARIB holds the clipped forms; a PR-only selection (without CARIB) does not.
    expect(alignTranscript("'tá bien", 'está bien', pack, { register: 'street', regions: ['CARIB'] }).understood).toBe(2);
    expect(alignTranscript("'tá bien", 'está bien', pack, { register: 'street', regions: ['PR'] }).understood).toBe(1);
    // A pack built for the learner's regions already holds the right packs.
    const prPack = createDefaultSpanishPack({ regions: ['PR'] });
    expect(alignTranscript("'tá bien", 'está bien', prPack, { register: 'street' }).understood).toBe(2);
  });

  it('is deterministic', () => {
    const a = alignTranscript('Ayer fui a la playa con mis amigos.', 'ayer fui la playa con con mis amigas', pack);
    const b = alignTranscript('Ayer fui a la playa con mis amigos.', 'ayer fui la playa con con mis amigas', pack);
    expect(a).toEqual(b);
    expect(a.words.map((w) => w.outcome)).toEqual(['landed', 'landed', 'missed', 'landed', 'landed', 'landed', 'landed', 'substituted']);
    // The backtrace keeps the later "con" on the diagonal, so the first one is the extra word.
    expect(a.extra.map((x) => [x.text, x.index, x.after])).toEqual([['con', 4, 4]]);
  });

  it('never assumes spaces separate words', () => {
    // A toy pack for a script without spaces: every character is a word.
    const seg = (text: string): Segment[] => {
      const out: Segment[] = [];
      let i = 0;
      for (const ch of text) {
        const kind = /\p{L}/u.test(ch) ? 'word' : 'punct';
        out.push({ text: ch, norm: ch, start: i, end: i + ch.length, kind });
        i += ch.length;
      }
      return out;
    };
    const toy: LanguagePack = {
      code: 'xx', segment: seg, normalize: (w) => w, analyze: () => [], inflect: () => undefined,
      frequencyRank: () => undefined, rules: [], registers: [],
    };
    const a = alignTranscript('我想喝茶。', '我想喝水', toy);
    expect(a.total).toBe(4);
    expect(a.understood).toBe(3);
    expect(a.words[3]).toMatchObject({ text: '茶', outcome: 'substituted', heard: '水' });
  });
});
