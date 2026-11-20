/**
 * Startup, without React: open storage (migrated), read the settings, store a photo whose pick
 * Android interrupted by closing the app, check that the learner's photo is still there, restore
 * the learner model (newest snapshot plus the events logged after
 * it) with the prior the settings call for (or the one stored with the snapshot by placement; see
 * src/learner/prior.ts). AppBootstrap runs it once and shows a loading state until it resolves.
 */
import type { PhotoPicker } from '../adapters/photo/types';
import type { LoadedLearner } from '../storage/repos/learner';
import { DEFAULT_PICTURE, normalizePicture, type AppSettings } from '../storage/repos/settings';
import type { Storage } from '../storage/storage';
import { learnerPrior } from '../learner/prior';
import type { Services } from '../services/types';

export interface BootResult {
  storage: Storage;
  settings: AppSettings;
  /** The restored learner model and how it was rebuilt. */
  learner: LoadedLearner;
}

export async function bootstrap(services: Pick<Services, 'storage' | 'packs' | 'photos'>): Promise<BootResult> {
  const storage = await services.storage.open();
  const read = await storage.settings.getAll();
  const settings = await checkPicture(storage, await recoverPicture(storage, read, services.photos), services.photos);
  // The prior stored with the newest learner snapshot (placement's result), when it fits the start level.
  const stored = await storage.learner.latestPrior();
  const learner = await storage.learner.loadLearner({ prior: learnerPrior(services.packs, settings.startLevel, stored) });
  return { storage, settings, learner };
}

/**
 * A selfie or photo picked while Android closed the app (the camera or the photo picker was in
 * front; expo-image-picker keeps the result for the next start): it becomes the picture, as the
 * chooser would have made it, and the photo it replaces is deleted. A recovered photo that cannot
 * be stored as the setting is deleted; nothing else changes.
 */
export async function recoverPicture(storage: Storage, settings: AppSettings, photos: PhotoPicker): Promise<AppSettings> {
  const recovered = await photos.recover().catch((e: unknown) => ({ kind: 'error' as const, message: String(e) }));
  if (!recovered) return settings;
  if (recovered.kind === 'error') {
    console.warn('[bootstrap] interrupted photo not recovered', recovered.message);
    return settings;
  }
  const picture = normalizePicture({ kind: 'photo', uri: recovered.uri });
  const before = settings.picture;
  try {
    if (!picture) throw new Error('not a photo uri');
    const next = await storage.settings.update({ picture });
    if (before.kind === 'photo' && before.uri !== recovered.uri) await photos.remove(before.uri);
    return next;
  } catch (e) {
    console.warn('[bootstrap] interrupted photo not stored', e);
    await photos.remove(recovered.uri);
    return settings;
  }
}

/**
 * The learner's photo as it is on the device now. Photos are left out of backups, so after a
 * restore or a reinstall the setting can name a file that is gone: the picture goes back to the
 * default character. A photo found under a moved documents folder (iOS can move it between
 * installs and updates) is stored at its new uri. A failed write still starts the app with the
 * checked picture.
 */
export async function checkPicture(storage: Storage, settings: AppSettings, photos: PhotoPicker): Promise<AppSettings> {
  const picture = settings.picture;
  if (picture.kind !== 'photo') return settings;
  const found = await photos.locate(picture.uri).catch(() => null);
  if (found === picture.uri) return settings;
  const next = (found ? normalizePicture({ kind: 'photo', uri: found }) : undefined) ?? DEFAULT_PICTURE;
  try {
    return await storage.settings.update({ picture: next });
  } catch (e) {
    console.warn('[bootstrap] picture not updated', e);
    return { ...settings, picture: next };
  }
}
