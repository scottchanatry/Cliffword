import { useI18n } from '../../i18n';
import type { ExperienceCardData } from '../experiences/experiences';
import { ExperienceList } from '../experiences/ExperienceList';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

export interface ExperienceStepViewProps {
  cards: readonly ExperienceCardData[];
  ctx: FlowContext;
  saving: boolean;
  failed: boolean;
  /** A playable experience was tapped: store it and go on. */
  onPick: (id: string) => void;
  onBack: () => void;
}

/** "Pick a story": every experience as a big card, scrolled; the ones not written yet say "Coming soon". */
export function ExperienceStepView({ cards, ctx, saving, failed, onPick, onBack }: ExperienceStepViewProps) {
  const { t } = useI18n();
  return (
    <StepScreen step="experience" ctx={ctx} title={t('picker.title')} body={t('picker.body')} onBack={onBack} failed={failed} testID="onboarding-experience">
      <ExperienceList cards={cards} onPick={onPick} disabled={saving} />
    </StepScreen>
  );
}
