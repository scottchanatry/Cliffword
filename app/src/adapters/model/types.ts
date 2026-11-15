/**
 * The language model on the device, and the file it runs from.
 *
 * ModelAdapter is the engine's LanguageModel (scoreContinuation, nextTokens, generate; see
 * ../engine/src/model/types.ts for the token and spacing conventions) plus a lifecycle: load a
 * model file, unload it, report status and what is loaded. Implementations:
 * - MockModelAdapter (now): the engine's deterministic n-gram mock. Used on web, in tests, and
 *   on a device while the real model downloads.
 * - A llama.rn adapter (later stage): Qwen3-1.7B Q4_K_M from ModelManager's file. Scoring a
 *   supplied text needs forced decoding or a small native method (docs/BRIEF.md, "Not done
 *   yet"); tokens outside the runtime's top N carry `upperBound: true`.
 *
 * ModelManager owns the model file: download, checksum, delete. It never loads the model.
 */
import type { LanguageModel } from '@cliffword/engine';
import type { Unsubscribe } from '../listeners';

/** Where an adapter is in its lifecycle. Only 'ready' accepts model calls. */
export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/** What runs the model. */
export type ModelBackend = 'mock' | 'llama.rn' | 'http';

export interface ModelInfo {
  /** Same as LanguageModel.id, e.g. 'qwen3-1.7b-q4_k_m' or 'mock-ngram-es'. */
  id: string;
  /** Context window in tokens that the loaded model was set up with. */
  contextSize: number;
  backend: ModelBackend;
}

export interface ModelLoadOptions {
  /** Context window in tokens. Adapter default when omitted. */
  contextSize?: number;
  /** CPU threads. Adapter default when omitted. */
  threads?: number;
  /** Layers to offload to the GPU (Metal on iOS). 0 = CPU only. Adapter default when omitted. */
  gpuLayers?: number;
}

/** Thrown (as a rejected promise) by model calls when the adapter is not 'ready'. */
export class ModelNotReadyError extends Error {
  readonly status: ModelStatus;

  constructor(status: ModelStatus) {
    super(`The language model is not ready (status: ${status}).`);
    this.name = 'ModelNotReadyError';
    this.status = status;
  }
}

export interface ModelAdapter extends LanguageModel {
  /** Current lifecycle status. */
  readonly status: ModelStatus;
  /** What is loaded (or, while unloaded, what would be). */
  readonly info: ModelInfo;
  /** The error that put the adapter in 'error', else null. */
  readonly lastError: Error | null;
  /**
   * Loads the model file at `modelPath` (from ModelManager.filePath). Resolves when 'ready';
   * rejects and moves to 'error' when the file cannot be loaded. Loading while loaded
   * replaces the loaded model.
   */
  load(modelPath: string, opts?: ModelLoadOptions): Promise<void>;
  /** Frees the model. Model calls reject with ModelNotReadyError until the next load. */
  unload(): Promise<void>;
  /** Called with the new status on every change. */
  onStatusChange(listener: (status: ModelStatus) => void): Unsubscribe;
}

/** A model file the app can download. */
export interface ModelDescriptor {
  /** Model id, also ModelInfo.id once loaded. */
  id: string;
  /** HTTPS download URL (a Hugging Face resolve URL pinned to a commit). */
  url: string;
  /** File name on the device. */
  fileName: string;
  /** Exact size in bytes. */
  bytes: number;
  /** Lower-case hex SHA-256 of the whole file. */
  sha256: string;
}

/** The state of the model file on the device. */
export type ModelFileStatus = 'absent' | 'downloading' | 'verifying' | 'ready' | 'error';

/** Why the last download or verification failed. */
export type ModelFileErrorCode =
  | 'network'
  | 'insufficient-storage'
  | 'checksum-mismatch'
  | 'size-mismatch'
  | 'unknown';

export interface DownloadProgress {
  bytesWritten: number;
  bytesTotal: number;
  /** bytesWritten / bytesTotal, 0 to 1. */
  fraction: number;
}

/** An immutable snapshot; a new object on every change (usable with useSyncExternalStore). */
export interface ModelFileState {
  status: ModelFileStatus;
  progress: DownloadProgress;
  /** Set when status is 'error'. */
  error: ModelFileErrorCode | null;
}

export interface ModelManager {
  readonly descriptor: ModelDescriptor;
  /** Absolute path (or URI) where the model file lives once 'ready'. */
  readonly filePath: string;
  status(): ModelFileStatus;
  progress(): DownloadProgress;
  /** The current snapshot. The same object until something changes. */
  snapshot(): ModelFileState;
  /**
   * Starts (or resumes) the download, then verifies size and SHA-256. Resolves with the status
   * it ends in: 'ready', 'error', or 'absent' after cancel(). Calling it while a download runs
   * returns the same promise. Calling it when 'ready' resolves 'ready' at once.
   */
  startDownload(): Promise<ModelFileStatus>;
  /** Stops a running download; status goes back to 'absent'. A partial file may be kept to resume. */
  cancel(): Promise<void>;
  /** Removes the file (and any partial download); status goes to 'absent'. */
  delete(): Promise<void>;
  /** Called with the new snapshot on every change. */
  onChange(listener: (state: ModelFileState) => void): Unsubscribe;
}
