import { useI18n } from '../../i18n';
import { Button } from '../../ui';
import { PictureChooser, type PictureChooserProps } from '../picture/PictureChooser';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

export interface PictureStepViewProps extends Omit<PictureChooserProps, 'testID'> {
  ctx: FlowContext;
  /** The step is being stored. */
  saving: boolean;
  failed: boolean;
  onContinue: () => void;
  onBack: () => void;
}

/**
 * "Who are you in the story?": the learner's picture next to their answers. The default character
 * is chosen from the start, each choice is stored at once, and Continue is always there.
 */
export function PictureStepView({ ctx, saving, failed, onContinue, onBack, ...chooser }: PictureStepViewProps) {
  const { t } = useI18n();
  return (
    <StepScreen
      step="picture"
      ctx={ctx}
      title={t('picture.title')}
      body={t('picture.body')}
      onBack={onBack}
      failed={failed}
      testID="onboarding-picture"
      footer={<Button label={t('common.continue')} onPress={onContinue} disabled={saving} testID="picture-continue" />}
    >
      <PictureChooser {...chooser} />
    </StepScreen>
  );
}
