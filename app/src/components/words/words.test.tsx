/**
 * The word components: no space is ever added between words (a pack without spaces keeps
 * its text exactly), heat shading per level, tile widths, the understood line, the gloss chip.
 */
import type React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { screen } from '@testing-library/react-native';
import type { SaidWord, SentenceView, ViewWord } from '@cliffword/engine';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { colors, heatColors } from '../../theme';
import { CliffGap } from './CliffGap';
import { firstSense, GlossChip } from './GlossChip';
import { HeatLegend, HeatSentence } from './HeatSentence';
import { templateParts } from './TemplateText';
import { tileWidth } from './tileWidth';
import { UnderstoodLine } from './UnderstoodLine';
import { flowLook, WordFlow } from './WordFlow';

const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

function word(index: number, text: string, over: Partial<ViewWord> = {}): ViewWord {
  return { index, text, lead: '', trail: '', spaceAfter: false, key: `ja:${text}`, display: 'text', durationMs: 300, isNew: false, slang: false, explicit: false, ...over };
}

function sentence(text: string, words: ViewWord[]): SentenceView {
  return { text, words, speechRate: 1, durationMs: words.reduce((s, w) => s + w.durationMs, 0), glosses: [], slang: false };
}

/** A sentence of a language written without spaces, as a pack's segmenter would split it. */
const JA_PREV = sentence('猫が好き。', [word(0, '猫'), word(1, 'が'), word(2, '好き', { trail: '。' })]);
const JA = sentence('私は学生です。', [word(0, '私'), word(1, 'は'), word(2, '学生', { display: 'tile' }), word(3, 'です', { trail: '。' })]);

type Node = string | { children?: readonly Node[] | null };

/** Every string drawn under a host element, in order (what a reader sees, spaces included). */
function drawnText(node: Node): string {
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(drawnText).join('');
}

/** WordFlow in the gesture root, as the app renders it. */
function inRoot(ui: React.ReactElement) {
  return renderWithProviders(<GestureHandlerRootView>{ui}</GestureHandlerRootView>);
}

describe('WordFlow never splits or spaces words itself', () => {
  it('draws a no-space sentence exactly as written (Ink look), sentences joined without a space', async () => {
    const all = sentence('私は学生です。', JA.words.map((w) => ({ ...w, display: 'text' as const })));
    await inRoot(<WordFlow sentence={all} previous={[JA_PREV]} look="ink" onHear={jest.fn()} onReveal={jest.fn()} />);
    const text = drawnText(screen.getByTestId('word-flow') as unknown as Node);
    expect(text).toBe('猫が好き。私は学生です。');
    expect(text).not.toMatch(/\s/);
  });

  it('draws a spaced sentence with exactly its own spaces and punctuation', async () => {
    const es = sentence('¿Qué hiciste, Marta?', [
      word(0, 'Qué', { lead: '¿', spaceAfter: true }),
      word(1, 'hiciste', { trail: ',', spaceAfter: true }),
      word(2, 'Marta', { trail: '?' }),
    ]);
    await inRoot(<WordFlow sentence={es} look="ink" onHear={jest.fn()} onReveal={jest.fn()} />);
    expect(drawnText(screen.getByTestId('word-flow') as unknown as Node)).toBe('¿Qué hiciste, Marta?');
  });

  it('adds no space characters in the Voice look either', async () => {
    await inRoot(<WordFlow sentence={JA} previous={[JA_PREV]} look="voice" onHear={jest.fn()} onReveal={jest.fn()} />);
    const text = drawnText(screen.getByTestId('word-flow') as unknown as Node);
    expect(text).toBe('猫が好き私はです');
    expect(text).not.toMatch(/\s/);
    // The tile hides its word; its name is its number.
    expect(screen.getByTestId('tile-2').props.accessibilityLabel).toBe('Word 3');
  });

  it('keeps a tile inline in the Ink look: hidden word, named by its number, a 44 dp target', async () => {
    const onReveal = jest.fn();
    const es = sentence('Marta llegó tarde.', [
      word(0, 'Marta', { spaceAfter: true }),
      word(1, 'llegó', { display: 'tile', spaceAfter: true }),
      word(2, 'tarde', { trail: '.' }),
    ]);
    await inRoot(<WordFlow sentence={es} look="ink" onHear={jest.fn()} onReveal={onReveal} />);
    expect(drawnText(screen.getByTestId('word-flow') as unknown as Node)).toBe('Marta tarde.');
    const tile = screen.getByTestId('tile-1');
    expect(tile.props.accessibilityLabel).toBe('Word 2');
    expect(flat(tile.props.style).minHeight).toBe(44);
  });

  it('picks the look by how much is text', () => {
    expect(flowLook(JA)).toBe('ink');
    expect(flowLook(sentence('x', [word(0, 'a', { display: 'tile' }), word(1, 'b', { display: 'tile' }), word(2, 'c')]))).toBe('voice');
  });
});

