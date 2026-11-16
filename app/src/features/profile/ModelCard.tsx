import { StyleSheet, View } from 'react-native';
import type { ModelAvailability } from '../../adapters/model/keepModelLoaded';
import { formatBytes, MODEL_DOWNLOAD_NOTES, MODEL_FILE_ACTIONS, modelFileMessage, modelProgressMessage } from '../../adapters/model/modelFileMessages';
import type { ModelDescriptor, ModelFileState } from '../../adapters/model/types';
import { CHROME_MAX_SCALE } from '../../components/words/fontScale';
import { useI18n } from '../../i18n';
import { spacing } from '../../theme';
import { Button, Card, InterfaceText } from '../../ui';
import { ProgressBar } from './ProgressBar';

export interface ModelStatusProps {
  file: ModelFileState;
  availability: ModelAvailability;
  descriptor: Pick<ModelDescriptor, 'bytes'>;
  /** Free bytes on the phone, or null when unknown. */
  freeBytes: number | null;
}

/** The status line of the model (by file state and model status), the progress bar and the free space. */
export function ModelStatus({ file, availability, descriptor, freeBytes }: ModelStatusProps) {
  const { t } = useI18n();
  const moving = file.status === 'downloading' || file.status === 'verifying';
  let line: string;
  switch (availability) {
    case 'loading':
      line = t('settings.model.loading');
      break;
    case 'ready':
      line = t('settings.model.ready');
      break;
    case 'load-failed':
      line = t('error.modelLoad');
      break;
    default: {
      const message = modelFileMessage(file, descriptor, t);
      line = t(message.key, message.vars);
    }
  }
  const progress = modelProgressMessage(file, t);
  const fraction = file.status === 'verifying' ? (file.verifyFraction ?? 1) : file.progress.fraction;
  return (
    <View style={styles.status} testID="model-status">
      <InterfaceText
        variant="body"
        tone={availability === 'download-failed' || availability === 'load-failed' ? 'accent' : 'ink'}
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={CHROME_MAX_SCALE}
        testID="model-status-line"
      >
        {line}
      </InterfaceText>
      {moving ? <ProgressBar fraction={fraction} label={t(progress.key, progress.vars)} testID="model-progress" /> : null}
      {moving ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t(progress.key, progress.vars)}
        </InterfaceText>
      ) : null}
      {freeBytes !== null && availability !== 'ready' ? (
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE} testID="model-free-space">
          {t('model.freeSpace', { free: formatBytes(freeBytes, t), size: formatBytes(descriptor.bytes, t) })}
        </InterfaceText>
      ) : null}
    </View>
  );
}

export interface ModelCardProps extends ModelStatusProps {
  onStart: () => void;
  onPause: () => void;
  /** Opens the delete confirmation. */
  onDelete: () => void;
  /** The model was deleted from this screen: the download button says "Download again". */
  deleted?: boolean;
}

/** Settings: the language model's state, size and free space, with download, pause and delete. */
export function ModelCard({ onStart, onPause, onDelete, deleted = false, ...status }: ModelCardProps) {
  const { t } = useI18n();
  const { file, availability, descriptor } = status;
  const size = formatBytes(descriptor.bytes, t);
  const resumable = file.status === 'absent' && file.progress.bytesWritten > 0;
  return (
    <Card testID="model-card">
      <View style={styles.title}>
        <InterfaceText variant="cardTitle" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.model')}
        </InterfaceText>
        <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
          {t('settings.model.hint', { size })}
        </InterfaceText>
      </View>
      <ModelStatus {...status} />
      {availability === 'missing' ? (
        <>
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t(MODEL_DOWNLOAD_NOTES.cellular, { size })}
          </InterfaceText>
          <Button
            label={resumable ? t(MODEL_FILE_ACTIONS.resume) : deleted ? t(MODEL_FILE_ACTIONS.redownload) : t(MODEL_FILE_ACTIONS.start, { size })}
            onPress={onStart}
            testID="model-download"
          />
        </>
      ) : null}
      {file.status === 'downloading' ? (
        <>
          <InterfaceText variant="caption" tone="muted" maxFontSizeMultiplier={CHROME_MAX_SCALE}>
            {t(MODEL_DOWNLOAD_NOTES.keepOpen)}
          </InterfaceText>
          <Button variant="outline" label={t('model.download.pause')} onPress={onPause} testID="model-pause" />
        </>
      ) : null}
      {availability === 'download-failed' ? <Button label={t(MODEL_FILE_ACTIONS.retry)} onPress={onStart} testID="model-retry" /> : null}
      {availability === 'ready' || availability === 'loading' || availability === 'load-failed' ? (
        <Button
          variant="outline"
          label={t(MODEL_FILE_ACTIONS.delete)}
          accessibilityHint={t('model.delete.body', { size })}
          onPress={onDelete}
          testID="model-delete"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { gap: spacing.xxs },
  status: { gap: spacing.sm },
});
