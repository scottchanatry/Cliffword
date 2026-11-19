/**
 * The language model on the device, and the file it runs from.
 *
 * ModelAdapter is the engine's LanguageModel (scoreContinuation, nextTokens, generate; see
 * ../engine/src/model/types.ts for the token and spacing conventions) plus a lifecycle: load a
 * model file, unload it, report status and what is loaded. Implementations:
 * - MockModelAdapter (now): the engine's deterministic n-gram mock. Used on web, in tests, and
 *   on a device while the real model downloads.
 * - LlamaModelAdapter: Qwen3-1.7B Q4_K_M from ModelManager's file, through llama.rn. Text scoring
 *   uses the native method that app/patches/llama.rn+0.13.0-rc.11.patch adds (exact
 *   log-probabilities, the same numbers as proof/model_server.py); without it, forced decoding
 *   through the completion API, where tokens outside the top N carry `upperBound: true`.
 *   ModelInfo.scoring says which path runs. See ./README.md.
 *
 * ModelManager owns the model file: download, checksum, delete. It never loads the model.
 */
import type { LanguageModel } from '@cliffword/engine';
import type { Unsubscribe } from '../listeners';

/** Where an adapter is in its lifecycle. Only 'ready' accepts model calls. */
export type ModelStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/** What runs the model. */
export type ModelBackend = 'mock' | 'llama.rn' | 'http';

/**
 * How scoreContinuation gets its numbers:
 * - 'exact': every token's log-probability (the mock, the HTTP model);
 * - 'native': exact, from the llama.rn patch's native scoring method;
 * - 'forced-decoding': llama.rn's top-N lists; tokens outside the top N are upper bounds
 *   (`upperBound: true`).
 */
export type ModelScoringPath = 'exact' | 'native' | 'forced-decoding';

export interface ModelInfo {
  /** Same as LanguageModel.id, e.g. 'qwen3-1.7b-q4_k_m' or 'mock-ngram-es'. */
  id: string;
  /** Context window in tokens that the loaded model was set up with. */
  contextSize: number;
  backend: ModelBackend;
  /** How scores are computed. Absent means 'exact'. */
  scoring?: ModelScoringPath;
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
  /**
   * With error 'insufficient-storage': the free space measured and the space the download needs
   * (the bytes still to fetch plus a safety margin), for the error text.
   */
  space?: { freeBytes: number; neededBytes: number };
  /** While 'verifying': the share of the file hashed so far, 0 to 1, when the hasher reports it. */
  verifyFraction?: number;
  /** With error 'size-mismatch' or 'checksum-mismatch': what the check saw, for a one-line diagnostic. */
  detail?: ModelFileCheckDetail;
}

/**
 * What a rejected size or checksum check saw (shown in small print under the error and logged):
 * - check: 'early' (the transfer was stopped because the server kept announcing another length),
 *   'final' (the size of the finished file), 'checksum' (its SHA-256), 'startup' (the model file
 *   found when the app started).
 */
export interface ModelFileCheckDetail {
  check: 'early' | 'final' | 'checksum' | 'startup';
  /** The descriptor's size. */
  expectedBytes: number;
  /** The size read from the file, or null when it could not be read (or there was no file). */
  actualBytes: number | null;
  /** The last totalBytes the transfer reported, or null when it reported none. */
  reportedTotalBytes: number | null;
  /** The last bytesWritten the transfer reported (0 when none). */
  bytesWrittenAtFail: number;
  /** Seconds from the start of the transfer to the check, or null when no transfer ran. */
  seconds: number | null;
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
  /**
   * Free bytes on the volume the model goes to, or null when unknown. Optional: onboarding and
   * settings show it before the download when the manager can measure it.
   */
  freeBytes?(): Promise<number | null>;
}
