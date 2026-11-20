export type { PhotoPicker, PhotoResult, PhotoSource } from './types';
export { FakePhotoPicker } from './FakePhotoPicker';
export type { FakePhotoOutcome, FakePhotoPickerOptions } from './FakePhotoPicker';
export { UnavailablePhotoPicker } from './UnavailablePhotoPicker';
// ExpoPhotoPicker and createNativePhotoPicker stay out of this barrel: expo-image-picker and
// expo-file-system must not reach the web bundle (createNativePhotoPicker.web.ts is the twin).
