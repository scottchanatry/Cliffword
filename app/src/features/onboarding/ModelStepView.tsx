import { StyleSheet, View } from 'react-native';
import type { ModelAvailability } from '../../adapters/model/keepModelLoaded';
import { formatBytes, MODEL_DOWNLOAD_NOTES, MODEL_FILE_ACTIONS } from '../../adapters/model/modelFileMessages';
import type { ModelDescriptor, ModelFileState } from '../../adapters/model/types';
import { CHROME_MAX_SCALE, CONTENT_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, ContentText, InterfaceText, Screen } from '../../ui';
import { ModelStatus } from '../profile/ModelCard';
import { StepHeader } from './StepHeader';

export interface ModelStepViewProps {
  file: ModelFileState;
  availability: ModelAvailability;
  descriptor: Pick<ModelDescriptor, 'bytes'>;
  freeBytes: number | null;
  saving: boolean;
  failed: boolean;
  /** Start, resume or retry the download. */
  onStart: () => void;
  onPause: () => void;
  /** Next step (the download, if any, goes on). */
  onContinue: () => void;
  /** "Not now": next step, the model declined (canned mode until it is downloaded). */
  onNotNow: () => void;
  onBack: () => void;
}

/**
 * Model step: "Download the language model (1.1 GB)", free space, the Wi-Fi note, progress, and
 * "Continue while it downloads" or "Not now". The app works without it (canned stories, songs
 * line by line), so every state can move on.
 */
export function ModelStepView(props: ModelStepViewProps) {
  const { t } = useI18n();
  const { file, availability, descriptor, saving } = props;
  const size = formatBytes(descriptor.bytes, t);
  const fresh = file.status === 'absent' && file.progress.bytesWritten === 0;
  const paused = file.status === 'absent' && !fresh;
  const moving = file.status === 'downloading' || file.status === 'verifying';
  const done = availability === 'ready' || availability === 'loading' || availability === 'load-failed';
  const failedDownload = availability === 'download-failed';

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']} contentStyle={styles.content} testID="onboarding-model">
      <StepHeader step="model" onBack={props.onBack} />
      <ContentText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={CONTENT_MAX_SCALE}>
        {t('model.download.title')}
      </ContentText>
      <InterfaceText tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('model.download.body', { size })}
      </InterfaceText>
      <Card testID="download-card">
        <View style={styles.sizeRow}>
          <InterfaceText variant="rowTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('onboarding.model.name')}
          </InterfaceText>
          <InterfaceText variant="bodyStrong" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="model-size">
            {size}
          </InterfaceText>
        </View>
        <ModelStatus file={file} availability={availability} descriptor={descriptor} freeBytes={props.freeBytes} />
        {fresh || paused ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="model-wifi-note">
            {t(MODEL_DOWNLOAD_NOTES.cellular, { size })}
          </InterfaceText>
        ) : null}
        {moving ? (
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t('onboarding.model.background')}
          </InterfaceText>
        ) : null}
      </Card>
      <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
        {t('onboarding.model.canned')}
      </InterfaceText>
      <View style={styles.spacer} />
      {props.failed ? (
        <InterfaceText tone="accent" accessibilityRole="alert" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('error.generic')}
        </InterfaceText>
      ) : null}
      <View style={styles.actions}>
        {fresh ? <Button label={t(MODEL_FILE_ACTIONS.start, { size })} onPress={props.onStart} disabled={saving} testID="model-download" /> : null}
        {paused ? <Button label={t(MODEL_FILE_ACTIONS.resume)} onPress={props.onStart} disabled={saving} testID="model-resume" /> : null}
        {failedDownload ? <Button label={t(MODEL_FILE_ACTIONS.retry)} onPress={props.onStart} disabled={saving} testID="model-retry" /> : null}
        {moving ? <Button label={t('onboarding.model.continueWhile')} onPress={props.onContinue} disabled={saving} testID="model-continue" /> : null}
        {done ? <Button label={t('common.continue')} onPress={props.onContinue} disabled={saving} testID="model-continue" /> : null}
        {file.status === 'downloading' ? (
          <Button variant="outline" label={t('model.download.pause')} onPress={props.onPause} testID="model-pause" />
        ) : null}
        {fresh || paused ? (
          <Button variant="ghost" muted label={t('onboarding.model.notNow')} onPress={props.onNotNow} disabled={saving} testID="model-not-now" />
        ) : null}
        {failedDownload ? (
          <Button variant="ghost" muted label={t('onboarding.model.skip')} onPress={props.onNotNow} disabled={saving} testID="model-skip" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  sizeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  spacer: { flexGrow: 1, minHeight: spacing.lg },
  actions: { gap: spacing.sm },
});
