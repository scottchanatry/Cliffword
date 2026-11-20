import { PictureStepView } from '../../src/features/onboarding/PictureStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { usePictureChooser } from '../../src/features/picture/usePictureChooser';

/**
 * "Who are you in the story?": a character or the learner's own photo, stored in
 * settings.picture as soon as it is chosen (the default character until then), shown next to the
 * learner's answers in the story and on the header button.
 */
export default function PictureStepScreen() {
  const onboarding = useOnboarding();
  const chooser = usePictureChooser();
  return (
    <PictureStepView
      ctx={onboarding.ctx}
      picture={chooser.picture}
      sources={chooser.sources}
      busy={chooser.busy}
      notice={chooser.notice}
      onChooseCharacter={chooser.chooseCharacter}
      onPickPhoto={chooser.pickPhoto}
      onRemovePhoto={chooser.removePhoto}
      onOpenSettings={chooser.openSettings}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onContinue={() => void onboarding.advance('picture')}
      onBack={() => onboarding.back('picture')}
    />
  );
}
