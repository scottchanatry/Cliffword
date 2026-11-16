import { Redirect } from 'expo-router';
import { locateAnswer } from '@cliffword/engine';
import { PRIVACY_URL } from '../../src/config/links';
import { openUrl } from '../../src/config/openUrl';
import { usePairPack } from '../../src/engine/PacksProvider';
import { useOnboarding, useResumeRoute } from '../../src/features/onboarding/useOnboarding';
import { WelcomeView } from '../../src/features/onboarding/WelcomeView';
import { languageName, useI18n } from '../../src/i18n';
import { useServices } from '../../src/services/ServicesProvider';

/**
 * Welcome. "Start the first story" is placement (the first story finds the level; there is no
 * test); "I'm brand new" skips it. A relaunch forwards once to the step stored last.
 */
/** The footer link; when no browser takes it nothing happens (Settings links the policy too). */
function openPrivacy() {
  void openUrl(PRIVACY_URL).catch(() => undefined);
}

export default function WelcomeScreen() {
  const { t } = useI18n();
  const { packs } = useServices();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const resume = useResumeRoute();
  if (resume) return <Redirect href={resume} />;

  const first = pair.starter?.sentences[0];
  const span = first ? locateAnswer(packs.lang, first.text, first.answer) : null;
  return (
    <WelcomeView
      language={languageName(t, pair.target)}
      sampleBefore={first && span ? first.text.slice(0, span.start) : null}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onPlacement={() => void onboarding.chooseStart('placement')}
      onBrandNew={() => void onboarding.chooseStart('brandNew')}
      onOpenPrivacy={openPrivacy}
    />
  );
}
