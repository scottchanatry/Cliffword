/**
 * SHA-256 of a file on the device without loading it into memory (the model is 1.1 GB; expo-crypto
 * only digests in-memory data). Three ways, tried in order:
 *
 * 1. 'native-module': the cliffword-native module's sha256File (app/modules/cliffword-native):
 *    CryptoKit / MessageDigest streaming on a background queue, with progress events. The model
 *    hashes in about a second this way.
 * 2. 'file-digest': expo-file-system's File#digest('SHA-256'), also native and streaming, but
 *    without progress and on Expo's shared async queue. Used when the binary lacks the module
 *    (a build from before it existed) or the module call fails.
 * 3. 'js': the file read through a FileHandle in slices and fed to the TypeScript Sha256
 *    (./sha256.ts), with progress. Slow on Hermes; the last resort (and what Jest runs when
 *    neither native path is mocked).
 *
 * Only ExpoModelManager uses this; it is native-only (createModelManager.web.ts keeps it out of
 * the web bundle).
 */
import { toByteCount, toNumber } from './nativeNumber';
import { File, FileMode } from 'expo-file-system';
import CliffwordNative, { type CliffwordNativeModule } from '../../../modules/cliffword-native';
import { isSha256Hex, Sha256 } from './sha256';

export type HashMethod = 'native-module' | 'file-digest' | 'js';

/** Called with the bytes hashed so far and the file size. */
export type HashProgress = (bytesRead: number, totalBytes: number) => void;

export interface FileHashResult {
  /** Lower-case hex SHA-256. */
  sha256: string;
  method: HashMethod;
}

export interface FileHasher {
  /** Hashes the file at `uri` (a file:// URI). Rejects if the file is missing or unreadable. */
  sha256(uri: string, onProgress?: HashProgress, signal?: { readonly aborted: boolean }): Promise<FileHashResult>;
}

export interface FileHasherOptions {
  /** The native module; default the cliffword-native export (null when the binary lacks it). */
  native?: Pick<CliffwordNativeModule, 'sha256File' | 'addListener'> | null;
  /** Try File#digest('SHA-256') before the JS hash. Default true. */
  fileDigest?: boolean;
  /** Slice size for the JS hash. Default 1 MiB (each slice blocks the JS thread while hashed). */
  chunkBytes?: number;
}

export class HashAbortedError extends Error {
  constructor() {
    super('Hashing was stopped.');
    this.name = 'HashAbortedError';
  }
}

let jobs = 0;

export function createFileHasher(opts: FileHasherOptions = {}): FileHasher {
  const native = opts.native === undefined ? CliffwordNative : opts.native;
  const useFileDigest = opts.fileDigest ?? true;
  const chunkBytes = Math.max(64, opts.chunkBytes ?? 1 << 20);

  return {
    async sha256(uri, onProgress, signal) {
      const file = new File(uri);
      if (!file.exists) throw new Error(`No file to hash at ${uri}`);

      if (native) {
        const jobId = `sha256-${Date.now()}-${++jobs}`;
        const subscription = onProgress
          ? native.addListener('onHashProgress', (event) => {
              if (event.jobId === jobId) onProgress(toNumber(event.bytesRead), toNumber(event.totalBytes));
            })
          : null;
        try {
          const hex = (await native.sha256File(uri, jobId)).toLowerCase();
          if (isSha256Hex(hex)) return { sha256: hex, method: 'native-module' };
        } catch {
          // Fall through to the next way.
        } finally {
          subscription?.remove();
        }
      }

      if (signal?.aborted) throw new HashAbortedError();
      if (useFileDigest) {
        try {
          const hex = (await file.digest('SHA-256')).toLowerCase();
          if (isSha256Hex(hex)) {
            const size = toByteCount(file.size) ?? 0;
            onProgress?.(size, size);
            return { sha256: hex, method: 'file-digest' };
          }
        } catch {
          // Fall through to the JS hash.
        }
      }

      return { sha256: await hashInSlices(file, chunkBytes, onProgress, signal), method: 'js' };
    },
  };
}

async function hashInSlices(
  file: File,
  chunkBytes: number,
  onProgress: HashProgress | undefined,
  signal: { readonly aborted: boolean } | undefined,
): Promise<string> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const total = toByteCount(handle.size) ?? toByteCount(file.size) ?? 0;
    const hash = new Sha256();
    for (;;) {
      if (signal?.aborted) throw new HashAbortedError();
      const chunk = await handle.readBytes(chunkBytes);
      if (chunk.length === 0) break;
      hash.update(chunk);
      onProgress?.(hash.length, total);
    }
    return hash.hex();
  } finally {
    handle.close();
  }
}
