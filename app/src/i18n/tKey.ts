import type { CatalogKey } from './catalog';

/**
 * Marks a catalog key that is stored in data and translated later with t(key). The type
 * checks that the key exists in the app catalog, and the key scan test (src/i18n/keys.test.ts)
 * finds tKey('...') calls as well as t('...') and plural('...').
 */
export function tKey<K extends CatalogKey>(key: K): K {
  return key;
}
