/**
 * The real PhotoPicker for iOS and Android: expo-image-picker opens the front camera or the system
 * photo picker with a square crop, and expo-file-system 58 keeps one copy of the result in
 * <documents>/avatar/ (the document directory, which the OS never purges).
 *
 * - Permission: the camera asks for its permission when the learner taps "Take a selfie", and
 *   not before. The photo library asks for none: with images only and a crop, iOS shows the
 *   out-of-process picker and Android the system photo picker, which give the app only the
 *   photo the learner chose (so READ_MEDIA_IMAGES and the storage permissions stay blocked in
 *   app.json). A camera launch that still fails on a permission reads as 'denied'; a library
 *   failure is always an 'error' (there is no Photos setting for Cliffword to send anyone to).
 * - Sources (photoSources): no camera on Android 9 and older, where expo-image-picker's camera
 *   also needs WRITE_EXTERNAL_STORAGE, which app.json blocks (Android would refuse it without a
 *   dialog, every time), nor where the cliffword-native module says there is no camera (the iOS
 *   Simulator, where UIKit's camera picker raises an exception the app cannot catch).
 * - The copy: <documents>/avatar/<clock time>.<jpg|png|heic|webp>. Its size is read back through
 *   toByteCount (iOS passes Swift Int64 sizes as BigInt, see ../model/nativeNumber.ts) and an
 *   empty or unreadable copy is an error. The folder is kept out of iCloud and device backups on
 *   iOS (the cliffword-native module); on Android the module's config plugin excludes
 *   files/avatar/ from Auto Backup and transfer.
 * - The picker's own copies: expo-image-picker writes every result into <cache>/ImagePicker/ (on
 *   Android with a crop, two: the crop, with the original's EXIF, GPS included, and the exported
 *   result). After every pick, whatever its outcome, and on remove(), that folder is deleted, so
 *   the stored copy is the only one the app keeps.
 * - Android can close the app while the camera or the photo picker is in front (low memory: the
 *   language model stays loaded). expo-image-picker then keeps the result for
 *   getPendingResultAsync; recover() stores it like a pick (bootstrap calls it at startup).
 * - expo-image-picker is passed in (createNativePhotoPicker.ts imports it), so this file and its
 *   tests need only its types.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { ImagePickerErrorResult, ImagePickerOptions, ImagePickerResult, PermissionResponse } from 'expo-image-picker';
import { Platform } from 'react-native';
import CliffwordNative from '../../../modules/cliffword-native';
import { systemClock } from '../clock/systemClock';
import type { Clock } from '../clock/types';
import { toByteCount } from '../model/nativeNumber';
import type { PhotoPicker, PhotoResult, PhotoSource, RecoveredPhoto } from './types';

/** The folder in the document directory that holds the learner's photo. */
export const PHOTO_FOLDER = 'avatar';

/** expo-image-picker's working folder in the cache directory (both platforms; nothing else uses it). */
export const PICKER_CACHE_FOLDER = 'ImagePicker';

/** The first Android API level (10, Q) on which expo-image-picker's camera needs only CAMERA. */
export const CAMERA_MIN_ANDROID_API = 29;

/** JPEG quality of the camera and library results (a picture shown at most about 120 pt wide). */
export const PHOTO_QUALITY = 0.7;

/** The part of expo-image-picker this adapter uses. */
export interface ImagePickerModule {
  requestCameraPermissionsAsync(): Promise<PermissionResponse>;
  launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  /** Android: the result of a pick the system interrupted by closing the app; null elsewhere. */
  getPendingResultAsync?(): Promise<ImagePickerResult | ImagePickerErrorResult | null>;
}

/** What decides which sources work: the platform, its version and whether there is a camera. */
export interface PhotoDevice {
  os: string;
  /** Platform.Version: the API level on Android, the OS version string on iOS. */
  version: number | string;
  /** False where the device has no camera (the cliffword-native module on iOS); unknown: undefined. */
  hasCamera?: boolean;
}

