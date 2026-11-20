import type { PhotoPicker, PhotoResult, PhotoSource } from './types';

/**
 * The web preview's PhotoPicker: no camera or library (its storage is in memory and could not keep
 * a photo anyway), so the chooser shows the characters only. A stored photo is never found.
 */
export class UnavailablePhotoPicker implements PhotoPicker {
  readonly sources: readonly PhotoSource[] = [];

  async pick(source: PhotoSource): Promise<PhotoResult> {
    return { kind: 'unavailable', source };
  }

  async locate(_uri: string): Promise<string | null> {
    return null;
  }

  async remove(_uri: string): Promise<void> {}
}
