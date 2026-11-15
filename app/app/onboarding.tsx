import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSettings } from '../src/appState/AppStateProvider';
import { usePairPack } from '../src/engine/PacksProvider';
import { languageName, useI18n } from '../src/i18n';
import type { StartLevel } from '../src/storage/repos/settings';
import { spacing } from '../src/theme';
import { Button, ContentText, InterfaceText, Screen } from '../src/ui';

/**
 * First run. Placement is the first story (no test screen); "I'm brand new" skips it. Either
 * choice stores onboarded + startLevel (which picks the learner prior); the root stack's guard
 * then opens the Story tab.
 */
export default function OnboardingScreen() {
  const { t } = useI18n();
  const { updateSettings } = useSettings();
  const language = languageName(t, usePairPack().target);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = async (startLevel: StartLevel) => {
    setSaving(true);
    setFailed(false);
    try {
      await updateSettings({ onboarded: true, startLevel });
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} testID="onboarding-screen">
      <ContentText variant="brand">{t('app.name')}</ContentText>
      <View style={styles.spacer} />
      <ContentText variant="headline" accessibilityRole="header">
        {t('onboarding.title', { language })}
      </ContentText>
      <InterfaceText tone="muted">{t('onboarding.body')}</InterfaceText>
      <InterfaceText tone="muted">{t('onboarding.placement')}</InterfaceText>
      <View style={styles.spacer} />
      {failed ? (
        <InterfaceText tone="accent" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t('error.generic')}
        </InterfaceText>
      ) : null}
      <Button
        label={t('onboarding.brandNew')}
        onPress={() => void start('brandNew')}
        disabled={saving}
        testID="onboarding-brand-new"
      />
      <Button
        variant="outline"
        label={t('onboarding.knowSome', { language })}
        onPress={() => void start('placement')}
        disabled={saving}
        testID="onboarding-know-some"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { flex: 1, minHeight: spacing.xxl },
});
