/**
 * The story passage: earlier sentences of the chapter and the current one, as the engine's
 * ViewWords (SentenceView.words). Words come from the language pack's segmenter; nothing here
 * splits text or adds spaces of its own: a word's lead, text, trail and its own space
 * (spaceAfter) are drawn as written, and between two sentences the engine's leadAfter decides
 * whether a space goes (none in scripts written without spaces).
 *
 * Two looks, picked by how much of the sentence is text (flowLook):
 * - ink (Main, mostly text): one paragraph of Newsreader words; tiles sit inline; the cliff is
 *   the ink pill with three dots; words after the cliff are not shown yet.
 * - voice (B1, mostly tiles): one block of tiles per sentence, oldest lightest; shown words
 *   are ink chips; the cliff is the dashed orange tile; words not heard yet are dashed outlines.
 */
import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { leadAfter, type SentenceView, type ViewWord } from '@cliffword/engine';
import { spacing } from '../../theme';
import { CliffGap } from './CliffGap';
import { inSpan, type WordSpan } from './answerSpan';
import { TextWord } from './TextWord';
import { tileWidth } from './tileWidth';
import { FutureTile, MaskedWord, StaticTile, TextChip, WordTile, type TileShade } from './WordTile';

export type FlowLook = 'ink' | 'voice';

/** Gap between tiles in the Voice look (the design's 6 dp). */
const TILE_GAP = 6;

/**
 * The look for a sentence: ink when at least half of the words heard so far are shown as
 * text (beginners), voice otherwise (the learner knows them by ear).
 */
export function flowLook(sentence: SentenceView | undefined): FlowLook {
  if (!sentence) return 'ink';
  let text = 0;
  let tiles = 0;
  for (const w of sentence.words) {
    if (w.display === 'text') text++;
    else if (w.display === 'tile') tiles++;
  }
  return text >= tiles ? 'ink' : 'voice';
}

export interface WordFlowProps {
  /** The sentence being played (tap and hold work here). */
  sentence: SentenceView;
  /** Earlier sentences of the chapter, oldest first (drawn only). */
  previous?: readonly SentenceView[];
  look: FlowLook;
  /** ViewWord.index being spoken. */
  speakingWord?: number | null;
  /** The answer's words on a landing (live orange). */
  highlight?: WordSpan | null;
  /** Tap a word or tile of the current sentence. Without it the passage is drawn only. */
  onHear?: (index: number) => void;
  /** Hold a tile of the current sentence. */
  onReveal?: (index: number) => void;
  testID?: string;
}

const NO_SENTENCES: readonly SentenceView[] = [];

/**
 * Same drawing for the same props. The screens re-render many times a second while the learner
 * speaks (listen level and partial); the passage only changes with its sentence, look, spoken
 * word or highlight, so it skips those renders. Arrays and spans compare by content.
 */
export function sameWordFlowProps(a: WordFlowProps, b: WordFlowProps): boolean {
  const pa = a.previous ?? NO_SENTENCES;
  const pb = b.previous ?? NO_SENTENCES;
  return (
    a.sentence === b.sentence &&
    a.look === b.look &&
    (a.speakingWord ?? null) === (b.speakingWord ?? null) &&
    (a.highlight?.wordIndex ?? -1) === (b.highlight?.wordIndex ?? -1) &&
    (a.highlight?.length ?? 0) === (b.highlight?.length ?? 0) &&
    a.onHear === b.onHear &&
    a.onReveal === b.onReveal &&
    a.testID === b.testID &&
    pa.length === pb.length &&
    pa.every((sentence, i) => sentence === pb[i])
  );
}

export const WordFlow = memo(WordFlowView, sameWordFlowProps);

function WordFlowView({ sentence, previous = NO_SENTENCES, look, speakingWord = null, highlight = null, onHear, onReveal, testID = 'word-flow' }: WordFlowProps) {
  const earlier = previous.slice(-2);
  if (look === 'voice') {
    return (
      <View style={styles.voice} testID={testID}>
        {earlier.map((s, i) => (
          <View key={`prev-${i}`} style={styles.tileRow} testID={`${testID}-prev-${i}`}>
            {voiceCells(s, { shade: (earlier.length - i >= 2 ? 2 : 1) as TileShade, current: false })}
          </View>
        ))}
        <View style={styles.tileRow} testID={`${testID}-current`}>
          {voiceCells(sentence, { shade: 0, current: true, speakingWord, highlight, onHear, onReveal })}
        </View>
      </View>
    );
  }
  const cells = [
    ...earlier.flatMap((s, i) => inkCells(s, { key: `prev-${i}`, current: false, next: earlier[i + 1] ?? sentence })),
    ...inkCells(sentence, { key: 'current', current: true, speakingWord, highlight, onHear, onReveal }),
  ];
  return (
    <View style={styles.ink} testID={testID}>
      {cells}
    </View>
  );
}

