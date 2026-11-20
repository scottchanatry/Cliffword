/**
 * The device's PhotoPicker: ExpoPhotoPicker over expo-image-picker. expo-image-picker is imported
 * here alone, and Metro picks createNativePhotoPicker.web.ts for the web bundle, which keeps it,
 * the photo file code and the cliffword-native module out of it (__tests__/importGraph.test.ts).
 */
import * as ImagePicker from 'expo-image-picker';
import type { Clock } from '../clock/types';
import { ExpoPhotoPicker } from './ExpoPhotoPicker';
import type { PhotoPicker } from './types';

export function createNativePhotoPicker(clock?: Clock): PhotoPicker {
  return new ExpoPhotoPicker({ picker: ImagePicker, clock });
}
