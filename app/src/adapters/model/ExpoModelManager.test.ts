import { createHash } from 'crypto';
import { FakeClock } from '../clock/FakeClock';
import { fakeFs } from '../../testing/fakeExpoFileSystem';
import { openTestStorage } from '../../storage/testing/openTestStorage';
import type { Storage } from '../../storage/storage';
import { classifyDownloadError, ExpoModelManager, FREE_SPACE_MARGIN_BYTES, uriToPath } from './ExpoModelManager';
import { createFileHasher, type FileHasher } from './fileHash';
import { keepModelLoaded } from './keepModelLoaded';
import { MockModelAdapter } from './MockModelAdapter';
import type { ModelDescriptor, ModelFileState, ModelFileStatus } from './types';

jest.mock('expo-file-system', () => jest.requireActual('../../testing/fakeExpoFileSystem'));

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function bytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x >>> 16;
  }
  return out;
}

const CONTENT = bytes(10_000);
const MODEL: ModelDescriptor = {
  id: 'test-model',
  url: 'https://example.test/pinned/model.gguf',
  fileName: 'model.gguf',
  bytes: CONTENT.length,
  sha256: sha(CONTENT),
};
const DIR = 'file:///docs/models/';
const FINAL = `${DIR}model.gguf`;
const PART = `${FINAL}.part`;
const RECORD = `${FINAL}.download.json`;

/** Lets pending promise callbacks and timers run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const storages: Storage[] = [];

interface SetupOptions {
  platform?: 'ios' | 'android';
  storage?: Storage;
  free?: number | null;
  resumeOnStart?: boolean;
  hasher?: FileHasher;
  clock?: FakeClock;
}

async function setup(opts: SetupOptions = {}) {
  const storage = opts.storage ?? (await openTestStorage());
  if (!opts.storage) storages.push(storage);
  const keepAwake = { activate: jest.fn(async () => undefined), deactivate: jest.fn(async () => undefined) };
  const hasher = opts.hasher ?? createFileHasher({ native: null, fileDigest: false, chunkBytes: 4096 });
  const hash = jest.spyOn(hasher, 'sha256');
  const excluded: string[] = [];
  const clock = opts.clock ?? new FakeClock();
  const manager = new ExpoModelManager({
    platform: opts.platform ?? 'android',
    descriptor: MODEL,
    modelFiles: async () => storage.modelFiles,
    hasher,
    keepAwake,
    freeBytes: async () => (opts.free === undefined ? 10_000_000_000 : opts.free),
    excludeFromBackup: async (uri) => {
      excluded.push(uri);
    },
    clock,
    resumeOnStart: opts.resumeOnStart,
  });
  const seen: ModelFileState[] = [];
  manager.onChange((s) => seen.push(s));
  const statuses = () => seen.map((s) => s.status).filter((s, i, all) => i === 0 || all[i - 1] !== s);
  return { manager, storage, keepAwake, hash, excluded, clock, seen, statuses };
}

/**
 * Starts a download and waits until the transfer has begun. The promise is wrapped: an async
 * function returning it directly would wait for the whole download.
 */
async function start(manager: ExpoModelManager): Promise<{ done: Promise<ModelFileStatus> }> {
  const done = manager.startDownload();
  await flush();
  return { done };
}

beforeEach(() => {
  fakeFs.reset({ platform: 'android' });
  fakeFs.serve(MODEL.url, CONTENT);
});

afterEach(async () => {
  await Promise.all(storages.splice(0).map((s) => s.close()));
});

