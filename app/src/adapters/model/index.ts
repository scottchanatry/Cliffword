export type {
  DownloadProgress,
  ModelAdapter,
  ModelBackend,
  ModelDescriptor,
  ModelFileCheckDetail,
  ModelFileErrorCode,
  ModelFileState,
  ModelFileStatus,
  ModelInfo,
  ModelLoadOptions,
  ModelManager,
  ModelScoringPath,
  ModelStatus,
} from './types';
export { ModelNotReadyError } from './types';
export { DEFAULT_MODEL, FREE_SPACE_MARGIN_BYTES, QWEN3_1_7B_Q4_K_M } from './descriptor';
export { MOCK_CONTEXT_SIZE, MockModelAdapter } from './MockModelAdapter';
export type { MockModelAdapterOptions } from './MockModelAdapter';
export { FakeModelManager } from './FakeModelManager';
export type { FakeModelManagerOptions } from './FakeModelManager';
export { keepModelLoaded, modelAvailability } from './keepModelLoaded';
export type { KeepModelLoadedOptions, ModelAutoLoader, ModelAvailability } from './keepModelLoaded';
// LlamaModelAdapter is reached through createDeviceModel (native only, with a .web.ts twin); it
// is not exported here, so the barrel stays free of it.
export {
  formatBytes,
  MODEL_DOWNLOAD_NOTES,
  MODEL_FILE_ACTIONS,
  modelFileDetailMessage,
  modelFileErrorMessage,
  modelFileMessage,
  modelProgressMessage,
} from './modelFileMessages';
export type { ModelFileMessage, Translate as ModelFileTranslate } from './modelFileMessages';
export { isSha256Hex, Sha256, sha256Hex } from './sha256';
// ExpoModelManager (expo-file-system, expo-keep-awake, the cliffword-native module) is reached
// through createModelManager (native only, with a .web.ts twin); it is not exported here either.
