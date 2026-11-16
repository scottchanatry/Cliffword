/**
 * What the app says about itself: the version from app.json with the native build number
 * (Settings, About) and the platform with its OS version ("Report this sentence").
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** The app version from app.json and the native build number (null in development and on web). */
export function appVersion(): { version: string; build: string | null } {
  const version = Constants.expoConfig?.version ?? '';
  const ios = Constants.platform?.ios?.buildNumber;
  const android = Constants.platform?.android?.versionCode;
  const build = ios ? String(ios) : typeof android === 'number' && android > 0 ? String(android) : null;
  return { version, build };
}

/** "ios 18.2", "android 35", "web": the platform and its OS version, for reports. */
export function platformLabel(): string {
  const version = Platform.OS === 'web' ? '' : String(Platform.Version ?? '');
  return version ? `${Platform.OS} ${version}` : Platform.OS;
}
