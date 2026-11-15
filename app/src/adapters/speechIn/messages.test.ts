import { en } from '../../i18n/catalog';
import { SPEECH_IN_DOWNLOAD_ACTION, languageDownloadKey, speechInErrorKey, speechInStatusKey } from './messages';
import type { LanguageDownload, SpeechInErrorCode, SpeechInStatus } from './types';

const ERROR_CODES: SpeechInErrorCode[] = [
  'not-allowed',
  'no-speech',
  'no-match',
  'audio-capture',
  'network',
  'language-not-supported',
  'on-device-unavailable',
  'busy',
  'interrupted',
  'unavailable',
  'unknown',
];
const STATUSES: SpeechInStatus[] = [
  'ready',
  'needs-permission',
  'permission-denied',
  'language-not-supported',
  'on-device-unavailable',
  'unavailable',
];
const DOWNLOADS: LanguageDownload[] = ['done', 'started', 'unsupported', 'failed'];

describe('speech input texts', () => {
  const text = (key: string) => (en as Record<string, string>)[key];

  it('has a distinct catalog text for every error code', () => {
    const keys = ERROR_CODES.map(speechInErrorKey);
    for (const key of keys) expect(text(key)).toEqual(expect.any(String));
    expect(new Set(keys).size).toBe(ERROR_CODES.length);
    expect(text(speechInErrorKey('no-match'))).not.toBe(text(speechInErrorKey('no-speech')));
  });

  it('has a status line for every availability, with a download text for a missing pack', () => {
    for (const status of STATUSES) expect(text(speechInStatusKey({ status, canDownload: false }))).toEqual(expect.any(String));
    expect(speechInStatusKey({ status: 'on-device-unavailable', canDownload: true })).toBe('speechIn.status.onDeviceDownload');
    expect(speechInStatusKey({ status: 'ready', canDownload: true })).toBe('speechIn.status.ready');
    for (const result of DOWNLOADS) expect(text(languageDownloadKey(result))).toEqual(expect.any(String));
    expect(text(SPEECH_IN_DOWNLOAD_ACTION)).toEqual(expect.any(String));
  });

  it('keeps typing in view wherever speech cannot be used', () => {
    for (const code of ['not-allowed', 'language-not-supported', 'on-device-unavailable', 'unavailable'] as const) {
      expect(text(speechInErrorKey(code))).toMatch(/type/i);
    }
    for (const status of STATUSES.filter((s) => s !== 'ready' && s !== 'needs-permission')) {
      expect(text(speechInStatusKey({ status, canDownload: false }))).toMatch(/type/i);
    }
  });
});