describe('ExpoModelManager: download', () => {
  it('downloads with progress, verifies size and SHA-256, and records the file as ready', async () => {
    const { manager, storage, keepAwake, hash, excluded, seen, statuses } = await setup();
    expect(manager.status()).toBe('absent');
    expect(manager.filePath).toBe('/docs/models/model.gguf');

    const { done } = await start(manager);
    expect(manager.startDownload()).toBe(done);
    const op = fakeFs.lastDownload();
    expect(op).toMatchObject({ url: MODEL.url, kind: 'download', offset: 0, sessionType: 'background' });
    expect(op.task.destination.uri).toBe(PART);
    expect(manager.status()).toBe('downloading');
    expect(keepAwake.activate).toHaveBeenCalledTimes(1);

    const before = manager.snapshot();
    op.progress(2500);
    expect(manager.snapshot()).not.toBe(before);
    expect(manager.progress()).toEqual({ bytesWritten: 2500, bytesTotal: 10_000, fraction: 0.25 });
    op.progress(7000);
    expect(manager.progress().fraction).toBeCloseTo(0.7);
    op.complete();

    await expect(done).resolves.toBe('ready');
    expect(statuses()).toEqual(['downloading', 'verifying', 'ready']);
    expect(seen.some((s) => s.status === 'verifying' && s.verifyFraction === 1)).toBe(true);
    expect(manager.snapshot()).toEqual({
      status: 'ready',
      progress: { bytesWritten: 10_000, bytesTotal: 10_000, fraction: 1 },
      error: null,
    });
    expect(hash).toHaveBeenCalledWith(PART, expect.any(Function), expect.anything());
    expect(fakeFs.list()).toEqual([FINAL]);
    expect(fakeFs.readFile(FINAL)).toEqual(CONTENT);
    expect(excluded).toEqual(expect.arrayContaining([DIR, FINAL]));
    expect(keepAwake.activate).toHaveBeenCalledTimes(1);
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1);

    await manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({
      status: 'ready',
      bytes: MODEL.bytes,
      sha256: MODEL.sha256,
      path: '/docs/models/model.gguf',
    });
    await expect(manager.startDownload()).resolves.toBe('ready');
  });

  it('cancel keeps the partial file (Android) and the next start resumes from its length', async () => {
    const { manager, storage, keepAwake } = await setup();
    const { done: first } = await start(manager);
    fakeFs.lastDownload().progress(4000);
    await manager.cancel();
    await expect(first).resolves.toBe('absent');
    expect(manager.snapshot()).toMatchObject({ status: 'absent', error: null, progress: { bytesWritten: 4000 } });
    expect(fakeFs.readFile(PART)?.length).toBe(4000);
    expect(JSON.parse(new TextDecoder().decode(fakeFs.readFile(RECORD) ?? new Uint8Array()))).toMatchObject({
      intent: 'stopped',
      bytesWritten: 4000,
    });
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1);
    await manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({ status: 'missing', bytes: 4000 });

    const { done: second } = await start(manager);
    const resumed = fakeFs.lastDownload();
    expect(resumed).toMatchObject({ kind: 'resume', offset: 4000 });
    expect(resumed.task.resumeData).toBe('4000');
    expect(manager.progress().bytesWritten).toBe(4000);
    resumed.progress(9000);
    resumed.complete();
    await expect(second).resolves.toBe('ready');
    expect(fakeFs.readFile(FINAL)).toEqual(CONTENT);
    expect(fakeFs.operations()).toHaveLength(2);
  });

  it('cancel saves the iOS resume data and the next start resumes from it', async () => {
    fakeFs.reset({ platform: 'ios' });
    fakeFs.serve(MODEL.url, CONTENT);
    const { manager } = await setup({ platform: 'ios' });
    const { done: first } = await start(manager);
    fakeFs.lastDownload().progress(6000);
    expect(fakeFs.exists(PART)).toBe(false); // iOS writes the destination only when complete
    await manager.cancel();
    await expect(first).resolves.toBe('absent');
    const record = JSON.parse(new TextDecoder().decode(fakeFs.readFile(RECORD) ?? new Uint8Array()));
    expect(record).toMatchObject({ intent: 'stopped', bytesWritten: 6000, pause: { url: MODEL.url, fileUri: PART } });
    expect(typeof record.pause.resumeData).toBe('string');
    expect(manager.progress().bytesWritten).toBe(6000);

    const { done: second } = await start(manager);
    const resumed = fakeFs.lastDownload();
    expect(resumed).toMatchObject({ kind: 'resume', offset: 6000 });
    // iOS may count from the resume point; the manager adds the offset back.
    resumed.progress(8000, { relative: true });
    expect(manager.progress().bytesWritten).toBe(8000);
    resumed.complete();
    await expect(second).resolves.toBe('ready');
  });

  it('restarts from zero when the saved iOS resume data no longer works', async () => {
    fakeFs.reset({ platform: 'ios' });
    fakeFs.serve(MODEL.url, CONTENT);
    const { manager } = await setup({ platform: 'ios' });
    await start(manager);
    fakeFs.lastDownload().progress(5000);
    await manager.cancel();
    const record = JSON.parse(new TextDecoder().decode(fakeFs.readFile(RECORD) ?? new Uint8Array()));
    fakeFs.invalidateResumeData(record.pause.resumeData);

    const { done } = await start(manager);
    const fresh = fakeFs.lastDownload();
    expect(fresh).toMatchObject({ kind: 'download', offset: 0 });
    expect(manager.snapshot()).toMatchObject({ status: 'downloading', progress: { bytesWritten: 0 } });
    fresh.complete();
    await expect(done).resolves.toBe('ready');
  });

  it('a failed transfer keeps the Android partial file for the next start; iOS starts over', async () => {
    const android = await setup();
    const { done: first } = await start(android.manager);
    fakeFs.lastDownload().progress(3000);
    fakeFs.lastDownload().fail('unexpected end of stream');
    await expect(first).resolves.toBe('error');
    expect(android.manager.snapshot()).toMatchObject({ status: 'error', error: 'network', progress: { bytesWritten: 3000 } });
    expect(android.keepAwake.deactivate).toHaveBeenCalledTimes(1);
    const { done: retry } = await start(android.manager);
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'resume', offset: 3000 });
    fakeFs.lastDownload().complete();
    await expect(retry).resolves.toBe('ready');

    fakeFs.reset({ platform: 'ios' });
    fakeFs.serve(MODEL.url, CONTENT);
    const ios = await setup({ platform: 'ios' });
    const { done: failed } = await start(ios.manager);
    fakeFs.lastDownload().progress(3000);
    fakeFs.lastDownload().fail('The network connection was lost.');
    await expect(failed).resolves.toBe('error');
    expect(ios.manager.snapshot()).toMatchObject({ error: 'network', progress: { bytesWritten: 0 } });
    await start(ios.manager);
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'download', offset: 0 });
  });

  it('refuses to start without enough free space, and says how much is needed', async () => {
    const free = 300_000_000;
    const { manager, keepAwake, storage } = await setup({ free });
    await expect(manager.startDownload()).resolves.toBe('error');
    expect(manager.snapshot()).toEqual({
      status: 'error',
      error: 'insufficient-storage',
      progress: { bytesWritten: 0, bytesTotal: 10_000, fraction: 0 },
      space: { freeBytes: free, neededBytes: MODEL.bytes + FREE_SPACE_MARGIN_BYTES },
    });
    expect(fakeFs.operations()).toHaveLength(0);
    expect(keepAwake.activate).not.toHaveBeenCalled();
    await manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({ status: 'failed' });
  });

  it('counts only the bytes still to fetch when resuming, and skips the check when free space is unknown', async () => {
    fakeFs.writeFile(PART, CONTENT.slice(0, 8000));
    const { manager } = await setup({ free: FREE_SPACE_MARGIN_BYTES + 2500, resumeOnStart: false });
    expect(manager.progress().bytesWritten).toBe(8000);
    const { done } = await start(manager);
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'resume', offset: 8000 });
    fakeFs.lastDownload().complete();
    await expect(done).resolves.toBe('ready');

    fakeFs.reset();
    fakeFs.serve(MODEL.url, CONTENT);
    const unknown = await setup({ free: null });
    await start(unknown.manager);
    expect(unknown.manager.status()).toBe('downloading');
  });

  it('deletes a file that fails the SHA-256 check and says so', async () => {
    const { manager, storage, keepAwake, statuses } = await setup();
    const { done } = await start(manager);
    fakeFs.lastDownload().complete({ corrupt: true });
    await expect(done).resolves.toBe('error');
    expect(statuses()).toEqual(['downloading', 'verifying', 'error']);
    expect(manager.snapshot()).toMatchObject({ status: 'error', error: 'checksum-mismatch', progress: { bytesWritten: 0 } });
    expect(fakeFs.list()).toEqual([]);
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1);
    await manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({ status: 'failed', sha256: null, bytes: 0 });

    // A retry downloads it again from the start.
    const { done: retry } = await start(manager);
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'download', offset: 0 });
    fakeFs.lastDownload().complete();
    await expect(retry).resolves.toBe('ready');
  });

  it('deletes a file of the wrong size without hashing it', async () => {
    const { manager, hash } = await setup();
    const { done } = await start(manager);
    fakeFs.lastDownload().complete({ truncate: 10 });
    await expect(done).resolves.toBe('error');
    expect(manager.snapshot()).toMatchObject({ error: 'size-mismatch' });
    expect(hash).not.toHaveBeenCalled();
    expect(fakeFs.list()).toEqual([]);
  });

  it('stops early when the server announces another length', async () => {
    fakeFs.serve(MODEL.url, bytes(12_345));
    const { manager } = await setup();
    const { done } = await start(manager);
    const op = fakeFs.lastDownload();
    op.progress(100);
    await expect(done).resolves.toBe('error');
    expect(manager.snapshot()).toMatchObject({ error: 'size-mismatch' });
    expect(op.task.state).toBe('cancelled');
    expect(fakeFs.exists(PART)).toBe(false);
  });

  it('reports a full disk during the transfer as insufficient storage', async () => {
    const { manager } = await setup();
    const { done } = await start(manager);
    fakeFs.lastDownload().fail('write failed: ENOSPC (No space left on device)');
    await expect(done).resolves.toBe('error');
    expect(manager.snapshot().error).toBe('insufficient-storage');
  });

  it('shows the hashing progress while verifying', async () => {
    const steps = [0.25, 0.5, 1];
    const hasher: FileHasher = {
      async sha256(_uri, onProgress) {
        for (const f of steps) onProgress?.(f * MODEL.bytes, MODEL.bytes);
        return { sha256: MODEL.sha256, method: 'native-module' };
      },
    };
    const { manager, seen } = await setup({ hasher });
    const { done } = await start(manager);
    fakeFs.lastDownload().complete();
    await expect(done).resolves.toBe('ready');
    expect(seen.filter((s) => s.status === 'verifying').map((s) => s.verifyFraction)).toEqual([0, 0.25, 0.5, 1]);
  });
});

