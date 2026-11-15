/**
 * Interface text for the model file (download, check, errors, delete), by ModelFileState. The keys
 * are in the app catalog (src/i18n/catalog/en.ts, "Model download"); sizes go through the
 * units.bytes.* keys, so another catalog can change the unit names.
 *
 *   const { t } = useI18n();
 *   const line = modelFileMessage(modelManager.snapshot(), modelManager.descriptor, t);
 *   <Text>{t(line.key, line.vars)}</Text>
 *
 * The download is never blocked on mobile data; MODEL_DOWNLOAD_NOTES are shown before it starts
 * (the cellular note) and while it runs (keep the app open; the screen stays on).
 *
 * Plain data and functions: safe for every bundle (no expo-file-system here).
 */
import type { CatalogKey } from '../../i18n/catalog';
import type { TranslationVars } from '../../i18n/interpolate';
import { tKey } from '../../i18n/tKey';
import { FREE_SPACE_MARGIN_BYTES } from './descriptor';
import type { ModelDescriptor, ModelFileErrorCode, ModelFileState } from './types';

/** The translate function (useI18n().t or a Translator's t). */
export type Translate = (key: CatalogKey, vars?: TranslationVars) => string;

export interface ModelFileMessage {
  key: CatalogKey;
  vars: TranslationVars;
}

const ERROR_KEYS: Readonly<Record<ModelFileErrorCode, CatalogKey>> = {
  network: tKey('model.download.error.network'),
  'insufficient-storage': tKey('model.download.error.storageNeeded'),
  'checksum-mismatch': tKey('model.download.error.checksum'),
  'size-mismatch': tKey('model.download.error.size'),
  unknown: tKey('model.download.error.unknown'),
};

/** Notes around the download: before it starts, and while it runs. */
export const MODEL_DOWNLOAD_NOTES = {
  /** Before starting: Wi-Fi is better, mobile data works ({size}). */
  cellular: tKey('model.download.cellularNote'),
  /** While downloading or checking. */
  keepOpen: tKey('model.download.keepOpen'),
} as const;

/** Buttons for the model file. */
export const MODEL_FILE_ACTIONS = {
  start: tKey('model.download.start'),
  cancel: tKey('model.download.cancel'),
  resume: tKey('model.download.resume'),
  retry: tKey('model.download.retry'),
  delete: tKey('model.delete'),
  redownload: tKey('model.redownload'),
} as const;

/**
 * Decimal units, as phones show storage: "1.1 GB", "640 MB". `locale` (e.g. the learner's native
 * language) picks the decimal separator through Intl when the runtime has it.
 */
export function formatBytes(bytes: number, t: Translate, locale?: string): string {
  const value = Math.max(0, bytes);
  if (value >= 1e9) return t('units.bytes.gb', { value: oneDecimal(value / 1e9, locale) });
  const mb = value === 0 ? 0 : Math.max(1, Math.round(value / 1e6));
  return t('units.bytes.mb', { value: String(mb) });
}

function oneDecimal(n: number, locale?: string): string {
  const rounded = Math.round(n * 10) / 10;
  if (locale && typeof Intl !== 'undefined' && Intl.NumberFormat) {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded);
    } catch {
      // Unknown locale: fall through.
    }
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const percentOf = (fraction: number) => Math.floor(Math.max(0, Math.min(1, fraction)) * 100);

/** The text for an error code (with the space figures when the state has them). */
export function modelFileErrorMessage(
  state: Pick<ModelFileState, 'error' | 'space' | 'progress'>,
  descriptor: Pick<ModelDescriptor, 'bytes'>,
  t: Translate,
): ModelFileMessage {
  const code = state.error ?? 'unknown';
  if (code === 'insufficient-storage') {
    if (state.space) {
      const { freeBytes, neededBytes } = state.space;
      return {
        key: tKey('model.download.error.storage'),
        vars: {
          needed: formatBytes(neededBytes, t),
          free: formatBytes(freeBytes, t),
          short: formatBytes(neededBytes - freeBytes, t),
        },
      };
    }
    const remaining = descriptor.bytes - state.progress.bytesWritten;
    return { key: ERROR_KEYS[code], vars: { needed: formatBytes(remaining + FREE_SPACE_MARGIN_BYTES, t) } };
  }
  return { key: ERROR_KEYS[code] ?? ERROR_KEYS.unknown, vars: {} };
}

/** The status line for the model file. */
export function modelFileMessage(state: ModelFileState, descriptor: Pick<ModelDescriptor, 'bytes'>, t: Translate): ModelFileMessage {
  switch (state.status) {
    case 'absent':
      if (state.progress.bytesWritten > 0) {
        return { key: tKey('model.download.pausedAt'), vars: { percent: percentOf(state.progress.fraction) } };
      }
      return { key: tKey('model.download.body'), vars: { size: formatBytes(descriptor.bytes, t) } };
    case 'downloading':
      return { key: tKey('model.download.progress'), vars: { percent: percentOf(state.progress.fraction) } };
    case 'verifying':
      if (state.verifyFraction !== undefined) {
        return { key: tKey('model.download.verifyingPercent'), vars: { percent: percentOf(state.verifyFraction) } };
      }
      return { key: tKey('model.download.verifying'), vars: {} };
    case 'ready':
      return { key: tKey('model.download.done'), vars: {} };
    case 'error':
      return modelFileErrorMessage(state, descriptor, t);
  }
}

/** "{done} of {total}" for a progress bar's label. */
export function modelProgressMessage(state: Pick<ModelFileState, 'progress'>, t: Translate): ModelFileMessage {
  return {
    key: tKey('model.download.progressBytes'),
    vars: { done: formatBytes(state.progress.bytesWritten, t), total: formatBytes(state.progress.bytesTotal, t) },
  };
}