/** The sources a device can use, in the chooser's order. */
export function photoSources(device: PhotoDevice): PhotoSource[] {
  if (device.hasCamera === false) return ['library'];
  if (device.os === 'android' && Number(device.version) < CAMERA_MIN_ANDROID_API) return ['library'];
  return ['camera', 'library'];
}

function currentDevice(): PhotoDevice {
  return { os: Platform.OS, version: Platform.Version, hasCamera: CliffwordNative?.hasCamera };
}

export interface ExpoPhotoPickerOptions {
  picker: ImagePickerModule;
  /** Names the stored files. Default systemClock. */
  clock?: Clock;
  /** Keeps a folder out of backups. Default: the cliffword-native module (iOS); a no-op without it. */
  excludeFromBackup?: (uri: string) => Promise<unknown>;
  /** The photo folder. Default <documents>/avatar. */
  directory?: () => Directory;
  /** expo-image-picker's working folder. Default <cache>/ImagePicker. */
  pickerCache?: () => Directory;
  /** Default: Platform and the cliffword-native module. */
  device?: PhotoDevice;
}

/** Square crop and the same quality for both sources; images only (no video, so no microphone). */
const COMMON: ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: PHOTO_QUALITY,
  exif: false,
  base64: false,
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
};
const KNOWN_EXTENSION = /\.(jpe?g|png|heic|webp)$/i;
/** A stored photo's file name: what keep() writes. */
const PHOTO_NAME = /^[0-9]{1,16}(-[0-9]{1,3})?\.(jpg|png|heic|webp)$/;