describe('ExpoModelManager: startup', () => {
  async function verifiedOnDisk() {
    const first = await setup();
    const { done } = await start(first.manager);
    fakeFs.lastDownload().complete();
    await done;
    await first.manager.flushStorage();
    return first;
  }

  it('recognizes a verified file from its model_files row without hashing it again', async () => {
    const { storage, clock } = await verifiedOnDisk();
    clock.advance(60_000);
    const next = await setup({ storage, clock });
    expect(next.manager.status()).toBe('verifying');
    await next.manager.whenStarted();
    expect(next.manager.status()).toBe('ready');
    expect(next.hash).not.toHaveBeenCalled();
    expect(next.statuses()).toEqual(['ready']);
    expect(next.excluded).toContain(FINAL);
  });

  it('hashes the file again when the row is missing, differs, or is older than the file', async () => {
    const { storage, clock } = await verifiedOnDisk();

    // The file changed after it was verified (mtime after updated_at).
    fakeFs.writeFile(FINAL, CONTENT, clock.now() + 1000);
    const touched = await setup({ storage, clock });
    await touched.manager.whenStarted();
    await expect(touched.manager.startDownload()).resolves.toBe('ready');
    expect(touched.hash).toHaveBeenCalledTimes(1);
    expect(touched.statuses()).toEqual(['verifying', 'ready']);

    // No row (e.g. the app stopped between the rename and the write).
    await touched.manager.flushStorage();
    await storage.modelFiles.remove(MODEL.id);
    clock.advance(10_000);
    const noRow = await setup({ storage, clock });
    await noRow.manager.whenStarted();
    expect(noRow.manager.status()).toBe('ready');
    expect(noRow.hash).toHaveBeenCalledTimes(1);
    await noRow.manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({ status: 'ready', sha256: MODEL.sha256 });
  });

  it('deletes a damaged model file found at startup and says so', async () => {
    const { storage, clock } = await verifiedOnDisk();
    const damaged = CONTENT.slice();
    damaged[10] = (damaged[10] as number) ^ 0xff;
    fakeFs.writeFile(FINAL, damaged, clock.now() + 1000);
    const next = await setup({ storage, clock });
    await next.manager.whenStarted();
    expect(next.manager.snapshot()).toMatchObject({ status: 'error', error: 'checksum-mismatch' });
    expect(fakeFs.exists(FINAL)).toBe(false);

    fakeFs.writeFile(FINAL, CONTENT.slice(0, 50));
    const short = await setup({ storage, clock });
    await short.manager.whenStarted();
    expect(short.manager.snapshot()).toMatchObject({ status: 'error', error: 'size-mismatch' });
    expect(short.hash).not.toHaveBeenCalled();
    expect(fakeFs.exists(FINAL)).toBe(false);
  });

  it('resumes a download that was running when the app stopped', async () => {
    const before = await setup();
    await start(before.manager);
    fakeFs.lastDownload().progress(5500);
    // The app is killed here: the record still says 'running' and the part file has 5500 bytes.

    const after = await setup({ storage: before.storage });
    expect(after.manager.snapshot()).toMatchObject({ status: 'absent', progress: { bytesWritten: 5500 } });
    await after.manager.whenStarted();
    await flush();
    expect(after.manager.status()).toBe('downloading');
    const resumed = fakeFs.lastDownload();
    expect(resumed).toMatchObject({ kind: 'resume', offset: 5500 });
    resumed.complete();
    await expect(after.manager.startDownload()).resolves.toBe('ready');
  });

  it('restarts an iOS download that was running when the app stopped (nothing to resume from)', async () => {
    fakeFs.reset({ platform: 'ios' });
    fakeFs.serve(MODEL.url, CONTENT);
    const before = await setup({ platform: 'ios' });
    await start(before.manager);
    fakeFs.lastDownload().progress(5500);

    const after = await setup({ platform: 'ios', storage: before.storage });
    expect(after.manager.progress().bytesWritten).toBe(0);
    await after.manager.whenStarted();
    await flush();
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'download', offset: 0 });
  });

  it('keeps a stopped download stopped, showing how far it got', async () => {
    const before = await setup();
    await start(before.manager);
    fakeFs.lastDownload().progress(4200);
    await before.manager.cancel();

    const after = await setup({ storage: before.storage });
    await after.manager.whenStarted();
    await flush();
    expect(after.manager.snapshot()).toMatchObject({ status: 'absent', progress: { bytesWritten: 4200 } });
    expect(fakeFs.operations()).toHaveLength(1);
  });

  it('verifies a finished transfer that was never checked', async () => {
    fakeFs.writeFile(PART, CONTENT);
    const { manager } = await setup();
    expect(manager.status()).toBe('verifying');
    await manager.whenStarted();
    expect(manager.status()).toBe('ready');
    expect(fakeFs.list()).toEqual([FINAL]);
  });

  it('drops a partial download of another model file', async () => {
    fakeFs.writeFile(PART, CONTENT.slice(0, 100));
    fakeFs.writeFile(RECORD, new TextEncoder().encode(JSON.stringify({ v: 1, url: 'https://old', sha256: 'a'.repeat(64), intent: 'running', bytesWritten: 100 })));
    const { manager } = await setup();
    await manager.whenStarted();
    await flush();
    expect(manager.snapshot()).toMatchObject({ status: 'absent', progress: { bytesWritten: 0 } });
    expect(fakeFs.list()).toEqual([]);
    expect(fakeFs.operations()).toHaveLength(0);
  });
});

