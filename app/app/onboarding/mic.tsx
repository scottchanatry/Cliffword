import { useEffect, useState } from 'react';
import { formatBytes } from '../../src/adapters/model/modelFileMessages';
import { MicStepView } from '../../src/features/onboarding/MicStepView';
import { useOnboarding } from '../../src/features/onboarding/useOnboarding';
import { useSpeechSetup } from '../../src/features/onboarding/useSpeechSetup';
import { useI18n } from '../../src/i18n';
import { useServices } from '../../src/services/ServicesProvider';

/**
 * The microphone, then done. "Allow microphone" asks the system; once speech is ready onboarding
 * ends by itself. "Type instead" ends it without the microphone (it can be allowed later). The
 * language model then downloads in the background on Wi-Fi (useModelAutoDownload).
 */
export default function MicStepScreen() {
  const { t } = useI18n();
  const { modelManager } = useServices();
  const onboarding = useOnboarding();
  const speech = useSpeechSetup();
  const [asked, setAsked] = useState(false);
  const { advance } = onboarding;
  const ready = speech.availability?.status === 'ready';
  useEffect(() => {
    if (asked && ready) void advance('mic');
  }, [asked, ready, advance]);
  return (
    <MicStepView
      ctx={onboarding.ctx}
      availability={speech.availability}
      speechBusy={speech.busy}
      downloadMessage={speech.downloadMessage}
      modelSize={formatBytes(modelManager.descriptor.bytes, t)}
      saving={onboarding.saving}
      failed={onboarding.failed}
      onAllow={() => {
        setAsked(true);
        speech.allow();
      }}
      onOpenSettings={speech.openSettings}
      onDownloadLanguage={speech.downloadLanguage}
      onFinish={() => void advance('mic')}
      onBack={() => onboarding.back('mic')}
    />
  );
}
