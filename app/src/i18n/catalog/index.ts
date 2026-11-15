import { en } from './en';

export type Catalog = Readonly<Record<string, string>>;

/** The language used when the learner's native language has no catalog or lacks a key. */
export const FALLBACK_LANGUAGE = 'en';

/** App catalogs by native language (ISO 639-1). Add a language by adding its file here. */
export const catalogs: Readonly<Record<string, Catalog>> = { en };

export { en };
export type { CatalogKey } from './en';
