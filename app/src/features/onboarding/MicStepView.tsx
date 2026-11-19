import { StyleSheet, View } from 'react-native';
import { speechInStatusKey, SPEECH_IN_DOWNLOAD_ACTION } from '../../adapters/speechIn/messages';
import type { SpeechAvailability } from '../../adapters/speechIn/types';
import { MicGlyph } from '../../components/voice/MicGlyph';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n, type CatalogKey } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, InterfaceText } from '../../ui';
import type { FlowContext } from './flow';
import { StepScreen } from './StepScreen';

export interface MicStepViewProps {
  ctx: FlowContext;
  /** null while the first check runs. */
  availability: SpeechAvailability | null;
  speechBusy: boolean;
  downloadMessage: CatalogKey | null;
  /** The model's size ("1.1 GB"), for the one line on what it does. */
  modelSize: string;
  saving: boolean;
  failed: boolean;
  /** Ask for the microphone (the system dialog); onboarding ends once it is on. */
  onAllow: () => void;
  onOpenSettings: () => void;
  onDownloadLanguage: () => void;
  /** Finish onboarding (the microphone is on, or the learner types). */
  onFinish: () => void;
  onBack: () => void;
}

/**
 * The microphone: why (answers out loud, recognized on the phone, nothing recorded), "Allow
 * microphone" and "Type instead"; after a refusal, Settings or typing. One line says what the
 * language model does and that it downloads by itself on Wi-Fi.
 */
export function MicStepView(props: MicStepViewProps) {
  const { t } = useI18n();
  const { availability, speechBusy, saving } = props;
  const status = availability?.status ?? null;
  const ready = status === 'ready';
  const denied = availability?.permission === 'denied';
  const canAsk = status === 'needs-permission' && !denied;
  const problem = availability && !ready && !canAsk ? (denied ? t('speechIn.status.permissionDenied') : t(speechInStatusKey(availability))) : null;

  const footer = (
    <View style={styles.footer}>
      {ready ? (
        <Button label={t('mic.start')} onPress={props.onFinish} disabled={saving} testID="mic-finish" />
      ) : canAsk ? (
        <Button
          label={t('mic.allow')}
          onPress={props.onAllow}
          disabled={speechBusy || saving}
          icon={<MicGlyph />}
          testID="mic-allow"
        />
      ) : denied ? (
        <Button variant="outline" label={t('permission.openSettings')} onPress={props.onOpenSettings} testID="mic-settings" />
      ) : null}
      {!ready ? (
        <Button
          variant={canAsk || denied ? 'ghost' : 'primary'}
          label={t('mic.typeInstead')}
          onPress={props.onFinish}
          disabled={saving || availability === null}
          testID="mic-type"
        />
      ) : null}
    </View>
  );

  return (
    <StepScreen
      step="mic"
      ctx={props.ctx}
      title={t('mic.title')}
      body={t('mic.body')}
      onBack={props.onBack}
      failed={props.failed}
      footer={footer}
      testID="onboarding-mic"
    >
      <Card testID="mic-card">
        <InterfaceText variant="body" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('mic.private')}
        </InterfaceText>
        <InterfaceText
          variant="bodyStrong"
          tone={problem ? 'accent' : 'ink'}
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={CHROME_MAX_SCALE}
          testID="mic-status"
        >
          {availability === null ? t('onboarding.voice.checking') : ready ? t('mic.ready') : canAsk ? t('mic.needed') : problem}
        </InterfaceText>
        {availability?.canDownload ? (
          <Button
            variant="outline"
            label={t(SPEECH_IN_DOWNLOAD_ACTION)}
            onPress={props.onDownloadLanguage}
            disabled={speechBusy}
            testID="mic-download-language"
          />
        ) : null}
        {props.downloadMessage ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t(props.downloadMessage)}
          </InterfaceText>
        ) : null}
      </Card>
      <Card tone="soft" testID="model-note">
        <InterfaceText variant="caption" tone="mutedStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('mic.model', { size: props.modelSize })}
        </InterfaceText>
      </Card>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.sm },
});

