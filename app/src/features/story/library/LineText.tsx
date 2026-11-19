import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SentenceView } from '@cliffword/engine';
import { CliffGap } from '../../../components/words/CliffGap';
import { CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { colors, radii, spacing } from '../../../theme';
import { ContentText } from '../../../ui';

export interface LineTextProps {
  sentence: SentenceView;
  /** ViewWord.index being spoken (lit). */
  speakingWord?: number | null;
  /** Words of the answer to draw in the accent color (a landing): first index and length. */
  answer?: { wordIndex: number; length: number } | null;
  testID?: string;
}

/**
 * A story line as large text, word by word as the engine gives them (lead, text, trail and the
 * word's own space; nothing is split here). The hidden words are one ink gap that keeps their
 * punctuation; words not heard yet (predict mode) are left out; masked explicit words are left out.
 */
export const LineText = memo(function LineText({ sentence, speakingWord = null, answer = null, testID = 'line-text' }: LineTextProps) {
  const parts: ReactElement[] = [];
  let gapDrawn = false;
  const words = sentence.words;
  words.forEach((w, i) => {
    if (w.display === 'future' || w.display === 'masked') return;
    if (w.display === 'gap') {
      if (!gapDrawn) {
        gapDrawn = true;
        // The punctuation around the hidden words stays on the line ('Son las ___.'), on the
        // gap itself so it never wraps alone; not when the rest of the line is not heard yet.
        let end = i;
        while (words[end + 1]?.display === 'gap') end++;
        const trail = words[end + 1]?.display === 'future' ? '' : (words[end]?.trail ?? '');
        parts.push(
          <View key={`gap-${w.index}`} style={[styles.word, styles.gap]}>
            {w.lead ? <Word lead="" text={w.lead} trail="" /> : null}
            <CliffGap testID={`${testID}-gap`} />
            {trail ? (
              <View style={styles.trail}>
                <Word lead="" text={trail} trail="" />
              </View>
            ) : null}
          </View>,
        );
      }
      return;
    }
    const inAnswer = answer !== null && w.index >= answer.wordIndex && w.index < answer.wordIndex + answer.length;
    const spoken = speakingWord === w.index;
    parts.push(
      <View key={w.index} style={[styles.word, w.spaceAfter && styles.space]}>
        <Word lead={w.lead} text={w.text} trail={w.trail} accent={inAnswer} spoken={spoken} />
      </View>,
    );
  });
  return (
    <View style={styles.line} testID={testID}>
      {parts}
    </View>
  );
});

/** One word with its punctuation; the answer's accent and underline fall on the word itself. */
function Word({ lead, text, trail, accent = false, spoken = false }: { lead: string; text: string; trail: string; accent?: boolean; spoken?: boolean }) {
  return (
    <ContentText variant="story" style={[styles.text, spoken && styles.spoken]} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
      {lead}
      <ContentText variant="story" style={[styles.text, accent && styles.accent]} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {text}
      </ContentText>
      {trail}
    </ContentText>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: spacing.xs },
  word: { flexDirection: 'row', alignItems: 'center' },
  space: { marginRight: 7 },
  gap: { marginRight: 7, gap: spacing.xs },
  // Punctuation sits against the gap, as it would against the word.
  trail: { marginLeft: spacing.xxs - spacing.xs },
  text: { fontSize: 28, lineHeight: 38 },
  accent: { color: colors.accentText, textDecorationLine: 'underline' },
  spoken: { backgroundColor: colors.heat1, borderRadius: radii.tile },
});