describe('ExpoModelManager: delete and download again', () => {
  it('delete frees the file and the next start downloads it again', async () => {
    const { manager, storage } = await setup();
    const { done: first } = await start(manager);
    fakeFs.lastDownload().complete();
    await expect(first).resolves.toBe('ready');

    await manager.delete();
    expect(manager.snapshot()).toEqual({
      status: 'absent',
      progress: { bytesWritten: 0, bytesTotal: 10_000, fraction: 0 },
      error: null,
    });
    expect(fakeFs.list()).toEqual([]);
    await manager.flushStorage();
    expect(await storage.modelFiles.get(MODEL.id)).toMatchObject({ status: 'missing', bytes: 0, sha256: null });

    const { done: again } = await start(manager);
    expect(fakeFs.lastDownload()).toMatchObject({ kind: 'download', offset: 0 });
    fakeFs.lastDownload().complete();
    await expect(again).resolves.toBe('ready');
    expect(fakeFs.readFile(FINAL)).toEqual(CONTENT);
  });

  it('delete during a download cancels it and removes the partial file', async () => {
    const { manager, keepAwake } = await setup();
    const { done } = await start(manager);
    const op = fakeFs.lastDownload();
    op.progress(3000);
    await manager.delete();
    await expect(done).resolves.toBe('absent');
    expect(op.task.state).toBe('cancelled');
    expect(fakeFs.list()).toEqual([]);
    expect(manager.progress().bytesWritten).toBe(0);
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1);
  });

  it('delete during startup verification stops it', async () => {
    let release: (() => void) | undefined;
    const hasher: FileHasher = {
      sha256: () =>
        new Promise((resolve) => {
          release = () => resolve({ sha256: MODEL.sha256, method: 'native-module' });
        }),
    };
    fakeFs.writeFile(FINAL, CONTENT);
    const { manager } = await setup({ hasher });
    await flush();
    expect(manager.status()).toBe('verifying');
    await manager.delete();
    release?.();
    await manager.whenStarted();
    expect(manager.status()).toBe('absent');
    expect(fakeFs.list()).toEqual([]);
  });
});