interface CellOptions {
  current: boolean;
  speakingWord?: number | null;
  highlight?: WordSpan | null;
  onHear?: (index: number) => void;
  onReveal?: (index: number) => void;
}

/** Consecutive gap words form one gap (a multi-word cliff is one place to fill). */
function gapRun(words: readonly ViewWord[], start: number): number {
  let end = start;
  while (end < words.length && words[end]?.display === 'gap') end++;
  return end - start;
}

function voiceCells(s: SentenceView, o: CellOptions & { shade: TileShade }) {
  const out: ReactNode[] = [];
  const words = s.words;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as ViewWord;
    const key = `${w.index}`;
    switch (w.display) {
      case 'gap': {
        const n = gapRun(words, i);
        const width = words.slice(i, i + n).reduce((sum, g) => sum + tileWidth(g.durationMs), 0) + TILE_GAP * (n - 1);
        out.push(
          <View key={key} style={styles.gapCell}>
            <CliffGap variant="live" width={Math.max(width, 60)} />
          </View>,
        );
        i += n - 1;
        break;
      }
      case 'future':
        out.push(<FutureTile key={key} word={w} />);
        break;
      case 'masked':
        out.push(<MaskedWord key={key} word={w} />);
        break;
      case 'text':
        out.push(
          <TextChip
            key={key}
            word={w}
            speaking={o.current && o.speakingWord === w.index}
            answer={o.current && inSpan(o.highlight, w.index)}
            onHear={o.current ? o.onHear : undefined}
          />,
        );
        break;
      case 'tile':
        out.push(
          o.current && o.onHear && o.onReveal ? (
            <WordTile key={key} word={w} shade={o.shade} speaking={o.speakingWord === w.index} onHear={o.onHear} onReveal={o.onReveal} />
          ) : (
            <StaticTile key={key} word={w} shade={o.shade} />
          ),
        );
        break;
    }
  }
  return out;
}

function inkCells(s: SentenceView, o: CellOptions & { key: string; next?: SentenceView }) {
  const out: ReactNode[] = [];
  const words = s.words;
  // The last shown word is followed by the space before the next sentence, if the script uses one.
  const between = o.next ? leadAfter(s.text) : '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as ViewWord;
    const key = `${o.key}-${w.index}`;
    const last = i === words.length - 1;
    const after = (w.spaceAfter ? ' ' : '') + (last ? between : '');
    switch (w.display) {
      case 'gap': {
        const n = gapRun(words, i);
        out.push(
          <View key={key} style={styles.inkGap}>
            <CliffGap variant="ink" />
          </View>,
        );
        i += n - 1;
        break;
      }
      case 'future':
        // Not heard yet: the Ink look stops at the cliff, as the design does.
        break;
      case 'masked':
        out.push(<MaskedWord key={key} word={w} inline />);
        break;
      case 'tile':
        out.push(
          <View key={key} style={styles.inkTile}>
            {o.current && o.onHear && o.onReveal ? (
              <WordTile word={w} inline speaking={o.speakingWord === w.index} onHear={o.onHear} onReveal={o.onReveal} />
            ) : (
              <StaticTile word={w} shade={1} inline />
            )}
          </View>,
        );
        break;
      case 'text':
        out.push(
          <TextWord
            key={key}
            word={w}
            after={after}
            speaking={o.current && o.speakingWord === w.index}
            answer={o.current && inSpan(o.highlight, w.index)}
            onHear={o.current ? o.onHear : undefined}
          />,
        );
        break;
    }
  }
  return out;
}

const styles = StyleSheet.create({
  voice: { gap: spacing.xxs },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: TILE_GAP },
  gapCell: { height: 44, justifyContent: 'center' },
  ink: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  inkGap: { height: 36, justifyContent: 'center', marginLeft: spacing.xxs },
  inkTile: { marginRight: spacing.xs },
});
