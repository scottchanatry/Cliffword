/**
 * Ties the model adapter to the model file: load it once ModelManager has the file verified,
 * unload it when the file goes away. createNativeServices starts one for the llama.rn adapter.
 *
 * - file 'ready' (on start or on a change) while the model is 'unloaded': load(filePath).
 * - file anything else (absent, downloading, verifying, error) while the model is loaded or
 *   loading: unload().
 * - a failed load leaves the model in 'error' (lastError says why) and is not retried on its
 *   own; retry() tries again, and so does the next time the file becomes 'ready'.
 *
 * modelAvailability() folds the file state and the model status into what the UI shows,
 * including 'missing' when there is no model file yet.
 */
import type { Unsubscribe } from '../listeners';
import type { ModelAdapter, ModelFileState, ModelLoadOptions, ModelManager, ModelStatus } from './types';

export interface ModelAutoLoader {
  /** Load again after a failure (or now, if the file is ready and the model is not loaded). */
  retry(): Promise<void>;
  /** Stop following the file. Does not unload the model. */
  stop: Unsubscribe;
}

export interface KeepModelLoadedOptions {
  loadOptions?: ModelLoadOptions;
}

export function keepModelLoaded(model: ModelAdapter, manager: ModelManager, opts: KeepModelLoadedOptions = {}): ModelAutoLoader {
  let wasReady = false;
  let stopped = false;

  const load = (): Promise<void> => {
    // The adapter records the failure (status 'error', lastError); nothing to rethrow here.
    return model.load(manager.filePath, opts.loadOptions).catch(() => {});
  };

  const sync = (state: ModelFileState): void => {
    if (stopped) return;
    const ready = state.status === 'ready';
    if (ready && !wasReady && (model.status === 'unloaded' || model.status === 'error')) {
      void load();
    } else if (!ready && (model.status === 'ready' || model.status === 'loading')) {
      void model.unload();
    }
    wasReady = ready;
  };

  const unsubscribe = manager.onChange(sync);
  sync(manager.snapshot());

  return {
    retry: () => {
      if (stopped || manager.status() !== 'ready') return Promise.resolve();
      if (model.status === 'ready' || model.status === 'loading') return Promise.resolve();
      return load();
    },
    stop: () => {
      stopped = true;
      unsubscribe();
    },
  };
}

/**
 * What the UI should say about the model:
 * - 'missing': no model file (not downloaded yet, or deleted);
 * - 'downloading' / 'verifying': the file is on its way;
 * - 'download-failed': the download or its checks failed (ModelFileState.error says why);
 * - 'loading': the file is there and the model is being loaded (or about to be);
 * - 'ready': model calls work;
 * - 'load-failed': the file is there but could not be loaded (ModelAdapter.lastError).
 */
export type ModelAvailability = 'missing' | 'downloading' | 'verifying' | 'download-failed' | 'loading' | 'ready' | 'load-failed';

export function modelAvailability(file: Pick<ModelFileState, 'status'>, model: ModelStatus): ModelAvailability {
  switch (file.status) {
    case 'absent':
      return 'missing';
    case 'downloading':
      return 'downloading';
    case 'verifying':
      return 'verifying';
    case 'error':
      return 'download-failed';
    case 'ready':
      if (model === 'ready') return 'ready';
      if (model === 'error') return 'load-failed';
      return 'loading';
  }
}
