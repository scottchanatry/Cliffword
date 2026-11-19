import { usePairPack } from '../../src/engine/PacksProvider';
import { experienceCards } from '../../src/features/experiences/experiences';
import { ExperienceStepView } from '../../src/features/onboarding/ExperienceStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';

/** Pick an experience: the playable one stores trackId and goes on; coming-soon cards cannot be picked. */
export default function ExperienceStepScreen() {
  const pair = usePairPack();
  const onboarding = useOnboarding();
  return (
    <ExperienceStepView
      cards={experienceCards(pair, null, onboarding.settings.trackId)}
      ctx={onboarding.ctx}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onPick={(trackId) => void onboarding.advance('experience', { trackId })}
      onBack={() => onboarding.back('experience')}
    />
  );
}
