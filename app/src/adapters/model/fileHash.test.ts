import { createHash } from 'crypto';
import { createFileHasher, HashAbortedError } from './fileHash';
import { fakeFs } from '../../testing/fakeExpoFileSystem';

jest.mock('expo-file-system', () => jest.requireActual('../../testing/fakeExpoFileSystem'));

const URI = 'file:///docs/models/blob.bin';
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >> 7)) & 0xff;
  return out;
}

type Listener = (event: { jobId: string; bytesRead: number; totalBytes: number }) => void;

/** A stand-in for the cliffword-native module: hashes with node:crypto and emits progress. */
function fakeNative(opts: { fail?: boolean; garbage?: boolean } = {}) {
  const listeners = new Set<Listener>();
  const native = {
    calls: [] as string[],
    addListener: jest.fn((_event: 'onHashProgress', listener: Listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
    sha256File: jest.fn(async (uri: string, jobId: string) => {
      native.calls.push(uri);
      if (opts.fail) throw new Error('native hash failed');
      const data = fakeFs.readFile(uri);
      if (!data) throw new Error('missing');
      // Another job's event must be ignored.
      for (const l of listeners) l({ jobId: 'someone-else', bytesRead: 1, totalBytes: 2 });
      for (const l of listeners) l({ jobId, bytesRead: data.length / 2, totalBytes: data.length });
      for (const l of listeners) l({ jobId, bytesRead: data.length, totalBytes: data.length });
      return opts.garbage ? 'not-a-hash' : sha(data).toUpperCase();
    }),
    listenerCount: () => listeners.size,
  };
  return native;
}

describe('createFileHasher', () => {
  const data = bytes(10_000);

  beforeEach(() => {
    fakeFs.reset();
    fakeFs.writeFile(URI, data);
  });

  it('uses the native module first, with progress for its own job only, and cleans up', async () => {
    const native = fakeNative();
    const progress: [number, number][] = [];
    const result = await createFileHasher({ native }).sha256(URI, (read, total) => progress.push([read, total]));
    expect(result).toEqual({ sha256: sha(data), method: 'native-module' });
    expect(progress).toEqual([
      [5000, 10_000],
      [10_000, 10_000],
    ]);
    expect(native.listenerCount()).toBe(0);
  });

  it('falls back to File#digest when the native module fails or returns garbage', async () => {
    fakeFs.setDigest('sha256', sha);
    for (const native of [fakeNative({ fail: true }), fakeNative({ garbage: true }), null]) {
      const progress: number[] = [];
      const result = await createFileHasher({ native }).sha256(URI, (read) => progress.push(read));
      expect(result).toEqual({ sha256: sha(data), method: 'file-digest' });
      expect(progress[progress.length - 1]).toBe(10_000);
      expect(native?.listenerCount() ?? 0).toBe(0);
    }
  });

  it('falls back to the JS hash in slices when there is no native digest', async () => {
    const progress: number[] = [];
    const result = await createFileHasher({ native: null, chunkBytes: 4096 }).sha256(URI, (read, total) => {
      expect(total).toBe(10_000);
      progress.push(read);
    });
    expect(result).toEqual({ sha256: sha(data), method: 'js' });
    expect(progress).toEqual([4096, 8192, 10_000]);
  });

  it('skips File#digest when told to', async () => {
    fakeFs.setDigest('sha256', () => 'f'.repeat(64));
    const result = await createFileHasher({ native: null, fileDigest: false }).sha256(URI);
    expect(result).toEqual({ sha256: sha(data), method: 'js' });
  });

  it('rejects for a missing file and stops the JS hash when aborted', async () => {
    await expect(createFileHasher({ native: fakeNative() }).sha256('file:///docs/models/none.bin')).rejects.toThrow(/No file/);

    let reads = 0;
    const signal = {
      get aborted() {
        return reads >= 2;
      },
    };
    await expect(
      createFileHasher({ native: null, chunkBytes: 1000 }).sha256(URI, () => (reads += 1), signal),
    ).rejects.toBeInstanceOf(HashAbortedError);
    expect(reads).toBe(2);
  });
});
