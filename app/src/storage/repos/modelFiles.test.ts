import { openTestStorage } from '../testing/openTestStorage';

const QWEN = 'qwen3-1.7b-q4_k_m';

describe('ModelFileRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('tracks a model file through download and check', async () => {
    const path = 'models/Qwen3-1.7B-Q4_K_M.gguf';
    const created = await storage.modelFiles.upsert({ id: QWEN, path, status: 'missing', updatedAt: 1 });
    expect(created).toEqual({ id: QWEN, path, bytes: 0, sha256: null, status: 'missing', updatedAt: 1 });

    expect(await storage.modelFiles.setStatus(QWEN, 'downloading', { bytes: 1_000, at: 2 })).toMatchObject({
      status: 'downloading',
      bytes: 1_000,
      sha256: null,
      updatedAt: 2,
    });
    await storage.modelFiles.setStatus(QWEN, 'verifying', { bytes: 1_107_409_472, at: 3 });
    const ready = await storage.modelFiles.setStatus(QWEN, 'ready', { sha256: 'ab'.repeat(32), at: 4 });
    expect(ready).toEqual({ id: QWEN, path, bytes: 1_107_409_472, sha256: 'ab'.repeat(32), status: 'ready', updatedAt: 4 });

    // A status change without a checksum keeps the stored one; an explicit null clears it.
    await storage.modelFiles.setStatus(QWEN, 'ready', { at: 5 });
    expect((await storage.modelFiles.get(QWEN))?.sha256).toBe('ab'.repeat(32));
    await storage.modelFiles.setStatus(QWEN, 'failed', { sha256: null, at: 6 });
    expect(await storage.modelFiles.get(QWEN)).toMatchObject({ status: 'failed', sha256: null });
  });

  it('lists, replaces and removes files', async () => {
    await storage.modelFiles.upsert({ id: 'b', path: 'b.gguf', status: 'ready', bytes: 2 });
    await storage.modelFiles.upsert({ id: 'a', path: 'a.gguf', status: 'missing' });
    await storage.modelFiles.upsert({ id: 'a', path: 'a2.gguf', status: 'downloading' });
    expect((await storage.modelFiles.list()).map((f) => [f.id, f.path, f.status])).toEqual([
      ['a', 'a2.gguf', 'downloading'],
      ['b', 'b.gguf', 'ready'],
    ]);
    await storage.modelFiles.remove('a');
    expect(await storage.modelFiles.get('a')).toBeNull();
  });

  it('returns null for an unknown file and rejects unknown statuses', async () => {
    expect(await storage.modelFiles.setStatus('nope', 'ready')).toBeNull();
    await expect(storage.modelFiles.upsert({ id: 'x', path: 'x', status: 'done' as 'ready' })).rejects.toThrow(/status/);
  });
});
