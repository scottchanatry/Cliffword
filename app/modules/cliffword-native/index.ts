/**
 * Cliffword's local Expo module (app/modules/cliffword-native, autolinked from ./modules):
 * native helpers for the model download that expo-file-system does not have.
 *
 * - sha256File(uri, jobId): streaming SHA-256 of a file (CryptoKit on iOS, MessageDigest on
 *   Android), off Expo's shared async queue, with "onHashProgress" events tagged with jobId.
 * - excludeFromBackup(uri): iOS sets isExcludedFromBackup and resolves true; Android resolves
 *   false (backup rules cover it there).
 * - availableBytes(): iOS only, free space for important use (counts purgeable space), -1 if
 *   unknown. Android has no such function; use Paths.availableDiskSpace.
 *
 * The export is null when the binary lacks the module (a build from before it existed) and in
 * Jest; callers fall back (see src/adapters/model/fileHash.ts). On web, index.web.ts exports null.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface HashProgressEvent {
  jobId: string;
  bytesRead: number;
  /** File size in bytes, or -1 if it could not be read. */
  totalBytes: number;
}

export type CliffwordNativeEvents = {
  onHashProgress: (event: HashProgressEvent) => void;
};

export declare class CliffwordNativeModule extends NativeModule<CliffwordNativeEvents> {
  sha256File(uri: string, jobId: string): Promise<string>;
  excludeFromBackup(uri: string): Promise<boolean>;
  /** iOS only. */
  availableBytes?: () => Promise<number>;
}

const CliffwordNative: CliffwordNativeModule | null = requireOptionalNativeModule<CliffwordNativeModule>('CliffwordNative');

export default CliffwordNative;
