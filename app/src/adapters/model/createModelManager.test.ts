import { createNativeServices } from '../../services/nativeServices';
import { fakeFs } from '../../testing/fakeExpoFileSystem';
import { createModelManager } from './createModelManager';
import { DEFAULT_MODEL } from './descriptor';
import { ExpoModelManager } from './ExpoModelManager';
import { FakeModelManager } from './FakeModelManager';

// The web twin, loaded by its own path (Jest runs the iOS resolution, which picks createModelManager.ts).
const { createModelManager: createWebModelManager } =
  jest.requireActual<typeof import('./createModelManager.web')>('./createModelManager.web');

jest.mock('expo-file-system', () => jest.requireActual('../../testing/fakeExpoFileSystem'));

describe('createModelManager', () => {
  beforeEach(() => fakeFs.reset());

  it('builds the expo-file-system manager for DEFAULT_MODEL in <documents>/models', () => {
    const modelFiles = jest.fn(() => Promise.reject(new Error('not needed without files')));
    const manager = createModelManager({ platform: 'ios', modelFiles });
    expect(manager).toBeInstanceOf(ExpoModelManager);
    expect(manager.descriptor).toBe(DEFAULT_MODEL);
    expect(manager.filePath).toBe('/docs/models/Qwen3-1.7B-Q4_K_M.gguf');
    expect(manager.status()).toBe('absent');
    // Nothing on disk: storage is not even opened at startup.
    expect(modelFiles).not.toHaveBeenCalled();
  });

  it('is a FakeModelManager that is ready at once on the web', async () => {
    const manager = createWebModelManager({ platform: 'ios', modelFiles: () => Promise.reject(new Error('unused')) });
    expect(manager).toBeInstanceOf(FakeModelManager);
    expect(manager.status()).toBe('ready');
    await expect(manager.startDownload()).resolves.toBe('ready');
  });

  it('is what createNativeServices uses, with the container storage behind model_files', async () => {
    for (const platform of ['ios', 'android'] as const) {
      const services = createNativeServices(platform);
      expect(services.modelManager).toBeInstanceOf(ExpoModelManager);
      expect(services.modelManager.status()).toBe('absent');
      // The llama.rn adapter waits for the file.
      expect(services.model.status).toBe('unloaded');
    }
  });
});
