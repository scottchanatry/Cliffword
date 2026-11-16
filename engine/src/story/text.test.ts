import { describe, expect, it } from 'vitest';
import { SPANISH_ABBREVIATIONS } from '../lang/es/story';
import {
  capitalizeFirst,
  clamp01,
  contentSegments,
  foldForMatch,
  hasLetter,
  isCapitalized,
  sentenceEndFlags,
  sentenceStartFlags,
  splitSentences,
  wholeAtLeast,
  wordSegments,
} from './text';
import { createStubPack } from './testStubs';

const pack = createStubPack();

describe('splitSentences', () => {
  it('splits on . ? ! and keeps the punctuation', () => {
    expect(splitSentences('Marta llegó. ¿Qué pasó? ¡Nada!')).toEqual(['Marta llegó.', '¿Qué pasó?', '¡Nada!']);
  });

  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('"Marta compró pan." Marta bought bread.')).toEqual(['"Marta compró pan."', 'Marta bought bread.']);
  });

  it('does not split abbreviations, decimals or mid-sentence ellipses', () => {
    expect(splitSentences('El Sr. García llegó. Luego se fue.', SPANISH_ABBREVIATIONS)).toEqual(['El Sr. García llegó.', 'Luego se fue.']);
    // No abbreviations by default: the list is the language pack's (LanguagePack.abbreviations).
    expect(splitSentences('El Sr. García llegó.')).toEqual(['El Sr.', 'García llegó.']);
    expect(splitSentences('Cuesta 3.5 euros. Bien.')).toEqual(['Cuesta 3.5 euros.', 'Bien.']);
    expect(splitSentences('Marta... compró pan. Luego...')).toEqual(['Marta... compró pan.', 'Luego...']);
    expect(splitSentences('Marta... Luego volvió.')).toEqual(['Marta...', 'Luego volvió.']);
  });

  it('keeps a final piece without end punctuation and drops empty pieces', () => {
    expect(splitSentences('Marta llegó. y luego')).toEqual(['Marta llegó.', 'y luego']);
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences('. .')).toEqual(['.', '.']);
  });

  it('splits CJK sentences without spaces', () => {
    expect(splitSentences('猫が来た。犬も来た。')).toEqual(['猫が来た。', '犬も来た。']);
  });

  it("keeps clipped forms ('tá, pa')", () => {
    expect(splitSentences("Vamos pa' la playa. 'Tá brutal.")).toEqual(["Vamos pa' la playa.", "'Tá brutal."]);
  });
});

describe('segment flags', () => {
  it('marks sentence starts after sentence ends and opening marks', () => {
    const segs = pack.segment('Marta llegó. ¿Compró pan? Sí.');
    const starts = segs.filter((_, i) => sentenceStartFlags(segs)[i]).map((s) => s.text);
    expect(starts).toEqual(['Marta', 'Compró', 'Sí']);
  });

  it('does not end a sentence after an abbreviation', () => {
    const segs = pack.segment('Vio al Sr. García.');
    const ends = sentenceEndFlags(segs, SPANISH_ABBREVIATIONS);
    expect(segs.filter((_, i) => ends[i]).map((s) => s.start)).toEqual(['Vio al Sr. García'.length]);
  });

  it('content and word segments', () => {
    const segs = pack.segment('Compró 3 panes.');
    expect(contentSegments(segs).map((s) => s.text)).toEqual(['Compró', '3', 'panes']);
    expect(wordSegments(segs).map((s) => s.text)).toEqual(['Compró', 'panes']);
  });
});

describe('string helpers', () => {
  it('isCapitalized and capitalizeFirst skip leading punctuation', () => {
    expect(isCapitalized("'Tá")).toBe(true);
    expect(isCapitalized('¿Qué')).toBe(true);
    expect(isCapitalized('qué')).toBe(false);
    expect(isCapitalized('...')).toBe(false);
    expect(isCapitalized('猫')).toBe(false);
    expect(capitalizeFirst("'tá listo")).toBe("'Tá listo");
    expect(capitalizeFirst('¿ñandú?')).toBe('¿Ñandú?');
    expect(capitalizeFirst('...')).toBe('...');
  });

  it('foldForMatch removes accents and case', () => {
    expect(foldForMatch('ORACIÓN')).toBe('oracion');
    expect(foldForMatch('Oración')).toBe('oracion');
  });

  it('hasLetter', () => {
    expect(hasLetter('¿?')).toBe(false);
    expect(hasLetter('123')).toBe(false);
    expect(hasLetter("'tá")).toBe(true);
  });

  it('clamp01 and wholeAtLeast', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
    expect(wholeAtLeast(1.6)).toBe(2);
    expect(wholeAtLeast(0)).toBe(1);
    expect(wholeAtLeast(Number.NaN)).toBe(1);
    expect(wholeAtLeast(0.2, 0)).toBe(0);
  });
});
