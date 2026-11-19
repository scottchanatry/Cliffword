import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE } from '../../../components/words/fontScale';
import { tKey, useI18n, type CatalogKey } from '../../../i18n';
import { colors, radii, spacing } from '../../../theme';
import { Button, InterfaceText } from '../../../ui';

/** The three tips of the first episode, in order. */
export type GuideTip = 'listen' | 'answer' | 'feedback';

export const GUIDE_TIPS: readonly GuideTip[] = ['listen', 'answer', 'feedback'];

const TEXT: Readonly<Record<GuideTip, { heading: CatalogKey; body: CatalogKey }>> = {
  listen: { heading: tKey('guide.listen.title'), body: tKey('guide.listen.body') },
  answer: { heading: tKey('guide.answer.title'), body: tKey('guide.answer.body') },
  feedback: { heading: tKey('guide.feedback.title'), body: tKey('guide.feedback.body') },
};

export interface CoachMarkProps {
  tip: GuideTip;
  /** Where the card sits, near what it explains. */
  place: 'top' | 'middle' | 'bottom';
  onNext: () => void;
  onSkip: () => void;
}

/**
 * A coach mark of the first-episode guide: a dimmed screen and one card ("Listen first", "Fill
 * the gap", "See how you did") with "Got it" and "Skip the tips". Screen readers read it as a
 * modal.
 */
export function CoachMark({ tip, place, onNext, onSkip }: CoachMarkProps) {
  const { t } = useI18n();
  const n = GUIDE_TIPS.indexOf(tip) + 1;
  return (
    <View style={[styles.backdrop, place === 'top' ? styles.top : place === 'bottom' ? styles.bottom : styles.middle]} testID={`guide-${tip}`}>
      <View style={styles.card} accessibilityViewIsModal accessible={false}>
        <InterfaceText variant="eyebrow" tone="onInk" style={styles.dim} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('guide.step', { n, total: GUIDE_TIPS.length })}
        </InterfaceText>
        <InterfaceText variant="cardTitle" tone="onInk" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(TEXT[tip].heading)}
        </InterfaceText>
        <InterfaceText variant="body" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(TEXT[tip].body)}
        </InterfaceText>
        <View style={styles.actions}>
          <Button variant="ghost" label={t('guide.skip')} onPress={onSkip} style={styles.skip} testID="guide-skip" />
          <Button label={t('guide.next')} onPress={onNext} style={styles.next} testID="guide-next" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  top: { justifyContent: 'flex-start', paddingTop: 150 },
  middle: { justifyContent: 'center' },
  bottom: { justifyContent: 'flex-end', paddingBottom: 220 },
  card: { backgroundColor: colors.ink, borderRadius: radii.card, padding: spacing.xl, gap: spacing.sm },
  dim: { opacity: 0.7 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  skip: { opacity: 0.8 },
  next: { backgroundColor: colors.live, minHeight: 48 },
});
