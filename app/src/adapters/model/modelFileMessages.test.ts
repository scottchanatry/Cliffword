import { createTranslator } from '../../i18n/translator';
import { DEFAULT_MODEL, FREE_SPACE_MARGIN_BYTES } from './descriptor';
import { formatBytes, MODEL_DOWNLOAD_NOTES, MODEL_FILE_ACTIONS, modelFileMessage, modelProgressMessage } from './modelFileMessages';
import type { ModelFileState } from './types';

const { t } = createTranslator({ native: 'en', onMissing: (key) => { throw new Error(`missing ${key}`); } });
const total = DEFAULT_MODEL.bytes;
const state = (patch: Partial<ModelFileState>): ModelFileState => ({
  status: 'absent',
  progress: { bytesWritten: 0, bytesTotal: total, fraction: 0 },
  error: null,
  ...patch,
});
const text = (s: ModelFileState) => {
  const m = modelFileMessage(s, DEFAULT_MODEL, t);
  return t(m.key, m.vars);
};

describe('model file messages', () => {
  it('formats sizes in decimal units through the catalog', () => {
    expect(formatBytes(DEFAULT_MODEL.bytes, t)).toBe('1.1 GB');
    expect(formatBytes(2_000_000_000, t)).toBe('2 GB');
    expect(formatBytes(640_400_000, t)).toBe('640 MB');
    expect(formatBytes(1, t)).toBe('1 MB');
    expect(formatBytes(0, t)).toBe('0 MB');
    expect(formatBytes(1_250_000_000, t, 'de')).toBe('1,3 GB');
  });

  it('describes every status', () => {
    expect(text(state({}))).toBe('Cliffword runs a small language model on this phone, so stories work offline. It needs 1.1 GB.');
    expect(text(state({ progress: { bytesWritten: total / 4, bytesTotal: total, fraction: 0.25 } }))).toBe(
      'Paused at 25%. Resume to continue where it stopped.',
    );
    expect(text(state({ status: 'downloading', progress: { bytesWritten: 1, bytesTotal: total, fraction: 0.426 } }))).toBe(
      'Downloading… 42%',
    );
    expect(text(state({ status: 'verifying' }))).toBe('Checking the file…');
    expect(text(state({ status: 'verifying', verifyFraction: 0.5 }))).toBe('Checking the file… 50%');
    expect(text(state({ status: 'ready' }))).toBe('Ready. The model is on your phone.');
  });

  it('says why a download failed, and that a bad file was deleted', () => {
    expect(text(state({ status: 'error', error: 'network' }))).toMatch(/connection/);
    expect(text(state({ status: 'error', error: 'checksum-mismatch' }))).toBe(
      'The downloaded file was damaged, so it was deleted. Download it again.',
    );
    expect(text(state({ status: 'error', error: 'size-mismatch' }))).toMatch(/incomplete, so it was deleted/);
    expect(text(state({ status: 'error', error: 'unknown' }))).toMatch(/Try again/);
  });

  it('gives the space figures when the phone is short', () => {
    expect(
      text(state({ status: 'error', error: 'insufficient-storage', space: { freeBytes: 900_000_000, neededBytes: 1_707_409_472 } })),
    ).toBe('Not enough free space. The model needs 1.7 GB free and this phone has 900 MB. Free up 807 MB, then try again.');
    expect(text(state({ status: 'error', error: 'insufficient-storage' }))).toBe(
      `Not enough free space. The model needs about ${formatBytes(total + FREE_SPACE_MARGIN_BYTES, t)} free.`,
    );
  });

  it('has the notes, the actions and a byte count label', () => {
    expect(t(MODEL_DOWNLOAD_NOTES.cellular, { size: formatBytes(total, t) })).toBe(
      'Use Wi-Fi if you can. Over mobile data, 1.1 GB counts against your plan.',
    );
    expect(t(MODEL_DOWNLOAD_NOTES.keepOpen)).toMatch(/screen stays on/);
    for (const key of Object.values(MODEL_FILE_ACTIONS)) expect(t(key, { size: '1.1 GB' })).not.toBe(key);
    const m = modelProgressMessage(state({ progress: { bytesWritten: 553_704_736, bytesTotal: total, fraction: 0.5 } }), t);
    expect(t(m.key, m.vars)).toBe('554 MB of 1.1 GB');
  });
});
