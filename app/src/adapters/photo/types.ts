/**
 * PhotoPicker: the learner's own photo for their picture in the story (the "You" bubbles and the
 * header button). The learner takes a selfie or chooses a photo; the adapter asks for the
 * permission that needs (the camera only: the system photo picker shows the learner's photos
 * without giving the app access to the library), opens the system UI with a square crop, and
 * keeps one copy in the app's own storage (<documents>/avatar/<time>.<ext>), left out of device
 * backups. Nothing is uploaded.
 *
 * Implementations:
 * - ExpoPhotoPicker (iOS, Android): expo-image-picker and expo-file-system, through
 *   createNativePhotoPicker.ts (web twin: createNativePhotoPicker.web.ts).
 * - UnavailablePhotoPicker (web preview): no sources; the chooser offers the characters only.
 * - FakePhotoPicker (tests): scripted outcomes and an in-memory set of stored files.
 */

/** Where a photo comes from: the front camera ("Take a selfie") or the photo library. */
export type PhotoSource = 'camera' | 'library';

export type PhotoResult =
  /** A copy is stored in the app's documents; `uri` is the stored file. */
  | { kind: 'picked'; uri: string }
  /** The learner closed the camera or the picker without a photo. */
  | { kind: 'cancelled' }
  /** The permission the source needs was refused (Settings can turn it on). */
  | { kind: 'denied'; source: PhotoSource }
  /** This device offers no such source (the web preview). */
  | { kind: 'unavailable'; source: PhotoSource }
  /** Anything else failed (no camera, the copy could not be written); `message` is for logs. */
  | { kind: 'error'; source: PhotoSource; message: string };

/**
 * A photo taken or chosen while Android had closed the app (the camera or the photo picker was
 * in front and the system needed the memory): stored like a pick, or why it could not be.
 */
export type RecoveredPhoto = { kind: 'picked'; uri: string } | { kind: 'error'; message: string };

export interface PhotoPicker {
  /**
   * The sources this device offers, in the order the chooser shows them (empty on the web; no
   * camera where the selfie cannot work: Android 9 and older, the iOS Simulator).
   */
  readonly sources: readonly PhotoSource[];
  /**
   * Asks for the permission the source needs (only now, when the learner tapped it), opens the
   * system UI with a square crop, and stores a copy of the photo. Never rejects.
   */
  pick(source: PhotoSource): Promise<PhotoResult>;
  /**
   * The stored photo's uri as it is now, or null when its file is gone (a restore or a reinstall:
   * photos are left out of backups). The app's documents folder can move between installs and
   * updates on iOS, so a photo stored under an earlier folder is found by its name in the current
   * one. Never rejects.
   */
  locate(uri: string): Promise<string | null>;
  /**
   * Deletes a stored photo (and any copy the system picker left in the app's cache). Only files
   * in the app's photo folder and the picker's own cache folder are touched. Never rejects.
   */
  remove(uri: string): Promise<void>;
  /**
   * At startup: the photo of a pick that Android interrupted by closing the app, stored like a
   * pick (null when there is none, always on iOS and the web). Never rejects.
   */
  recover(): Promise<RecoveredPhoto | null>;
}
