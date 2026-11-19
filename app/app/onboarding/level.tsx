import { usePairPack } from '../../src/engine/PacksProvider';
import { LevelStepView } from '../../src/features/onboarding/LevelStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { languageName, useI18n } from '../../src/i18n';
import { startLevelForLevel } from '../../src/session/story/settings';

/**
 * "How much Spanish do you know?": brand new 0, a little 2, comfortable 4 (the learner level, and
 * the learner prior: brand new knows cognates only). Shown as chosen only once this step stored it.
 */
export default function LevelStepScreen() {
  const { t } = useI18n();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const { settings } = onboarding;
  const visited = settings.onboardingStep !== 'level' && settings.onboardingStep !== 'experience' && settings.onboardingStep !== 'welcome';
  return (
    <LevelStepView
      language={languageName(t, pair.target)}
      ctx={onboarding.ctx}
      level={visited ? settings.level : null}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onPick={(level) => void onboarding.advance('level', { level, startLevel: startLevelForLevel(level) })}
      onBack={() => onboarding.back('level')}
    />
  );
}
