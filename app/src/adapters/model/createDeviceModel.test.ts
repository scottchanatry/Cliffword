import * as llama from 'llama.rn';
import type { AppStateStatus } from 'react-native';
import { createNativeServices } from '../../services/nativeServices';
import type { FakeLlamaRuntime } from '../../testing/fakeLlamaRn';
import { FakeModelManager } from './FakeModelManager';
import { createDeviceModel } from './createDeviceModel';
import { LlamaModelAdapter } from './LlamaModelAdapter';
import { MockModelAdapter } from './MockModelAdapter';

// The web twin by its file name (Jest, like the iOS bundle, resolves './createDeviceModel' to the
// native file).
const { createDeviceModel: createWebDeviceModel } =
  jest.requireActual<typeof import('./createDeviceModel.web')>('./createDeviceModel.web');

// __mocks__/llama.rn.ts: the fake llama.rn with the Cliffword patch.
const fakeRuntime = (llama as unknown as { __fakeRuntime: FakeLlamaRuntime }).__fakeRuntime;

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('createDeviceModel', () => {
  it('gives the llama.rn adapter on iOS and Android, unloaded until load()', async () => {
    const model = createDeviceModel();
    expect(model).toBeInstanceOf(LlamaModelAdapter);
    expect(model.status).toBe('unloaded');
    await model.load('file:///models/q.gguf');
    expect(model.info).toMatchObject({ backend: 'llama.rn', scoring: 'native' });
    expect(fakeRuntime.initCalls[fakeRuntime.initCalls.length - 1]).toMatchObject({ model: 'file:///models/q.gguf', n_gpu_layers: 99 });
    await model.unload();
  });

  it('follows AppState on iOS: model calls wait while the app is in the background', async () => {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const appState = {
      currentState: 'active' as AppStateStatus,
      addEventListener: jest.fn((_type: 'change', l: (state: AppStateStatus) => void) => {
        listener = l;
        return { remove: jest.fn() };
      }),
    };
    const model = createDeviceModel({ platform: 'ios' }, appState) as LlamaModelAdapter;
    await model.load('file:///models/q.gguf');
    const before = fakeRuntime.calls.length;
    listener?.('background');
    const scoring = model.scoreContinuation('', 'Hola.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeRuntime.calls.length).toBe(before);
    listener?.('active');
    expect((await scoring).length).toBeGreaterThan(0);
    await model.unload();
    // Android runs on the CPU: no AppState subscription.
    createDeviceModel({ platform: 'android' }, appState);
    expect(appState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('gives the ready mock on the web (createDeviceModel.web.ts)', () => {
    const model = createWebDeviceModel();
    expect(model).toBeInstanceOf(MockModelAdapter);
    expect(model.status).toBe('ready');
  });
});

describe('createNativeServices and the model file', () => {
  it('loads the llama.rn adapter from the model file once it is verified', async () => {
    const modelManager = new FakeModelManager({ initial: 'absent', mode: 'manual', filePath: 'file:///models/Qwen3-1.7B-Q4_K_M.gguf' });
    const services = createNativeServices('android', { modelManager });
    expect(services.model).toBeInstanceOf(LlamaModelAdapter);
    expect(services.model.status).toBe('unloaded');
    void modelManager.startDownload();
    modelManager.complete();
    await settle();
    expect(services.model.status).toBe('ready');
    expect(fakeRuntime.initCalls[fakeRuntime.initCalls.length - 1]).toMatchObject({
      model: 'file:///models/Qwen3-1.7B-Q4_K_M.gguf',
      n_gpu_layers: 0,
      n_threads: 4,
    });
    await services.model.unload();
  });

  it('leaves an overridden model alone', async () => {
    const model = new MockModelAdapter({ status: 'unloaded' });
    const services = createNativeServices('ios', { model, modelManager: new FakeModelManager({ initial: 'ready' }) });
    await settle();
    expect(services.model).toBe(model);
    expect(model.status).toBe('unloaded');
  });
});
