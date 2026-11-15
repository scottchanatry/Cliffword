/**
 * Interface text for speech input, by error code and by availability status. The app shows these
 * with t(key); the keys are in the app catalog (src/i18n/catalog/en.ts, "Speech input").
 * Every text keeps "Type instead" in view: typing always works.
 */
import type { CatalogKey } from '../../i18n/catalog';
import { tKey } from '../../i18n/tKey';
import type { LanguageDownload, SpeechAvailability, SpeechInErrorCode, SpeechInStatus } from './types';

const ERROR_KEYS: Readonly<Record<SpeechInErrorCode, CatalogKey>> = {
  'not-allowed': tKey('speechIn.error.notAllowed'),
  'no-speech': tKey('speechIn.error.noSpeech'),
  'no-match': tKey('speechIn.error.noMatch'),
  'audio-capture': tKey('speechIn.error.audioCapture'),
  network: tKey('speechIn.error.network'),
  'language-not-supported': tKey('speechIn.error.languageNotSupported'),
  'on-device-unavailable': tKey('speechIn.error.onDeviceUnavailable'),
  busy: tKey('speechIn.error.busy'),
  interrupted: tKey('speechIn.error.interrupted'),
  unavailable: tKey('speechIn.error.unavailable'),
  unknown: tKey('speechIn.error.unknown'),
};

const STATUS_KEYS: Readonly<Record<SpeechInStatus, CatalogKey>> = {
  ready: tKey('speechIn.status.ready'),
  'needs-permission': tKey('speechIn.status.needsPermission'),
  'permission-denied': tKey('speechIn.status.permissionDenied'),
  'language-not-supported': tKey('speechIn.status.languageNotSupported'),
  'on-device-unavailable': tKey('speechIn.status.onDeviceUnavailable'),
  unavailable: tKey('speechIn.status.unavailable'),
};

const DOWNLOAD_KEYS: Readonly<Record<LanguageDownload, CatalogKey>> = {
  done: tKey('speechIn.download.done'),
  started: tKey('speechIn.download.started'),
  unsupported: tKey('speechIn.download.unsupported'),
  failed: tKey('speechIn.download.failed'),
};

/** The text for a SpeechIn error code. */
export function speechInErrorKey(code: SpeechInErrorCode): CatalogKey {
  return ERROR_KEYS[code] ?? ERROR_KEYS.unknown;
}

/** The status line for an availability; a downloadable on-device model gets its own text. */
export function speechInStatusKey(availability: Pick<SpeechAvailability, 'status' | 'canDownload'>): CatalogKey {
  if (availability.status === 'on-device-unavailable' && availability.canDownload) {
    return tKey('speechIn.status.onDeviceDownload');
  }
  return STATUS_KEYS[availability.status] ?? STATUS_KEYS.unavailable;
}

/** The text after downloadLanguage(). */
export function languageDownloadKey(result: LanguageDownload): CatalogKey {
  return DOWNLOAD_KEYS[result] ?? DOWNLOAD_KEYS.failed;
}

/** The button that starts downloadLanguage(). */
export const SPEECH_IN_DOWNLOAD_ACTION: CatalogKey = tKey('speechIn.download.action');
