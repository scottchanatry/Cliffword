/**
 * Lyric words come from the language pack's segmenter, with the engine's character spans laid
 * over them; LyricLine draws them as written (never adding a space).
 */
import { screen } from '@testing-library/react-native';
import { defaultPacks } from '../../services/defaults';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { LyricLine } from './LyricLine';
import { lineWords, rawLineSpans, rawLineWords, spokenLine, type LineWord } from './lyricWords';
import { mainRegion, regionLabel } from './regionNames';
import { createTranslator } from '../../i18n';

const { lang } = defaultPacks();

describe('lineWords', () => {
  it('keeps punctuation and apostrophes with their words, and the line rebuilds as written', () => {
    const text = "el corillo ya 'tá listo pa' janguear.";
    const words = lineWords(lang, text);
    expect(words.map((w) => `${w.lead}${w.text}${w.trail}`)).toEqual(['el', 'corillo', 'ya', "'tá", 'listo', "pa'", 'janguear.']);
    expect(spokenLine(words, '—')).toBe(text);
    expect(words.every((w) => w.durationMs > 0)).toBe(true);
  });

  it('marks the words a character span falls on: slang, explicit and masked', () => {
    const text = "La calle 'tá brutal, puñeta, qué calor,";
    const words = lineWords(lang, text, { slang: [{ start: 13, end: 19, explicit: false }, { start: 21, end: 27, explicit: true }], masked: [{ start: 21, end: 27 }] });
    const by = (t: string) => words.find((w) => w.text === t) as LineWord;
    expect(by('brutal')).toMatchObject({ slang: true, explicit: false, masked: false });
    expect(by('puñeta')).toMatchObject({ slang: true, explicit: true, masked: true });
    expect(by('calle')).toMatchObject({ slang: false, masked: false });
    expect(spokenLine(words, 'X')).toBe("La calle 'tá brutal, X, qué calor,");
  });

  it('finds slang in raw lines and masks explicit words only when explicit lyrics are off', () => {
    const text = "La calle 'tá brutal, puñeta, qué calor,";
    expect(rawLineSpans(lang, text, { regions: ['PR', 'CARIB'] }).masked).toEqual([]);
    const off = rawLineSpans(lang, text, { regions: ['PR', 'CARIB'], showExplicit: false });
    expect(off.masked).toEqual([{ start: 21, end: 27 }]);
    expect(off.slang.length).toBeGreaterThanOrEqual(2);
    expect(rawLineWords(lang, text, { showExplicit: false }).filter((w) => w.masked).map((w) => w.text)).toEqual(['puñeta']);
  });
});

describe('LyricLine', () => {
  it('draws a script without spaces exactly as written', async () => {
    const words: LineWord[] = ['東京', 'へ', '行く'].map((text, index) => ({
      index,
      text,
      lead: '',
      trail: index === 2 ? '。' : '',
      spaceAfter: false,
      start: 0,
      end: 0,
      slang: index === 0,
      explicit: false,
      masked: false,
      durationMs: 300,
    }));
    await renderWithProviders(<LyricLine words={words} testID="jp" />);
    expect(screen.getByTestId('jp')).toHaveTextContent('東京へ行く。');
    expect(screen.getByTestId('jp-slang-0')).toHaveTextContent('東京');
  });

  it('adds only the space a word has of its own', async () => {
    await renderWithProviders(<LyricLine words={lineWords(lang, 'Wepa, que suene')} testID="es" />);
    expect(screen.getByTestId('es')).toHaveTextContent('Wepa, que suene');
  });
});

describe('region names', () => {
  const { t } = createTranslator();
  it('names regions for lists and picks the main one', () => {
    expect(regionLabel(t, 'DO')).toBe('Dominican Republic');
    expect(regionLabel(t, 'XX')).toBe('XX');
    expect(mainRegion([{ regions: ['PR'] }, { regions: ['CARIB'] }, { regions: ['PR', 'DO'] }])).toBe('PR');
    expect(mainRegion([])).toBeNull();
  });
});
