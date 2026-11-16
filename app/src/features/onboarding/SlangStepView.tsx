import { StyleSheet, View } from 'react-native';
import type { Register } from '@cliffword/engine';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, ContentText, InterfaceText, Screen } from '../../ui';
import { ExplicitRow } from '../music/ExplicitRow';
import { RegionPills, type RegionCode } from '../music/RegionPills';
import { RegisterChoice } from './RegisterChoice';
import { StepHeader } from './StepHeader';

export interface SlangStepViewProps {
  language: string;
  register: Register;
  regions: readonly string[];
  showExplicit: boolean;
  saving: boolean;
  failed: boolean;
  onRegister: (register: Register) => void;
  onToggleRegion: (code: RegionCode) => void;
  onToggleExplicit: () => void;
  /** Finish onboarding: the Story tab opens. */
  onFinish: () => void;
  onBack: () => void;
}

/** Slang step: neutral or street, the regions (Puerto Rico preselected), explicit lyrics (on). */
export function SlangStepView(props: SlangStepViewProps) {
  const { t } = useI18n();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.content} testID="onboarding-slang">
      <StepHeader step="slang" onBack={props.onBack} />
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('onboarding.slang.title')}
      </ContentText>
      <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('onboarding.slang.body', { language: props.language })}
      </InterfaceText>
      <RegisterChoice value={props.register} onChange={props.onRegister} />
      <View style={styles.section}>
        <InterfaceText variant="eyebrow" tone="muted" accessibilityRole="header" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('music.slangToLearn')}
        </InterfaceText>
        <RegionPills selected={props.regions} onToggle={props.onToggleRegion} />
      </View>
      <View style={styles.section}>
        <ExplicitRow show={props.showExplicit} onToggle={props.onToggleExplicit} />
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="explicit-note">
          {t('onboarding.slang.explicitNote')}
        </InterfaceText>
      </View>
      <View style={styles.spacer} />
      {props.failed ? (
        <InterfaceText tone="accent" accessibilityRole="alert" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('error.generic')}
        </InterfaceText>
      ) : null}
      <Button label={t('onboarding.finish')} onPress={props.onFinish} disabled={props.saving} testID="onboarding-finish" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  section: { gap: spacing.sm },
  spacer: { flexGrow: 1, minHeight: spacing.md },
});
