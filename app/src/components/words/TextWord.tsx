import { Text as Span, StyleSheet, View } from 'react-native';
import { GestureDetector, useTapGesture } from 'react-native-gesture-handler';
import type { ViewWord } from '@cliffword/engine';
import { useI18n } from '../../i18n';
import { colors, radii, typography } from '../../theme';
import { useRootHold } from '../voice/HoldAnywhere';
import { CONTENT_MAX_SCALE } from './fontScale';
import { TILE_TAP_MAX_MS } from './WordTile';

export interface TextWordProps {
  word: ViewWord;
  /** Punctuation and spacing as written: lead + text + trail, then `after` (the word's own space, or the space before the next sentence). */
  after: string;
  speaking?: boolean;
  /** The answer just landed (live orange). */
  answer?: boolean;
  /** Tap to hear it (current sentence only). */
  onHear?: (index: number) => void;
}

/**
 * A word shown as text in the Ink look (Main): Newsreader at story size, with its own
 * punctuation and the space that follows it in the source (none in scripts without spaces).
 * A new word has the dotted accent underline. Tap to hear it.
 */
export function TextWord({ onHear, ...rest }: TextWordProps) {
  return onHear ? <LiveTextWord {...rest} onHear={onHear} /> : <View style={styles.cell}><WordBody {...rest} /></View>;
}

/** The word as written: lead, the word (underlined when new, lit when spoken or answered), trail, then what follows it. */
function WordBody({ word, after, speaking = false, answer = false }: Omit<TextWordProps, 'onHear'>) {
  return (
    <Span style={styles.text} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
      {word.lead}
      <Span style={[word.isNew && styles.newWord, (speaking || answer) && styles.lit, answer && styles.answer]}>{word.text}</Span>
      {word.trail}
      {after}
    </Span>
  );
}

function LiveTextWord({ word, after, speaking, answer, onHear }: TextWordProps & { onHear: (index: number) => void }) {
  const { t } = useI18n();
  const root = useRootHold();
  const tap = useTapGesture({
    maxDuration: TILE_TAP_MAX_MS,
    runOnJS: true,
    testID: `word-${word.index}-tap`,
    onActivate: () => onHear(word.index),
    block: root ?? undefined,
  });
  const body = <WordBody word={word} after={after} speaking={speaking} answer={answer} />;
  return (
    <GestureDetector gesture={tap}>
      <View
        style={styles.cell}
        testID={`word-${word.index}`}
        accessible
        accessibilityLabel={`${word.lead}${word.text}${word.trail}`}
        accessibilityHint={t('word.a11y.hint')}
        accessibilityActions={[{ name: 'activate', label: t('tile.action.hear') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onHear(word.index);
        }}
      >
        {body}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  cell: { justifyContent: 'center' },
  text: { ...typography.story, color: colors.ink },
  newWord: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: colors.accentText,
  },
  lit: { backgroundColor: colors.heat1, borderRadius: radii.tile },
  answer: { backgroundColor: colors.live },
});