/** The file extension to store a picked image under. */
export function photoExtension(uri: string, mimeType?: string | null): string {
  const byMime = mimeType ? EXTENSIONS[mimeType.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const match = KNOWN_EXTENSION.exec(uri.split(/[?#]/)[0] ?? '');
  const ext = match?.[1]?.toLowerCase();
  return ext === 'jpeg' ? 'jpg' : (ext ?? 'jpg');
}

/** The file name of a uri (its last path segment), or null. */
function nameOf(uri: string): string | null {
  const name = uri.split(/[?#]/)[0]?.replace(/\/+$/, '').split('/').pop();
  return name ? decodeURIComponentSafe(name) : null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A permission failure reported by a camera launch (iOS: MissingCameraPermissionException;
 * Android: UserRejectedPermissionsException, read by its message).
 */
function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return (typeof code === 'string' && /PERMISSION/i.test(code)) || /permission/i.test(message);
}

async function defaultExcludeFromBackup(uri: string): Promise<unknown> {
  return CliffwordNative?.excludeFromBackup(uri);
}

export class ExpoPhotoPicker implements PhotoPicker {
  readonly sources: readonly PhotoSource[];

  private readonly picker: ImagePickerModule;
  private readonly clock: Clock;
  private readonly excludeFromBackup: (uri: string) => Promise<unknown>;
  private readonly directory: () => Directory;
  private readonly pickerCache: () => Directory;

  constructor(opts: ExpoPhotoPickerOptions) {
    this.picker = opts.picker;
    this.clock = opts.clock ?? systemClock;
    this.excludeFromBackup = opts.excludeFromBackup ?? defaultExcludeFromBackup;
    this.directory = opts.directory ?? (() => new Directory(Paths.document, PHOTO_FOLDER));
    this.pickerCache = opts.pickerCache ?? (() => new Directory(Paths.cache, PICKER_CACHE_FOLDER));
    this.sources = photoSources(opts.device ?? currentDevice());
  }

  async pick(source: PhotoSource): Promise<PhotoResult> {
    if (!this.sources.includes(source)) return { kind: 'unavailable', source };
    let picked: string | undefined;
    try {
      let result: ImagePickerResult;
      try {
        if (source === 'camera') {
          const permission = await this.picker.requestCameraPermissionsAsync();
          if (!permission.granted) return { kind: 'denied', source };
          // 'front' is CameraType.front; the enum is a string enum, so the value needs no import.
          result = await this.picker.launchCameraAsync({ ...COMMON, cameraType: 'front' as ImagePickerOptions['cameraType'] });
        } else {
          result = await this.picker.launchImageLibraryAsync(COMMON);
        }
      } catch (error) {
        if (source === 'camera' && isPermissionError(error)) return { kind: 'denied', source };
        return { kind: 'error', source, message: messageOf(error) };
      }
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) return { kind: 'cancelled' };
      picked = asset.uri;
      try {
        return { kind: 'picked', uri: await this.keep(asset.uri, asset.mimeType) };
      } catch (error) {
        return { kind: 'error', source, message: messageOf(error) };
      }
    } finally {
      this.discard(picked);
    }
  }

  async recover(): Promise<RecoveredPhoto | null> {
    let picked: string | undefined;
    try {
      const pending = await this.picker.getPendingResultAsync?.();
      if (!pending) return null;
      if (!('canceled' in pending)) return { kind: 'error', message: pending.message };
      const asset = pending.canceled ? undefined : pending.assets?.[0];
      if (!asset) return null;
      picked = asset.uri;
      return { kind: 'picked', uri: await this.keep(asset.uri, asset.mimeType) };
    } catch (error) {
      return { kind: 'error', message: messageOf(error) };
    } finally {
      // Also what an interrupted pick left behind (the camera's file, an export).
      this.discard(picked);
    }
  }

  async locate(uri: string): Promise<string | null> {
    try {
      const file = this.stored(uri);
      if (!file) return null;
      if (file.exists) return file.uri;
      return null;
    } catch {
      return null;
    }
  }

  async remove(uri: string): Promise<void> {
    try {
      const file = this.stored(uri);
      if (file?.exists) file.delete();
    } catch {
      // Best effort: a file that cannot be deleted now is replaced by name next time.
    }
    this.discard(undefined);
  }

  /**
   * Deletes the picker's copies: its working folder in the cache, and the result itself when it
   * lies elsewhere in the cache. Never throws.
   */
  private discard(pickedUri: string | undefined): void {
    try {
      if (pickedUri?.startsWith(Paths.cache.uri)) {
        const file = new File(pickedUri);
        if (file.exists) file.delete();
      }
    } catch {
      // The folder below, or the system's own cache cleanup, takes it.
    }
    try {
      const folder = this.pickerCache();
      if (folder.exists) folder.delete();
    } catch {
      // The system clears its cache by itself.
    }
  }

  /**
   * The file a stored uri names, in the current photo folder: only names keep() writes count, so
   * a damaged setting can never point this adapter at another file. iOS can move the app's
   * documents folder between installs and updates, which changes every absolute uri.
   */
  private stored(uri: string): File | null {
    const name = nameOf(uri);
    if (!name || !PHOTO_NAME.test(name)) return null;
    return new File(this.directory(), name);
  }

  /** Copies the picked image into the photo folder and returns the stored file's uri. */
  private async keep(sourceUri: string, mimeType?: string | null): Promise<string> {
    const dir = this.directory();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const ext = photoExtension(sourceUri, mimeType);
    const base = String(Math.max(0, Math.floor(this.clock.now())));
    let target = new File(dir, `${base}.${ext}`);
    for (let n = 1; target.exists && n < 1000; n++) target = new File(dir, `${base}-${n}.${ext}`);
    await new File(sourceUri).copy(target);
    const bytes = toByteCount(new File(target.uri).size);
    if (!bytes) {
      try {
        if (target.exists) target.delete();
      } catch {
        // Nothing more to do; the setting is not changed.
      }
      throw new Error(`The photo copy is empty or unreadable (${String(bytes)} bytes)`);
    }
    // The folder and the file, as ExpoModelManager does for the model.
    await this.excludeFromBackup(dir.uri).catch(() => undefined);
    await this.excludeFromBackup(target.uri).catch(() => undefined);
    return target.uri;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
