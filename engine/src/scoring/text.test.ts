import { describe, expect, it } from 'vitest';
import {
  atSentenceStart,
  clampLogprob,
  contentSegments,
  endsInsideWord,
  firstChar,
  firstLetterIsUpper,
  foldAccents,
  isAllSpace,
  lastChar,
  logAddExp,
  lowerFirstLetter,
  needsLeadingSpace,
  trimAnswer,
  upperFirstLetter,
} from './text';
import { createStubPack, stubSegment } from './testStubs';

const pack = createStubPack();

describe('needsLeadingSpace', () => {
  it('needs a space after a word, number, comma or full stop', () => {
    expect(needsLeadingSpace('Marta empezó a')).toBe(true);
    expect(needsLeadingSpace('Tengo 3')).toBe(true);
    expect(needsLeadingSpace('Sí,')).toBe(true);
    expect(needsLeadingSpace('Llegó tarde.')).toBe(true);
  });

  it('needs no space at the start, after whitespace or after opening punctuation', () => {
    expect(needsLeadingSpace('')).toBe(false);
    expect(needsLeadingSpace('Marta empezó a ')).toBe(false);
    expect(needsLeadingSpace('¿')).toBe(false);
    expect(needsLeadingSpace('Ella dijo: ¡')).toBe(false);
    expect(needsLeadingSpace('Ella dijo «')).toBe(false);
    expect(needsLeadingSpace('(')).toBe(false);
  });

  it('treats straight quotes and apostrophes by position', () => {
    expect(needsLeadingSpace('Ella dijo "')).toBe(false);
    expect(needsLeadingSpace('Ella dijo "hola"')).toBe(true);
    expect(needsLeadingSpace("Vamos pa'")).toBe(true);
    expect(needsLeadingSpace("Ella dijo '")).toBe(false);
  });
});

describe('atSentenceStart', () => {
  it('is true at the very start and after sentence-final punctuation', () => {
    expect(atSentenceStart('')).toBe(true);
    expect(atSentenceStart('   ')).toBe(true);
    expect(atSentenceStart('Marta llegó tarde.')).toBe(true);
    expect(atSentenceStart('¿Dónde estás? ')).toBe(true);
    expect(atSentenceStart('¡Qué bien!')).toBe(true);
    expect(atSentenceStart('Llegó tarde. ¿')).toBe(true);
    expect(atSentenceStart('Dijo «hola.»')).toBe(true);
  });

  it('is false mid-sentence', () => {
    expect(atSentenceStart('Marta empezó a')).toBe(false);
    expect(atSentenceStart('Sí,')).toBe(false);
    expect(atSentenceStart('Ella dijo: ¿')).toBe(false);
    expect(atSentenceStart("Vamos pa'")).toBe(false);
  });
});

describe('foldAccents', () => {
  it('removes acute, grave, circumflex and diaeresis accents', () => {
    expect(foldAccents('reír')).toBe('reir');
    expect(foldAccents('Dónde está')).toBe('Donde esta');
    expect(foldAccents('pingüino')).toBe('pinguino');
    expect(foldAccents('à côté')).toBe('a cote');
  });

  it('keeps ñ and non-Latin marks with the default set', () => {
    expect(foldAccents('año')).toBe('año');
    expect(foldAccents('ありがとうございます')).toBe('ありがとうございます');
  });

  it('accepts a custom mark set and recomposes', () => {
    expect(foldAccents('não', '̃')).toBe('nao');
    expect(foldAccents('año', '')).toBe('año');
    expect(foldAccents('ñ')).toBe('ñ');
  });
});

describe('case helpers', () => {
  it('changes only the first letter', () => {
    expect(upperFirstLetter('¿qué tal?')).toBe('¿Qué tal?');
    expect(upperFirstLetter("'tá")).toBe("'Tá");
    expect(lowerFirstLetter('Llorar')).toBe('llorar');
    expect(upperFirstLetter('...')).toBe('...');
    expect(upperFirstLetter('')).toBe('');
  });

  it('detects an uppercase first letter', () => {
    expect(firstLetterIsUpper('¿Qué')).toBe(true);
    expect(firstLetterIsUpper('qué')).toBe(false);
    expect(firstLetterIsUpper('123')).toBe(false);
    expect(firstLetterIsUpper('Ñandú')).toBe(true);
  });
});

describe('character helpers', () => {
  it('handles surrogate pairs at both ends', () => {
    expect(firstChar('𝒜b')).toBe('𝒜');
    expect(lastChar('a𝒜')).toBe('𝒜');
    expect(lastChar('')).toBe('');
    expect(firstChar('')).toBe('');
  });

  it('knows when text ends inside a word', () => {
    expect(endsInsideWord('Estoy muy cans')).toBe(true);
    expect(endsInsideWord("pa'")).toBe(true);
    expect(endsInsideWord("dijo '")).toBe(false);
    expect(endsInsideWord('hola ')).toBe(false);
    expect(endsInsideWord('hola.')).toBe(false);
    expect(endsInsideWord('')).toBe(false);
    expect(endsInsideWord('café')).toBe(true);
  });

  it('detects whitespace-only strings', () => {
    expect(isAllSpace(' ')).toBe(true);
    expect(isAllSpace('\n\t')).toBe(true);
    expect(isAllSpace('')).toBe(false);
    expect(isAllSpace(' a')).toBe(false);
  });
});

describe('trimAnswer', () => {
  it('removes surrounding whitespace and trailing punctuation', () => {
    expect(trimAnswer(pack, '  leer.  ')).toBe('leer');
    expect(trimAnswer(pack, 'leer la nota!!')).toBe('leer la nota');
    expect(trimAnswer(pack, 'leer, comer')).toBe('leer, comer');
  });

  it('keeps leading punctuation and apostrophes inside clipped forms', () => {
    expect(trimAnswer(pack, '¿Qué?')).toBe('¿Qué');
    expect(trimAnswer(pack, "pa'")).toBe("pa'");
    expect(trimAnswer(pack, "'tá.")).toBe("'tá");
  });

  it('returns empty text for input without words', () => {
    expect(trimAnswer(pack, '')).toBe('');
    expect(trimAnswer(pack, '   ')).toBe('');
    expect(trimAnswer(pack, '¿?!...')).toBe('');
  });

  it('keeps numbers as content', () => {
    expect(trimAnswer(pack, 'a las 3.')).toBe('a las 3');
    expect(contentSegments(stubSegment('a las 3.')).map((s) => s.text)).toEqual(['a', 'las', '3']);
  });
});

describe('numeric helpers', () => {
  it('clamps log-probabilities to the floor', () => {
    expect(clampLogprob(-Infinity, -100)).toBe(-100);
    expect(clampLogprob(Number.NaN, -100)).toBe(-100);
    expect(clampLogprob(-250, -100)).toBe(-100);
    expect(clampLogprob(-2, -100)).toBe(-2);
    expect(clampLogprob(0.5, -100)).toBe(0);
  });

  it('adds probabilities in log space', () => {
    expect(logAddExp(Math.log(0.2), Math.log(0.3))).toBeCloseTo(Math.log(0.5), 12);
    expect(logAddExp(-Infinity, -1)).toBe(-1);
    expect(logAddExp(-2, -Infinity)).toBe(-2);
    expect(logAddExp(-1000, -1000)).toBeCloseTo(-1000 + Math.log(2), 9);
  });
});
