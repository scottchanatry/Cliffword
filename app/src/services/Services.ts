/**
 * createServices(platform, overrides?) builds the service container for the platform the app
 * runs on:
 * - 'ios' / 'android': createNativeServices (nativeServices.ts lists the stand-ins).
 * - 'web': createWebServices.
 * Tests build theirs with createTestServices (testServices.ts, test-only, never imported here).
 * Overrides replace single services; the rest are built (and share the override clock, if any).
 */
import { Platform } from 'react-native';
import { createNativeServices } from './nativeServices';
import type { AppPlatform, ServiceOverrides, Services } from './types';
import { createWebServices } from './webServices';

export function createServices(platform: AppPlatform, overrides: ServiceOverrides = {}): Services {
  switch (platform) {
    case 'web':
      return createWebServices(overrides);
    case 'ios':
    case 'android':
      return createNativeServices(platform, overrides);
  }
}

/** The platform the app runs on: Platform.OS, with anything other than iOS or Android as web. */
export function currentPlatform(os: string = Platform.OS): AppPlatform {
  return os === 'ios' || os === 'android' ? os : 'web';
}
