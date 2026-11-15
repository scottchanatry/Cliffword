/**
 * Startup, without React: open storage (migrated), read the settings, restore the learner model
 * (newest snapshot plus the events logged after it) with the prior the settings call for.
 * AppBootstrap runs it once and shows a loading state until it resolves.
 */
import type { LoadedLearner } from '../storage/repos/learner';
import type { AppSettings } from '../storage/repos/settings';
import type { Storage } from '../storage/storage';
import { learnerPrior } from '../learner/prior';
import type { Services } from '../services/types';

export interface BootResult {
  storage: Storage;
  settings: AppSettings;
  /** The restored learner model and how it was rebuilt. */
  learner: LoadedLearner;
}

export async function bootstrap(services: Pick<Services, 'storage' | 'packs'>): Promise<BootResult> {
  const storage = await services.storage.open();
  const settings = await storage.settings.getAll();
  const learner = await storage.learner.loadLearner({ prior: learnerPrior(services.packs, settings.startLevel) });
  return { storage, settings, learner };
}
