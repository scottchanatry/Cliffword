import { StyleSheet, View } from 'react-native';
import { CliffGap } from '../../components/words/CliffGap';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, ContentText, InterfaceText, QuietLink, Screen } from '../../ui';
import { StepHeader } from './StepHeader';

export interface WelcomeViewProps {
  /** The target language's name ("Spanish"). */
  language: string;
  /**
   * The first sentence of the pair's starter story up to its cliff ("Marta es una "), drawn with
   * the ink gap as a taste of the app; null when the pair has no starter.
   */
  sampleBefore: string | null;
  saving: boolean;
  failed: boolean;
  /** "Start the first story": placement (the first story finds the level). */
  onPlacement: () => void;
  /** "I'm brand new": placement skipped, cognates first. */
  onBrandNew: () => void;
  /** The footer's "Privacy policy" link (opens the hosted policy in the browser). */
  onOpenPrivacy?: () => void;
}

/** Welcome: what Cliffword does, and how to start (placement is the first story; no test). */
export function WelcomeView({ language, sampleBefore, saving, failed, onPlacement, onBrandNew, onOpenPrivacy }: WelcomeViewProps) {
  const { t } = useI18n();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.content} testID="onboarding-screen">
      <View style={styles.top}>
        <ContentText variant="brand" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('app.name')}
        </ContentText>
        <StepHeader step="welcome" />
      </View>
      {sampleBefore ? (
        <View style={styles.sample} accessible accessibilityLabel={t('onboarding.sample.a11y', { text: sampleBefore.trim() })} testID="welcome-sample">
          <ContentText variant="story" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
            {sampleBefore.trimEnd()}
          </ContentText>
          <CliffGap testID="welcome-gap" />
        </View>
      ) : null}
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('onboarding.title', { language })}
      </ContentText>
      <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('onboarding.body')}
      </InterfaceText>
      <View style={styles.spacer} />
      {failed ? (
        <InterfaceText tone="accent" accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('error.generic')}
        </InterfaceText>
      ) : null}
      <View style={styles.choice}>
        <Button label={t('onboarding.startStory')} onPress={onPlacement} disabled={saving} testID="onboarding-placement" />
        <InterfaceText variant="caption" tone="muted" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.placement')}
        </InterfaceText>
      </View>
      <View style={styles.choice}>
        <Button variant="outline" label={t('onboarding.brandNew')} onPress={onBrandNew} disabled={saving} testID="onboarding-brand-new" />
        <InterfaceText variant="caption" tone="muted" style={styles.center} maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('onboarding.brandNew.hint', { language })}
        </InterfaceText>
      </View>
      {onOpenPrivacy ? (
        <QuietLink label={t('onboarding.privacyPolicy')} onPress={onOpenPrivacy} maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="welcome-privacy" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sample: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  choice: { gap: spacing.sm },
  center: { textAlign: 'center' },
});
