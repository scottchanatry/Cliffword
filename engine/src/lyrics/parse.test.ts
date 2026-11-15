import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import { DEFAULT_PARSE_LYRICS_OPTIONS, SITE_JUNK_PATTERNS, lyricLine, parseLyrics } from './parse';
import { cjkPack } from './testPacks';

const pack = createDefaultSpanishPack();
const texts = (raw: string, opts = {}) => parseLyrics(raw, pack, opts).lines.map((l) => l.text);

describe('parseLyrics: lines, stanzas and ids', () => {
  it('gives every lyric line an id, an index, a stanza and a word count', () => {
    const ly = parseLyrics("Esta noche salimos a janguear,\nel corillo ya 'tá listo pa' bailar\n\nOtra estrofa aquí", pack);
    expect(ly.lines.map((l) => l.id)).toEqual(['l0', 'l1', 'l2']);
    expect(ly.lines.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(ly.lines.map((l) => l.stanza)).toEqual([0, 0, 1]);
    expect(ly.stanzas.map((s) => s.lines)).toEqual([['l0', 'l1'], ['l2']]);
    expect(ly.lines[1]?.wordCount).toBe(7);
    expect(ly.lines[1]?.sourceLine).toBe(1);
    expect(ly.timed).toBe(false);
    expect(lyricLine(ly, 'l2')?.text).toBe('Otra estrofa aquí');
    expect(lyricLine(ly, 'l9')).toBeUndefined();
  });

  it('treats several blank lines, CRLF and surrounding spaces like one stanza break', () => {
    const ly = parseLyrics('  uno dos  \r\n\r\n\r\n tres   cuatro \r\ncinco', pack);
    expect(ly.lines.map((l) => l.text)).toEqual(['uno dos', 'tres cuatro', 'cinco']);
    expect(ly.lines.map((l) => l.stanza)).toEqual([0, 1, 1]);
  });

  it('returns no lines for empty or blank input', () => {
    expect(parseLyrics('', pack).lines).toEqual([]);
    expect(parseLyrics('\n \n\t\n', pack).stanzas).toEqual([]);
  });

  it('honours idPrefix', () => {
    expect(parseLyrics('uno\ndos', pack, { idPrefix: 'song1-' }).lines.map((l) => l.id)).toEqual(['song1-0', 'song1-1']);
  });

  it('normalizes curly apostrophes and quotes, odd spaces and invisible characters', () => {
    const [line] = texts('El\u00a0corillo ya ’tá listo pa’ “bailar”\u200B');
    expect(line).toBe('El corillo ya \'tá listo pa\' "bailar"');
    const ly = parseLyrics('Ya ’tá', pack);
    expect(ly.lines[0]?.source).toBe('Ya ’tá');
  });

  it('does not assume spaces separate words (word counts come from the pack)', () => {
    const ly = parseLyrics('我爱你\n[副歌]\n你爱我吗', cjkPack);
    expect(ly.lines.map((l) => l.wordCount)).toEqual([3, 4]);
    expect(ly.sections[0]?.label).toBe('副歌');
  });
});

describe('parseLyrics: section labels', () => {
  it('removes bracketed labels from the text and keeps them as sections', () => {
    const ly = parseLyrics('[Intro]\nWepa\n\n[Verso 1: Rayo K.]\nPrimera línea\nSegunda línea\n[Coro]\nDale que dale', pack);
    expect(ly.lines.map((l) => l.text)).toEqual(['Wepa', 'Primera línea', 'Segunda línea', 'Dale que dale']);
    expect(ly.sections.map((s) => s.label)).toEqual(['Intro', 'Verso 1', 'Coro']);
    expect(ly.sections[1]?.performer).toBe('Rayo K.');
    expect(ly.sections[1]?.lines).toEqual(['l1', 'l2']);
    expect(ly.lines.map((l) => l.section)).toEqual([0, 1, 1, 2]);
    // A label ends the stanza even without a blank line.
    expect(ly.lines.map((l) => l.stanza)).toEqual([0, 1, 1, 2]);
    expect(ly.removed.filter((r) => r.reason === 'label').map((r) => r.sourceLine)).toEqual([0, 3, 6]);
  });

  it('reads English labels the same way ([Chorus], {Bridge})', () => {
    const ly = parseLyrics('[Chorus]\nla la la\n{Bridge}\nna na', pack);
    expect(ly.sections.map((s) => s.label)).toEqual(['Chorus', 'Bridge']);
    expect(ly.lines.map((l) => l.text)).toEqual(['la la la', 'na na']);
  });

  it('reads short colon labels: with a digit anywhere, or opening a stanza', () => {
    const ly = parseLyrics('Verse 1:\nUno dos tres\n\nCoro:\nCuatro cinco\nY entonces me dijo:\nseis', pack);
    expect(ly.sections.map((s) => s.label)).toEqual(['Verse 1', 'Coro']);
    // Three words in the middle of a stanza: a sung line, not a label.
    expect(ly.lines.map((l) => l.text)).toEqual(['Uno dos tres', 'Cuatro cinco', 'Y entonces me dijo:', 'seis']);
  });

  it('can turn colon labels off', () => {
    expect(texts('Coro:\nuno', { maxColonLabelWords: 0 })).toEqual(['Coro:', 'uno']);
  });

  it('keeps a parenthesized line as an ad-lib unless it starts with a section word', () => {
    const plain = parseLyrics('(Coro)\nuno\n(Ay, mami)', pack);
    expect(plain.sections).toEqual([]);
    expect(plain.lines.map((l) => [l.text, l.adlib])).toEqual([
      ['(Coro)', true],
      ['uno', false],
      ['(Ay, mami)', true],
    ]);
    const withWords = parseLyrics('(Coro)\nuno\n(Ay, mami)', pack, { sectionWords: ['coro', 'chorus'] });
    expect(withWords.sections.map((s) => s.label)).toEqual(['Coro']);
    expect(withWords.lines.map((l) => l.text)).toEqual(['uno', '(Ay, mami)']);
  });

  it('a section word also makes a longer colon line a label', () => {
    const ly = parseLyrics('uno\nPre coro final:\ndos', pack, { sectionWords: ['pre'] });
    expect(ly.sections.map((s) => s.label)).toEqual(['Pre coro final']);
  });
});

describe('parseLyrics: repeats', () => {
  it('reads a repeat mark at the end of a line as its repeat count', () => {
    const ly = parseLyrics('Dale, dale (x2)\nDale x3\nOtra 2x\nSin marca', pack);
    expect(ly.lines.map((l) => [l.text, l.repeatCount])).toEqual([
      ['Dale, dale', 2],
      ['Dale', 3],
      ['Otra', 2],
      ['Sin marca', 1],
    ]);
  });

  it('caps repeat counts', () => {
    expect(parseLyrics('Ey (x100)', pack).lines[0]?.repeatCount).toBe(DEFAULT_PARSE_LYRICS_OPTIONS.maxRepeat);
  });

  it('applies a repeat mark on a line of its own to the stanza it closes', () => {
    const ly = parseLyrics('uno\ndos\n(x2)\n\ntres\n\n[x3]', pack);
    expect(ly.stanzas.map((s) => s.repeatCount)).toEqual([2, 3]);
    expect(ly.removed.filter((r) => r.reason === 'repeat')).toHaveLength(2);
    expect(ly.lines).toHaveLength(3);
  });

  it('links repeated lines and stanzas to their first occurrence, ignoring case, accents and punctuation', () => {
    const raw = '[Coro]\nDale, mami, dale\nQue la noche está buena\n\n[Verso]\nOtra cosa\n\n[Coro]\ndale mami dale!\nQue la noche esta buena';
    const ly = parseLyrics(raw, pack);
    expect(ly.lines.map((l) => l.repeatOf)).toEqual([undefined, undefined, undefined, 'l0', 'l1']);
    expect(ly.stanzas.map((s) => s.repeatOf)).toEqual([undefined, undefined, 0]);
  });

  it('marks a bare label that repeats an earlier section', () => {
    const ly = parseLyrics('[Coro]\nDale que dale\n\n[Verso]\nOtra cosa\n\n[Coro]', pack);
    expect(ly.sections.map((s) => s.repeatOf)).toEqual([undefined, undefined, 0]);
    expect(ly.sections[2]?.lines).toEqual([]);
    expect(ly.lines).toHaveLength(2);
  });

  it('expands repeats into lines when asked', () => {
    const raw = '[Coro x2]\nDale que dale\n\n[Verso]\nUno (x2)\nDos\n(x2)\n\n[Coro]';
    const ly = parseLyrics(raw, pack, { expandRepeats: true });
    expect(ly.lines.map((l) => l.text)).toEqual([
      'Dale que dale',
      'Dale que dale', // [Coro x2]
      'Uno',
      'Uno', // Uno (x2)
      'Dos',
      'Uno', // the stanza (x2)
      'Uno',
      'Dos',
      'Dale que dale', // bare [Coro] repeats the chorus, twice as marked there
      'Dale que dale',
    ]);
    expect(ly.lines[1]?.expandedFrom).toBe('l0');
    expect(ly.lines[1]?.repeatOf).toBe('l0');
    expect(ly.lines[1]?.source).toBe('');
    expect(ly.lines[8]?.section).toBe(2);
    expect(ly.sections[2]?.lines).toEqual(['l8', 'l9']);
    expect(ly.lines.filter((l) => l.expandedFrom === undefined)).toHaveLength(3);
  });
});

describe('parseLyrics: junk', () => {
  it('drops lyric-site boilerplate and decorations without breaking the stanza', () => {
    const raw = [
      '12 ContributorsLuna de Santurce Lyrics',
      'Esta noche salimos a janguear',
      'You might also like',
      'el corillo ya está listo',
      '* * *',
      'https://example.com/lyrics',
      '© 2026 Sello',
      'pa bailar42Embed',
    ].join('\n');
    const ly = parseLyrics(raw, pack);
    expect(ly.lines.map((l) => l.text)).toEqual(['Esta noche salimos a janguear', 'el corillo ya está listo', 'pa bailar']);
    expect(ly.lines.map((l) => l.stanza)).toEqual([0, 0, 0]);
    expect(ly.removed.filter((r) => r.reason === 'junk').map((r) => r.sourceLine)).toEqual([0, 2, 4, 5, 6]);
  });

  it('takes custom junk patterns', () => {
    expect(texts('You might also like\nuno', { junkPatterns: [] })).toEqual(['You might also like', 'uno']);
    expect(texts('PUBLICIDAD\nuno', { junkPatterns: [...SITE_JUNK_PATTERNS, /^PUBLICIDAD$/u] })).toEqual(['uno']);
  });
});

describe('parseLyrics: LRC timestamps', () => {
  const lrc = [
    '[ti:Luna de Santurce]',
    '[ar:Rayo K.]',
    '[00:12.50]Esta noche salimos a janguear',
    '[00:15.00][00:40.20]El corillo ya ’tá listo',
    '[00:18.3]pa’ bailar',
    '[00:21.00]',
    '[00:30.00]Otra línea',
  ].join('\n');

  it('reads start times, tags and repeated timestamps in time order', () => {
    const ly = parseLyrics(lrc, pack);
    expect(ly.timed).toBe(true);
    expect(ly.tags).toEqual({ ti: 'Luna de Santurce', ar: 'Rayo K.' });
    expect(ly.lines.map((l) => [l.text, l.startMs, l.endMs])).toEqual([
      ['Esta noche salimos a janguear', 12500, 15000],
      ["El corillo ya 'tá listo", 15000, 18300],
      ["pa' bailar", 18300, 21000], // ended by the empty timed line (a break)
      ['Otra línea', 30000, 40200],
      ["El corillo ya 'tá listo", 40200, undefined],
    ]);
    expect(ly.lines[4]?.repeatOf).toBe('l1');
    // The empty timed line breaks the stanza.
    expect(ly.lines.map((l) => l.stanza)).toEqual([0, 0, 0, 1, 1]);
    expect(ly.removed.filter((r) => r.reason === 'tag')).toHaveLength(2);
  });

  it('applies the offset tag (a positive offset shows lyrics earlier)', () => {
    const ly = parseLyrics('[offset:+500]\n[00:10.00]uno\n[00:00.20]dos', pack);
    expect(ly.lines.map((l) => [l.text, l.startMs])).toEqual([
      ['dos', 0],
      ['uno', 9500],
    ]);
  });

  it('keeps enhanced-LRC word marks with offsets in the cleaned text', () => {
    const ly = parseLyrics('[00:01.00]<00:01.00>El <00:01.40>corillo <00:02.00>ya', pack);
    const line = ly.lines[0];
    expect(line?.text).toBe('El corillo ya');
    expect(line?.wordMarks).toEqual([
      { at: 0, ms: 1000 },
      { at: 3, ms: 1400 },
      { at: 11, ms: 2000 },
    ]);
  });

  it('a bracketed "key: value" line with an unknown key is a section label, not a tag', () => {
    const ly = parseLyrics('[Coro: Bad Bunny]\nuno', pack);
    expect(ly.tags).toEqual({});
    expect(ly.sections[0]?.performer).toBe('Bad Bunny');
  });
});