describe('HeatSentence', () => {
  const said: SaidWord[] = [
    { text: 'Ayer', heat: 0 },
    { text: 'fui', heat: 1 },
    { text: 'Soy', heat: 2 },
    { text: 'nadamos', heat: 3 },
  ];

  it('shades each word by its heat on the amber scale', async () => {
    await renderWithProviders(<HeatSentence said={said} />);
    expect(flat(screen.getByTestId('said-0-word').props.style).backgroundColor).toBeUndefined();
    expect(flat(screen.getByTestId('said-1-word').props.style).backgroundColor).toBe(colors.heat1);
    expect(flat(screen.getByTestId('said-2-word').props.style).backgroundColor).toBe(colors.heat2);
    expect(flat(screen.getByTestId('said-3-word').props.style).backgroundColor).toBe(colors.heat3);
    expect(heatColors).toEqual([null, '#FFE9C7', '#FFC46B', '#F08A1D']);
    // Heat is named, not only coloured.
    expect(screen.getByLabelText('fui, a little surprising')).toBeOnTheScreen();
    expect(screen.getByLabelText('nadamos, very surprising')).toBeOnTheScreen();
  });

  it('draws the flagged word at least at heat 2', async () => {
    await renderWithProviders(<HeatSentence said={said} highlight={1} />);
    expect(flat(screen.getByTestId('said-1-word').props.style).backgroundColor).toBe(colors.heat2);
    expect(screen.getByLabelText('fui, the word that surprised me')).toBeOnTheScreen();
  });

  it('puts the script’s own space between words: one in Spanish, none in Japanese', async () => {
    const { unmount } = await renderWithProviders(<HeatSentence said={said} />);
    expect(drawnText(screen.getByTestId('heat-sentence') as unknown as Node)).toBe('Ayer fui Soy nadamos');
    await unmount();
    await renderWithProviders(<HeatSentence said={[{ text: '私', heat: 0 }, { text: 'は', heat: 2 }, { text: '学生', heat: 0 }]} />);
    expect(drawnText(screen.getByTestId('heat-sentence') as unknown as Node)).toBe('私は学生');
  });

  it('has a legend from expected to surprising', async () => {
    await renderWithProviders(<HeatLegend />);
    expect(screen.getByText('expected')).toBeOnTheScreen();
    expect(screen.getByText('surprising')).toBeOnTheScreen();
  });
});

describe('tiles and chips', () => {
  it('sizes tiles by spoken length, within bounds', () => {
    expect(tileWidth(400)).toBe(46);
    expect(tileWidth(200)).toBe(23);
    expect(tileWidth(10)).toBe(14);
    expect(tileWidth(5000)).toBe(120);
    expect(tileWidth(Number.NaN)).toBe(14);
  });

  it('announces the gap as a gap in both looks', async () => {
    await renderWithProviders(
      <>
        <CliffGap />
        <CliffGap variant="live" width={84} testID="live" />
      </>,
    );
    expect(screen.getAllByLabelText('Gap: the story stops here')).toHaveLength(2);
    expect(flat(screen.getByTestId('live').props.style)).toMatchObject({ width: 84, borderColor: colors.live, borderStyle: 'dashed' });
  });

  it('shows the gloss chip with the first sense', async () => {
    expect(firstSense('stall, post, position')).toBe('stall');
    expect(firstSense('late; afternoon')).toBe('late');
    expect(firstSense('to be (identity, origin, time)')).toBe('to be');
    expect(firstSense('(slang) dude, buddy')).toBe('(slang) dude');
    expect(firstSense('(slang)')).toBe('(slang)');
    await renderWithProviders(<GlossChip word="puesto" gloss="stall, post, position" />);
    expect(screen.getByText('puesto · stall · new for you')).toBeOnTheScreen();
  });

  it('fills a template with styled parts in the translation’s order', () => {
    expect(templateParts('{a} · {b} · {c}', { a: 'x', b: 'y' })).toEqual(['x', ' · ', 'y', ' · ', '{c}'].map((p) => (p === 'x' || p === 'y' ? expect.anything() : p)));
  });
});

describe('UnderstoodLine', () => {
  it('reads "Understood 6 of 7 words" and draws the missed word hollow', async () => {
    const words = ['Entonces', 'vio', 'una', 'nota', 'en', 'la', 'puerta'].map((text, i) => ({ text, landed: i !== 3 }));
    await renderWithProviders(<UnderstoodLine alignment={{ understood: 6, total: 7, ui: { key: 'stats.understood', params: { n: 6, m: 7 } }, words }} />);
    expect(screen.getByText('Understood 6 of 7 words')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/understood-\d+-landed/)).toHaveLength(6);
    expect(screen.getByLabelText('nota, missed')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('understood-3-missed').props.style).borderStyle).toBe('dashed');
  });
});
