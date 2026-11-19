import { Redirect } from 'expo-router';
import { PRIVACY_URL } from '../../src/config/links';
import { openUrl } from '../../src/config/openUrl';
import { usePairPack } from '../../src/engine/PacksProvider';
import { welcomeSample } from '../../src/features/experiences/experiences';
import { useOnboarding, useResumeRoute } from '../../src/features/onboarding/useOnboarding';
import { WelcomeView } from '../../src/features/onboarding/WelcomeView';
import { languageName, useI18n } from '../../src/i18n';
import { useServices } from '../../src/services/ServicesProvider';

/** The footer link; when no browser takes it nothing happens (Settings links the policy too). */
function openPrivacy() {
  void openUrl(PRIVACY_URL).catch(() => undefined);
}

/**
 * Welcome: what Cliffword is and how it works (listen, fill the gap, hear how you did), with a
 * line of the first experience as the picture. A relaunch forwards once to the step stored last.
 */
export default function WelcomeScreen() {
  const { t } = useI18n();
  const { packs } = useServices();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const resume = useResumeRoute();
  if (resume) return <Redirect href={resume} />;
  return (
    <WelcomeView
      language={languageName(t, pair.target)}
      sample={welcomeSample(pair, packs.lang)}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onStart={() => void onboarding.advance('welcome')}
      onOpenPrivacy={openPrivacy}
    />
  );
}
