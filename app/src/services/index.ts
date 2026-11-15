/**
 * The service container for app code. Test-only pieces are not exported here (so they stay
 * out of the app bundles): import createTestServices from './testServices' in tests.
 */
export { createServices, currentPlatform } from './Services';
export { createNativeServices } from './nativeServices';
export { createWebServices } from './webServices';
export { getAppServices, setAppServices } from './appServices';
export { createStorageService, storageClockFor } from './storageService';
export type { AppPlatform, ServiceOverrides, ServicePacks, Services, ServicesPlatform, StorageService } from './types';
export { defaultPacks, sharedMockModel } from './defaults';
export { ServicesProvider, useServices } from './ServicesProvider';
export type { ServicesProviderProps } from './ServicesProvider';
