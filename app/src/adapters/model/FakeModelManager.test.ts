import { DEFAULT_MODEL, QWEN3_1_7B_Q4_K_M } from './descriptor';
import { FakeModelManager } from './FakeModelManager';
import type { ModelFileStatus } from './types';

describe('DEFAULT_MODEL', () => {
  it('is Qwen3-1.7B Q4_K_M from unsloth/Qwen3-1.7B-GGUF, pinned to a commit, with size and SHA-256', () => {
    expect(DEFAULT_MODEL).toBe(QWEN3_1_7B_Q4_K_M);
    expect(DEFAULT_MODEL.id).toBe('qwen3-1.7b-q4_k_m');
    expect(DEFAULT_MODEL.url).toMatch(
      /^https:\/\/huggingface\.co\/unsloth\/Qwen3-1\.7B-GGUF\/resolve\/[0-9a-f]{40}\/Qwen3-1\.7B-Q4_K_M\.gguf$/,
    );
    expect(DEFAULT_MODEL.url.endsWith(`/${DEFAULT_MODEL.fileName}`)).toBe(true);
    expect(DEFAULT_MODEL.bytes).toBe(1107409472);
    expect(DEFAULT_MODEL.sha256).toBe('b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897');
  });
});

describe('FakeModelManager', () => {
  it('is ready from the start by default (web and tests run the mock)', async () => {
    const manager = new FakeModelManager();
    expect(manager.status()).toBe('ready');
    expect(manager.progress()).toEqual({ bytesWritten: DEFAULT_MODEL.bytes, bytesTotal: DEFAULT_MODEL.bytes, fraction: 1 });
    expect(manager.filePath).toBe('memory://models/Qwen3-1.7B-Q4_K_M.gguf');
    await expect(manager.startDownload()).resolves.toBe('ready');
    expect(manager.downloadsStarted).toBe(0);
  });

  it('instant mode steps through downloading and verifying to ready', async () => {
    const manager = new FakeModelManager({ initial: 'absent' });
    const seen: ModelFileStatus[] = [];
    manager.onChange((s) => seen.push(s.status));
    expect(manager.status()).toBe('absent');

    const first = manager.startDownload();
    expect(manager.startDownload()).toBe(first);
    await expect(first).resolves.toBe('ready');
    expect(seen).toEqual(['downloading', 'downloading', 'verifying', 'ready']);
    expect(manager.progress().fraction).toBe(1);
    expect(manager.downloadsStarted).toBe(1);
  });

  it('manual mode lets the test drive progress, verification and failure', async () => {
    const manager = new FakeModelManager({ initial: 'absent', mode: 'manual' });
    const done = manager.startDownload();
    expect(manager.status()).toBe('downloading');

    const before = manager.snapshot();
    manager.progressTo(DEFAULT_MODEL.bytes / 4);
    expect(manager.snapshot()).not.toBe(before);
    expect(manager.progress().fraction).toBeCloseTo(0.25);
    expect(() => manager.verify()).toThrow(/expected 'verifying'/);

    manager.finishDownload();
    expect(manager.status()).toBe('verifying');
    manager.verify(false);
    await expect(done).resolves.toBe('error');
    expect(manager.snapshot().error).toBe('checksum-mismatch');

    const retry = manager.startDownload();
    manager.fail('insufficient-storage');
    await expect(retry).resolves.toBe('error');
    expect(manager.snapshot().error).toBe('insufficient-storage');

    const third = manager.startDownload();
    manager.complete();
    await expect(third).resolves.toBe('ready');
    expect(manager.snapshot()).toMatchObject({ status: 'ready', error: null });
  });

  it('cancel keeps the partial download and the next start resumes from it', async () => {
    const manager = new FakeModelManager({ initial: 'absent', mode: 'manual' });
    const run = manager.startDownload();
    manager.progressTo(1000);
    await manager.cancel();
    await expect(run).resolves.toBe('absent');
    expect(manager.snapshot()).toMatchObject({ status: 'absent', error: null });
    expect(manager.progress().bytesWritten).toBe(1000);

    void manager.startDownload();
    expect(manager.progress().bytesWritten).toBe(1000);
    expect(manager.downloadsStarted).toBe(2);
  });

  it('cancel stops an instant download before it completes', async () => {
    const manager = new FakeModelManager({ initial: 'absent' });
    const run = manager.startDownload();
    await manager.cancel();
    await expect(run).resolves.toBe('absent');
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.status()).toBe('absent');
  });

  it('delete removes a ready file and a running download', async () => {
    const manager = new FakeModelManager();
    await manager.delete();
    expect(manager.snapshot()).toEqual({
      status: 'absent',
      progress: { bytesWritten: 0, bytesTotal: DEFAULT_MODEL.bytes, fraction: 0 },
      error: null,
    });

    const manual = new FakeModelManager({ initial: 'absent', mode: 'manual' });
    const run = manual.startDownload();
    manual.progressTo(5);
    await manual.delete();
    await expect(run).resolves.toBe('absent');
    expect(manual.progress().bytesWritten).toBe(0);
  });
});
