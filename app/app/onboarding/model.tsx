import { ModelStepView } from '../../src/features/onboarding/ModelStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { useModelFile } from '../../src/features/profile/useModelFile';

/**
 * The language model (1.1 GB): download now and continue while it runs, or "Not now". Every
 * choice moves on; the app runs in canned mode until the model is ready.
 */
export default function ModelStepScreen() {
  const onboarding = useOnboarding();
  const model = useModelFile();
  return (
    <ModelStepView
      file={model.file}
      availability={model.availability}
      descriptor={model.descriptor}
      freeBytes={model.freeBytes}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onStart={() => {
        model.start();
        if (onboarding.settings.modelDeclined) onboarding.update({ modelDeclined: false });
      }}
      onPause={model.pause}
      onContinue={() => void onboarding.advance('model', { modelDeclined: false })}
      onNotNow={() => void onboarding.advance('model', { modelDeclined: true })}
      onBack={() => onboarding.back('model')}
    />
  );
}
