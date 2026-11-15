/**
 * The app's one service container, built on first use for the current platform. AppProviders
 * uses it unless given a container.
 *
 * Route tests render the real root layout (which uses this container), so they install a test
 * container first: `setAppServices(createTestServices())`, and `setAppServices(undefined)` to
 * go back to building one for the platform.
 */
import { createServices, currentPlatform } from './Services';
import type { Services } from './types';

let appServices: Services | undefined;

export function getAppServices(): Services {
  appServices ??= createServices(currentPlatform());
  return appServices;
}

/** Replaces the app's container (route tests). undefined: build one for the platform on next use. */
export function setAppServices(services: Services | undefined): void {
  appServices = services;
}
