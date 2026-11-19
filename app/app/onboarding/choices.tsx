import { useState } from 'react';
import { Redirect } from 'expo-router';
import { usePairPack } from '../../src/engine/PacksProvider';
import { trackOfPair } from '../../src/features/experiences/experiences';
import { ChoicesStepView } from '../../src/features/onboarding/ChoicesStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';

/**
 * The experience's choices ("Who do you match with?"), stored per experience in
 * settings.trackChoices. An experience without choices skips this step.
 */
export default function ChoicesStepScreen() {
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const { settings } = onboarding;
  const track = trackOfPair(pair, settings.trackId);
  const [chosen, setChosen] = useState<Record<string, string>>(() => ({ ...(settings.trackChoices[settings.trackId ?? ''] ?? {}) }));
  if (!track || (track.choices ?? []).length === 0) return <Redirect href="/onboarding/mic" />;
  return (
    <ChoicesStepView
      experience={track.title}
      ctx={onboarding.ctx}
      choices={track.choices ?? []}
      chosen={chosen}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onChoose={(key, option) => setChosen((c) => ({ ...c, [key]: option }))}
      onContinue={() => void onboarding.advance('choices', { trackChoices: { ...settings.trackChoices, [track.id]: chosen } })}
      onBack={() => onboarding.back('choices')}
    />
  );
}
