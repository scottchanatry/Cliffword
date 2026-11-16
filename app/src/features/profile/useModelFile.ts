/**
 * The model file and the loaded model, for onboarding's model step and the settings model card:
 * the ModelManager snapshot and the adapter status (both followed live), what the UI should say
 * (modelAvailability), the free space when the manager can measure it, and the actions. The
 * download keeps running when the screen goes away; nothing here cancels it on unmount.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ModelAvailability } from '../../adapters/model/keepModelLoaded';
import { modelAvailability } from '../../adapters/model/keepModelLoaded';
import type { ModelDescriptor, ModelFileState, ModelStatus } from '../../adapters/model/types';
import { useServices } from '../../services/ServicesProvider';

export interface ModelFileView {
  file: ModelFileState;
  modelStatus: ModelStatus;
  availability: ModelAvailability;
  descriptor: ModelDescriptor;
  /** Free bytes on the phone, or null when unknown. */
  freeBytes: number | null;
  /** Start or resume the download (then the check). */
  start: () => void;
  /** Pause the download (a partial file is kept to resume). */
  pause: () => void;
  /** Delete the model file (the app goes back to canned mode). */
  remove: () => Promise<void>;
}

export function useModelFile(): ModelFileView {
  const { modelManager, model } = useServices();
  const subscribeFile = useCallback((listener: () => void) => modelManager.onChange(listener), [modelManager]);
  const file = useSyncExternalStore(subscribeFile, () => modelManager.snapshot(), () => modelManager.snapshot());
  const subscribeModel = useCallback((listener: () => void) => model.onStatusChange(listener), [model]);
  const modelStatus = useSyncExternalStore(subscribeModel, () => model.status, () => model.status);

  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const measure = modelManager.freeBytes?.bind(modelManager);
    if (!measure) return;
    measure().then(
      (bytes) => {
        if (live) setFreeBytes(bytes);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // Measured again whenever the file changes state (a download or a delete moves the figure).
  }, [modelManager, file.status]);

  const start = useCallback(() => {
    void modelManager.startDownload().catch((e: unknown) => console.warn('[model] download failed', e));
  }, [modelManager]);
  const pause = useCallback(() => {
    void modelManager.cancel().catch((e: unknown) => console.warn('[model] pause failed', e));
  }, [modelManager]);
  const remove = useCallback(() => modelManager.delete(), [modelManager]);

  return {
    file,
    modelStatus,
    availability: modelAvailability(file, modelStatus),
    descriptor: modelManager.descriptor,
    freeBytes,
    start,
    pause,
    remove,
  };
}
