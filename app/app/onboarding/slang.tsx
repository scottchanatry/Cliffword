import { usePairPack } from '../../src/engine/PacksProvider';
import { SlangStepView } from '../../src/features/onboarding/SlangStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { useSettingsWriter } from '../../src/features/profile/useSettingsScreen';
import { languageName, useI18n } from '../../src/i18n';

/** Neutral or street, slang regions (Puerto Rico preselected), explicit lyrics (on); then done. */
export default function SlangStepScreen() {
  const { t } = useI18n();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const { settings, change, toggleRegion } = useSettingsWriter();
  return (
    <SlangStepView
      language={languageName(t, pair.target)}
      register={settings.register}
      regions={settings.regions}
      showExplicit={settings.showExplicit}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onRegister={(register) => change({ register })}
      onToggleRegion={toggleRegion}
      onToggleExplicit={() => change({ showExplicit: !settings.showExplicit })}
      onFinish={() => void onboarding.advance('slang')}
      onBack={() => onboarding.back('slang')}
    />
  );
}
