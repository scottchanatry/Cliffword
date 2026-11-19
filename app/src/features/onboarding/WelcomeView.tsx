import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { CliffGap } from '../../components/words/CliffGap';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { borders, colors, radii, spacing } from '../../theme';
import { Button, Card, ContentText, InterfaceText, QuietLink, Screen } from '../../ui';
import type { LineSample } from '../experiences/experiences';
import { StepHeader } from './StepHeader';

export interface WelcomeViewProps {
  /** The target language's name ("Spanish"). */
  language: string;
  /**
   * A line of the first experience split around its missing word, drawn in the three-step
   * picture (heard whole, with the gap, then filled in); null when the pair has no library.
   */
  sample: LineSample | null;
  saving: boolean;
  failed: boolean;
  /** "Get started": the experience picker. */
  onStart: () => void;
  /** The footer's "Privacy policy" link (opens the hosted policy in the browser). */
  onOpenPrivacy?: () => void;
}

/** Welcome: what Cliffword is in one line, and how it works in three steps (listen, fill the gap, hear how you did). */
export function WelcomeView({ language, sample, saving, failed, onStart, onOpenPrivacy }: WelcomeViewProps) {
  const { t } = useI18n();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.content} testID="onboarding-screen">
      <View style={styles.top}>
        <ContentText variant="brand" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('app.name')}
        </ContentText>
        <StepHeader step="welcome" />
      </View>
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('welcome.title', { language })}
      </ContentText>
      <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('welcome.body')}
      </InterfaceText>
      <View style={styles.steps} accessibilityRole="list" testID="welcome-steps">
        <WelcomeStep n={1} title={t('welcome.step.listen')} body={t('welcome.step.listen.body')}>
          {sample ? (
            <ContentText variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
              {`${sample.before}${sample.word}${sample.after}`}
            </ContentText>
          ) : null}
        </WelcomeStep>
        <WelcomeStep n={2} title={t('welcome.step.gap')} body={t('welcome.step.gap.body')}>
          {sample ? <GappedLine sample={sample} /> : null}
        </WelcomeStep>
        <WelcomeStep n={3} title={t('welcome.step.feedback')} body={t('welcome.step.feedback.body')}>
          {sample ? (
            <View style={styles.line}>
              <View style={styles.check} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.checkMark} />
              </View>
              <ContentText variant="prompt" style={styles.word} maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
                {sample.word}
              </ContentText>
            </View>
          ) : null}
        </WelcomeStep>
      </View>
      <View style={styles.spacer} />
      {failed ? (
        <InterfaceText tone="accent" accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('error.generic')}
        </InterfaceText>
      ) : null}
      <Button label={t('welcome.start')} onPress={onStart} disabled={saving} testID="onboarding-start" />
      {onOpenPrivacy ? (
        <QuietLink label={t('onboarding.privacyPolicy')} onPress={onOpenPrivacy} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="welcome-privacy" />
      ) : null}
    </Screen>
  );
}

/** The sample line with its gap; punctuation right after the gap stays on the gap's line. */
function GappedLine({ sample }: { sample: LineSample }) {
  const after = sample.after.trim();
  const stuck = /^[^\p{L}\p{N}\s]+/u.exec(after)?.[0] ?? '';
  const rest = after.slice(stuck.length).trim();
  return (
    <View style={styles.line}>
      {sample.before.trim() ? (
        <ContentText variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {sample.before.trim()}
        </ContentText>
      ) : null}
      <View style={styles.gapWord}>
        <CliffGap testID="welcome-gap" />
        {stuck ? (
          <ContentText variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {stuck}
          </ContentText>
        ) : null}
      </View>
      {rest ? (
        <ContentText variant="prompt" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
          {rest}
        </ContentText>
      ) : null}
    </View>
  );
}

function WelcomeStep({ n, title, body, children }: { n: number; title: string; body: string; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card style={styles.step}>
      <View style={styles.stepHead} accessible accessibilityLabel={t('welcome.step.a11y', { n, title, body })}>
        <View style={styles.number}>
          <InterfaceText variant="pillStrong" tone="onInk" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {String(n)}
          </InterfaceText>
        </View>
        <View style={styles.stepText}>
          <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {title}
          </InterfaceText>
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {body}
          </InterfaceText>
        </View>
      </View>
      {children ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.illustration}>
          {children}
        </View>
      ) : null}
    </Card>
  );
}

const NUMBER = 28;
const CHECK = 28;

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  steps: { gap: spacing.md },
  step: { paddingVertical: spacing.lg, gap: spacing.md },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  number: { width: NUMBER, height: NUMBER, borderRadius: NUMBER / 2, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: spacing.xxs },
  illustration: { paddingLeft: NUMBER + spacing.md },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  gapWord: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  check: {
    width: CHECK,
    height: CHECK,
    borderRadius: CHECK / 2,
    backgroundColor: colors.heat1,
    borderWidth: borders.strong,
    borderColor: colors.heat3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    width: 12,
    height: 7,
    marginTop: -3,
    borderLeftWidth: borders.strong,
    borderBottomWidth: borders.strong,
    borderColor: colors.accentText,
    transform: [{ rotate: '-45deg' }],
  },
  word: { color: colors.accentText, borderRadius: radii.tile },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
});
