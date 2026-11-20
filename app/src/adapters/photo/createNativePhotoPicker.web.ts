/**
 * Web twin of createNativePhotoPicker.ts: the preview offers no photo (its storage is in memory),
 * so expo-image-picker and expo-file-system stay out of the web bundle.
 */
import type { Clock } from '../clock/types';
import type { PhotoPicker } from './types';
import { UnavailablePhotoPicker } from './UnavailablePhotoPicker';

export function createNativePhotoPicker(_clock?: Clock): PhotoPicker {
  return new UnavailablePhotoPicker();
}
