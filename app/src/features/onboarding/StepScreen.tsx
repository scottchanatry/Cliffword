import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { ContentText, InterfaceText, Screen } from '../../ui';
import type { FlowContext, OnboardingScreenStep } from './flow';
import { StepHeader } from './StepHeader';

export interface StepScreenProps {
  step: OnboardingScreenStep;
  ctx: FlowContext;
  title: string;
  /** One or two short lines under the title. */
  body?: string;
  onBack: () => void;
  /** The last store failed: a short error above the footer. */
  failed?: boolean;
  /**
   * The main action, pinned under the content outside the scroll: always in view, however long
   * the step is (the picture step's grid of characters, a long list of choices).
   */
  footer?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

/** The frame of every onboarding step after the welcome: Back and the step count, a title, the content, the action. */
export function StepScreen({ step, ctx, title, body, onBack, failed = false, footer, children, testID }: StepScreenProps) {
  const { t } = useI18n();
  const error = failed ? (
    <InterfaceText tone="accent" accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
      {t('error.generic')}
    </InterfaceText>
  ) : null;
  const pinned = footer ? (
    <>
      {error}
      {footer}
    </>
  ) : undefined;
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.content} footer={pinned} testID={testID}>
      <StepHeader step={step} ctx={ctx} onBack={onBack} />
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {title}
      </ContentText>
      {body ? (
        <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {body}
        </InterfaceText>
      ) : null}
      {children}
      {pinned ? null : (
        <>
          <View style={styles.spacer} />
          {error}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  spacer: { flexGrow: 1, minHeight: spacing.sm },
});
