/**
 * The dev preview gallery (app/(dev)/preview/[screen].tsx) exists in development builds and
 * in preview web exports made with EXPO_PUBLIC_PREVIEW=1 (inlined at build time), never in a
 * store build: there both are false, the (dev) group has no screens and its route redirects
 * home.
 */
export const PREVIEW_ENABLED: boolean = __DEV__ || process.env.EXPO_PUBLIC_PREVIEW === '1';