describe('ExpoModelManager with keepModelLoaded', () => {
  it('the model adapter loads the file once it is ready and unloads it when deleted', async () => {
    const { manager } = await setup();
    const model = new MockModelAdapter();
    await model.unload();
    const load = jest.spyOn(model, 'load');
    keepModelLoaded(model, manager);

    const { done } = await start(manager);
    expect(load).not.toHaveBeenCalled();
    fakeFs.lastDownload().complete();
    await done;
    await flush();
    expect(load).toHaveBeenCalledWith('/docs/models/model.gguf', undefined);
    expect(model.status).toBe('ready');

    await manager.delete();
    await flush();
    expect(model.status).toBe('unloaded');
  });
});

describe('helpers', () => {
  it('turns file URIs into paths', () => {
    expect(uriToPath('file:///var/mobile/Containers/Data/Application/A/Documents/models/x.gguf')).toBe(
      '/var/mobile/Containers/Data/Application/A/Documents/models/x.gguf',
    );
    expect(uriToPath('file:///data/user/0/app/files/my%20models/x.gguf')).toBe('/data/user/0/app/files/my models/x.gguf');
    expect(uriToPath('/already/a/path')).toBe('/already/a/path');
  });

  it('classifies transfer errors', () => {
    expect(classifyDownloadError(new Error('ENOSPC (No space left on device)'))).toBe('insufficient-storage');
    expect(classifyDownloadError(new Error('HTTP 404'))).toBe('network');
    expect(classifyDownloadError('timeout')).toBe('network');
  });
});
