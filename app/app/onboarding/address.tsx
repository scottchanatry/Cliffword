import { usePairPack } from '../../src/engine/PacksProvider';
import { addressExample } from '../../src/features/experiences/experiences';
import { AddressStepView } from '../../src/features/onboarding/AddressStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { languageName, useI18n } from '../../src/i18n';

/** "How should people address you?": stored as settings.address ('{you:a|b}' in the stories). */
export default function AddressStepScreen() {
  const { t } = useI18n();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const { settings } = onboarding;
  const visited = settings.onboardingStep === 'picture' || settings.onboardingStep === 'choices' || settings.onboardingStep === 'mic';
  return (
    <AddressStepView
      language={languageName(t, pair.target)}
      ctx={onboarding.ctx}
      example={addressExample(pair, settings.trackId)}
      address={visited ? settings.address : null}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onPick={(address) => void onboarding.advance('address', { address })}
      onBack={() => onboarding.back('address')}
    />
  );
}
