import { usePairPack } from '../../src/engine/PacksProvider';
import { useHoldPractice } from '../../src/features/onboarding/useHoldPractice';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { useSpeechSetup } from '../../src/features/onboarding/useSpeechSetup';
import { VoiceStepView } from '../../src/features/onboarding/VoiceStepView';
import { useVoices } from '../../src/features/profile/useVoices';
import { languageName, useI18n } from '../../src/i18n';

/** Microphone and speech permission, the on-device check, the story voice and hold practice. */
export default function VoiceStepScreen() {
  const { t } = useI18n();
  const pair = usePairPack();
  const onboarding = useOnboarding();
  const speech = useSpeechSetup();
  const voices = useVoices();
  const practice = useHoldPractice();
  return (
    <VoiceStepView
      language={languageName(t, pair.target)}
      availability={speech.availability}
      speechBusy={speech.busy}
      downloadMessage={speech.downloadMessage}
      onAllow={speech.allow}
      onOpenSettings={speech.openSettings}
      onDownloadLanguage={speech.downloadLanguage}
      voices={voices}
      voiceId={onboarding.settings.voiceId}
      onSelectVoice={(voiceId) => onboarding.update({ voiceId })}
      practice={practice}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onContinue={() => void onboarding.advance('voice')}
      onBack={() => onboarding.back('voice')}
    />
  );
}
