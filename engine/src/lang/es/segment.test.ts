import { describe, expect, it } from 'vitest';
import type { Segment } from '../types';
import { createMockModel } from '../../model/mock';
import { MOCK_CORPUS_ES } from '../../model/mockCorpus';
import { createSegmenter, segment } from './segment';

const words = (text: string) => segment(text).filter((s) => s.kind === 'word').map((s) => s.text);
const kinds = (text: string) => segment(text).map((s) => [s.text, s.kind]);

function expectCovers(text: string, segs: Segment[]): void {
  expect(segs.map((s) => s.text).join('')).toBe(text);
  let pos = 0;
  for (const s of segs) {
    expect(s.start).toBe(pos);
    expect(s.end).toBe(pos + s.text.length);
    expect(text.slice(s.start, s.end)).toBe(s.text);
    pos = s.end;
  }
  expect(pos).toBe(text.length);
}

describe('segment', () => {
  it('covers the text exactly, spaces included', () => {
    const samples = [
      'Marta llegó tarde al mercado.',
      'Hola,¿cómo estás?',
      "¡'Tá brutal, pa' la playa!",
      '  dos  espacios\ty\ntabulador ',
      'Cuesta 3,5 euros — o 1.000 pesos…',
      'Vamos 🎉👍🏽 a bailar 🇵🇷',
      '',
    ];
    for (const t of samples) expectCovers(t, segment(t));
  });

  it('returns [] for empty text and only spaces for whitespace', () => {
    expect(segment('')).toEqual([]);
    expect(segment('   ')).toEqual([{ text: '   ', norm: '', start: 0, end: 3, kind: 'space' }]);
  });

  it('splits words, punctuation and spaces', () => {
    expect(kinds('Estoy cansado.')).toEqual([
      ['Estoy', 'word'], [' ', 'space'], ['cansado', 'word'], ['.', 'punct'],
    ]);
  });

  it('handles inverted marks and missing spaces after punctuation', () => {
    expect(kinds('Hola,¿cómo estás?')).toEqual([
      ['Hola', 'word'], [',', 'punct'], ['¿', 'punct'], ['cómo', 'word'], [' ', 'space'], ['estás', 'word'], ['?', 'punct'],
    ]);
    expect(words('¡Qué bien!¿Y tú?')).toEqual(['Qué', 'bien', 'Y', 'tú']);
    expect(words('Sí.No.Quizás')).toEqual(['Sí', 'No', 'Quizás']);
  });

  it('keeps accents and ñ inside words', () => {
    expect(words('El niño comió piña después')).toEqual(['El', 'niño', 'comió', 'piña', 'después']);
    expect(words('pingüino canción')).toEqual(['pingüino', 'canción']);
    // Decomposed accents stay in the word.
    expect(words('está bien')).toEqual(['está', 'bien']);
  });

  it('keeps clipped forms with apostrophes as one word', () => {
    expect(words("El corillo ya 'tá listo pa' bailar.")).toEqual(['El', 'corillo', 'ya', "'tá", 'listo', "pa'", 'bailar']);
    expect(words("Vamos pa'lante")).toEqual(['Vamos', "pa'lante"]);
    expect(words("pa'l carajo")).toEqual(["pa'l", 'carajo']);
    expect(words("No hay na' que hacer, to' 'tá bien")).toEqual(['No', 'hay', "na'", 'que', 'hacer', "to'", "'tá", 'bien']);
    expect(words("'Toy cansao")).toEqual(["'Toy", 'cansao']);
  });

  it('accepts typographic apostrophes in clipped forms', () => {
    expect(words('’tá bien pa’ ti')).toEqual(['’tá', 'bien', 'pa’', 'ti']);
    const s = segment('’tá');
    expect(s[0]?.norm).toBe("'tá");
  });

  it('treats a pair of apostrophes around a word as quotes', () => {
    expect(kinds("'hola' dijo")).toEqual([
      ["'", 'punct'], ['hola', 'word'], ["'", 'punct'], [' ', 'space'], ['dijo', 'word'],
    ]);
    // Inside quotes a known clipped form keeps its apostrophe.
    expect(words("'Vamos pa' la playa'")).toEqual(['Vamos', "pa'", 'la', 'playa']);
    const last = segment("'Vamos pa' la playa'").at(-1);
    expect(last).toMatchObject({ text: "'", kind: 'punct' });
  });

  it('reads standard words in single quotes as quoted, not clipped (lng-10)', () => {
    expect(words("Dijo: 'tan bonito'.")).toEqual(['Dijo', 'tan', 'bonito']);
    expect(words("Ella dijo 'eso' y se fue.")).toEqual(['Ella', 'dijo', 'eso', 'y', 'se', 'fue']);
    expect(words("Dijo 'mucho' y se fue.")).toEqual(['Dijo', 'mucho', 'y', 'se', 'fue']);
    expect(words("Me dio la 'mano' ayer.")).toEqual(['Me', 'dio', 'la', 'mano', 'ayer']);
    // Without a closing quote, or before a clipped form, the clip stays.
    expect(words("Ellos 'tan aquí")).toEqual(['Ellos', "'tan", 'aquí']);
    expect(words("Oye 'mano, ven")).toEqual(['Oye', "'mano", 'ven']);
    expect(words("'Tán to' locos")).toEqual(["'Tán", "to'", 'locos']);
    expect(words("Dame eso' libros")).toEqual(['Dame', "eso'", 'libros']);
    expect(words("'Vamos pa' la playa'")).toEqual(['Vamos', "pa'", 'la', 'playa']);
  });

  it('keeps ordinal marks with their number (lng-10)', () => {
    expect(kinds('El 2º piso')).toEqual([['El', 'word'], [' ', 'space'], ['2º', 'number'], [' ', 'space'], ['piso', 'word']]);
    expect(kinds('la 1ª vez').filter((k) => k[1] !== 'space')).toEqual([['la', 'word'], ['1ª', 'number'], ['vez', 'word']]);
  });

  it('treats a lone apostrophe as punctuation', () => {
    expect(kinds("' ")).toEqual([["'", 'punct'], [' ', 'space']]);
  });

  it('keeps numbers with decimal comma and thousands point', () => {
    expect(kinds('3,5 y 1.000 y 2024')).toEqual([
      ['3,5', 'number'], [' ', 'space'], ['y', 'word'], [' ', 'space'], ['1.000', 'number'], [' ', 'space'],
      ['y', 'word'], [' ', 'space'], ['2024', 'number'],
    ]);
    expect(kinds('Tengo 3, tú 5.')).toEqual([
      ['Tengo', 'word'], [' ', 'space'], ['3', 'number'], [',', 'punct'], [' ', 'space'], ['tú', 'word'],
      [' ', 'space'], ['5', 'number'], ['.', 'punct'],
    ]);
  });

  it('groups ellipses and keeps dashes and quotes separate', () => {
    expect(kinds('Bueno... ¡ya!!')).toEqual([
      ['Bueno', 'word'], ['...', 'punct'], [' ', 'space'], ['¡', 'punct'], ['ya', 'word'], ['!!', 'punct'],
    ]);
    expect(kinds('—Sí—dijo «claro» “vale”')).toEqual([
      ['—', 'punct'], ['Sí', 'word'], ['—', 'punct'], ['dijo', 'word'], [' ', 'space'], ['«', 'punct'],
      ['claro', 'word'], ['»', 'punct'], [' ', 'space'], ['“', 'punct'], ['vale', 'word'], ['”', 'punct'],
    ]);
    expect(kinds('Pues…')).toEqual([['Pues', 'word'], ['…', 'punct']]);
  });

  it('keeps emoji clusters whole', () => {
    expect(kinds('Hola👋🏽!')).toEqual([['Hola', 'word'], ['👋🏽', 'punct'], ['!', 'punct']]);
    expect(kinds('👨‍👩‍👧')).toEqual([['👨‍👩‍👧', 'punct']]);
    expect(kinds('🇵🇷🇩🇴')).toEqual([['🇵🇷', 'punct'], ['🇩🇴', 'punct']]);
    expect(kinds('❤️')).toEqual([['❤️', 'punct']]);
  });

  it('gives normalized forms: lowercase words, raw punctuation, empty spaces', () => {
    const s = segment('¡Él ESTÁ aquí!');
    expect(s.map((x) => x.norm)).toEqual(['¡', 'él', '', 'está', '', 'aquí', '!']);
  });

  it('accepts extra clipped forms from register packs', () => {
    const plain = createSegmenter();
    const custom = createSegmenter({ leadingClips: ["'cuchar"] });
    expect(plain("'cuchar bien").filter((x) => x.kind === 'word').map((x) => x.text)).toEqual(['cuchar', 'bien']);
    expect(custom("'cuchar bien").filter((x) => x.kind === 'word').map((x) => x.text)).toEqual(["'cuchar", 'bien']);
  });
});

describe('segment agrees with the mock model tokenizer', () => {
  it('every word starts and ends on a token boundary for the mock corpus', async () => {
    const model = createMockModel();
    for (const sentence of MOCK_CORPUS_ES) {
      const tokens = await model.scoreContinuation('', sentence);
      const bounds = new Set<number>();
      for (const t of tokens) {
        const ws = /^\s*/.exec(t.text)?.[0].length ?? 0;
        bounds.add(t.start + ws);
        bounds.add(t.end);
      }
      for (const s of segment(sentence)) {
        if (s.kind !== 'word') continue;
        expect(bounds.has(s.start), `${sentence}: start of "${s.text}"`).toBe(true);
        expect(bounds.has(s.end), `${sentence}: end of "${s.text}"`).toBe(true);
      }
    }
  });
});
