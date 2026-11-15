import { createFakeLlamaRuntime } from '../../testing/fakeLlamaRn';
import { FakeModelManager } from './FakeModelManager';
import { keepModelLoaded, modelAvailability } from './keepModelLoaded';
import { LlamaModelAdapter } from './LlamaModelAdapter';
import type { ModelStatus } from './types';

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup(initial: 'absent' | 'ready', filePath = 'file:///models/Qwen3-1.7B-Q4_K_M.gguf') {
  const runtime = createFakeLlamaRuntime();
  const model = new LlamaModelAdapter({ runtime });
  const manager = new FakeModelManager({ initial, mode: 'manual', filePath });
  const statuses: ModelStatus[] = [];
  model.onStatusChange((s) => statuses.push(s));
  return { runtime, model, manager, statuses };
}

describe('keepModelLoaded', () => {
  it('loads the model at once when the file is already verified', async () => {
    const { runtime, model, manager } = setup('ready');
    keepModelLoaded(model, manager);
    await settle();
    expect(model.status).toBe('ready');
    expect(runtime.initCalls.map((p) => p.model)).toEqual([manager.filePath]);
  });

  it('stays unloaded while the file is missing or downloading, and loads once it is verified', async () => {
    const { model, manager, statuses } = setup('absent');
    keepModelLoaded(model, manager);
    await settle();
    expect(model.status).toBe('unloaded');
    void manager.startDownload();
    manager.progressTo(1000);
    manager.finishDownload();
    await settle();
    expect(model.status).toBe('unloaded');
    manager.verify(true);
    await settle();
    expect(model.status).toBe('ready');
    expect(statuses).toEqual(['loading', 'ready']);
  });

  it('unloads the model when the file is deleted', async () => {
    const { runtime, model, manager } = setup('ready');
    keepModelLoaded(model, manager);
    await settle();
    await manager.delete();
    await settle();
    expect(model.status).toBe('unloaded');
    expect(runtime.contexts[0]!.released).toBe(true);
  });

  it('does not retry a failed load on its own; retry() and a new verified file do', async () => {
    const { runtime, model, manager } = setup('ready');
    runtime.failNextInit(new Error('not a GGUF file'));
    const loader = keepModelLoaded(model, manager);
    await settle();
    expect(model.status).toBe('error');
    expect(model.lastError?.message).toBe('not a GGUF file');
    expect(runtime.initCalls).toHaveLength(1);
    await loader.retry();
    expect(model.status).toBe('ready');
    expect(runtime.initCalls).toHaveLength(2);
    // A ready model is left alone by retry().
    await loader.retry();
    expect(runtime.initCalls).toHaveLength(2);

    runtime.failNextInit(new Error('again'));
    await manager.delete();
    void manager.startDownload();
    manager.complete();
    await settle();
    expect(model.status).toBe('error');
    void manager.delete();
    void manager.startDownload();
    manager.complete();
    await settle();
    expect(model.status).toBe('ready');
  });

  it('stops following the file after stop()', async () => {
    const { runtime, model, manager } = setup('absent');
    const loader = keepModelLoaded(model, manager);
    loader.stop();
    void manager.startDownload();
    manager.complete();
    await settle();
    expect(model.status).toBe('unloaded');
    await loader.retry();
    expect(runtime.initCalls).toHaveLength(0);
  });
});

describe('modelAvailability', () => {
  it.each([
    ['absent', 'unloaded', 'missing'],
    ['downloading', 'unloaded', 'downloading'],
    ['verifying', 'unloaded', 'verifying'],
    ['error', 'unloaded', 'download-failed'],
    ['ready', 'unloaded', 'loading'],
    ['ready', 'loading', 'loading'],
    ['ready', 'ready', 'ready'],
    ['ready', 'error', 'load-failed'],
  ] as const)('file %s, model %s -> %s', (file, model, want) => {
    expect(modelAvailability({ status: file }, model)).toBe(want);
  });
});
