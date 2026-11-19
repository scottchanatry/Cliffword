import { Image, StyleSheet, View } from 'react-native';
import type { StoryScreen } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../../components/words/fontScale';
import { useI18n } from '../../../i18n';
import { vocabImageForWord } from '../../../illustrations';
import { borders, colors, radii, spacing } from '../../../theme';
import { ContentText, InterfaceText } from '../../../ui';
import { LineText } from './LineText';
import { SpeakerLabel } from './Pictures';

type Landing = Extract<StoryScreen, { kind: 'landing' }>;

export interface FeedbackProps {
  screen: Landing;
  /** The model is loaded (the canned note says it is still downloading only when it is not). */
  modelReady: boolean;
  speakingWord?: number | null;
  /** Where the gap was on the cliff screen before (the story's word, in the accent color). */
  answerSpan?: { wordIndex: number; length: number } | null;
}

/**
 * After every answer: a big check or a soft "Not quite", what the learner said (or picked), the
 * story's word (with its picture when it has one), up to three other natural answers, the whole
 * line with its speaker's avatar and its English, and who checked it: the language model on the
 * phone, or matching while the model is still on its way.
 */
export function Feedback({ screen, modelReady, speakingWord = null, answerSpan = null }: FeedbackProps) {
  const { t } = useI18n();
  const credit = screen.outcome.credit;
  const answer = (screen.answer ?? screen.outcome.answer).trim();
  const expected = screen.expected ?? screen.outcome.expected;
  const others = screen.alternatives ?? [];
  const picked = screen.scoredBy === 'options';
  const headline = credit === 'full' ? t('feedback.right') : credit === 'partial' ? t('feedback.close') : t('feedback.notQuite');
  const checked =
    screen.scoredBy === 'model' ? t('feedback.checked.model') : screen.scoredBy === 'canned' && !modelReady ? t('feedback.checked.canned') : null;
  const cliff = answerSpan ?? { wordIndex: answerIndex(screen), length: Math.max(1, expected.split(/\s+/).length) };
  const lib = screen.meta.library;
  const picture = vocabImageForWord(expected);
  return (
    <View style={styles.wrap} testID="feedback">
      <View style={styles.head} accessible accessibilityRole="header" accessibilityLabel={headline} testID={`feedback-${credit}`}>
        <Mark good={credit !== 'none'} />
        <ContentText variant="headline" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {headline}
        </ContentText>
      </View>
      <View style={styles.facts}>
        <View style={styles.factsText}>
          <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="feedback-answer">
            {answer ? (picked ? t('feedback.youPicked', { answer }) : t('feedback.youSaid', { answer })) : t('feedback.skipped')}
          </InterfaceText>
          <InterfaceText variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="feedback-story">
            {t('feedback.story', { word: expected })}
          </InterfaceText>
          {others.length > 0 ? (
            <InterfaceText variant="body" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="feedback-also">
              {t('feedback.also', { words: others.slice(0, 3).join(t('feedback.alsoSeparator')) })}
            </InterfaceText>
          ) : null}
        </View>
        {picture ? (
          <Image source={picture} accessible accessibilityRole="image" accessibilityLabel={expected} style={styles.picture} testID="feedback-picture" />
        ) : null}
      </View>
      <View style={styles.line}>
        <SpeakerLabel trackId={lib?.track} speakerId={lib?.speakerId} label={screen.speaker ?? null} tone="muted" size={36} testID="feedback-speaker" />
        <LineText sentence={screen.sentence} answer={cliff.wordIndex >= 0 ? cliff : null} speakingWord={speakingWord} testID="feedback-line" />
        {screen.translation ? (
          <InterfaceText variant="body" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="feedback-translation">
            {screen.translation}
          </InterfaceText>
        ) : null}
      </View>
      {checked ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="feedback-checked">
          {checked}
        </InterfaceText>
      ) : null}
    </View>
  );
}

/** Without the cliff screen before (a restart): the last word of the line that is the story's first word, or -1. */
function answerIndex(screen: Landing): number {
  const expected = (screen.expected ?? screen.outcome.expected).trim();
  const first = expected.split(/\s+/)[0] ?? '';
  const norm = (s: string) => s.toLocaleLowerCase();
  const hits = screen.sentence.words.filter((w) => norm(w.text) === norm(first));
  return hits[hits.length - 1]?.index ?? -1;
}

/** The big check, or a soft dash for "Not quite" (decorative; the headline says it). */
function Mark({ good }: { good: boolean }) {
  return (
    <View style={[styles.mark, good ? styles.markGood : styles.markSoft]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {good ? <View style={styles.check} /> : <View style={styles.dash} />}
    </View>
  );
}

const MARK = 52;
/** The story word's picture beside the answer, in points. */
const PICTURE = 96;

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mark: { width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: 'center', justifyContent: 'center', borderWidth: borders.strong },
  markGood: { backgroundColor: colors.heat1, borderColor: colors.heat3 },
  markSoft: { backgroundColor: colors.borderSoft, borderColor: colors.border },
  check: { width: 22, height: 12, marginTop: -5, borderLeftWidth: 4, borderBottomWidth: 4, borderColor: colors.accentText, transform: [{ rotate: '-45deg' }] },
  dash: { width: 20, height: 4, borderRadius: 2, backgroundColor: colors.muted },
  facts: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.card, backgroundColor: colors.card },
  factsText: { flex: 1, gap: spacing.xs + 2 },
  picture: { width: PICTURE, height: PICTURE },
  line: { gap: spacing.sm },
});
