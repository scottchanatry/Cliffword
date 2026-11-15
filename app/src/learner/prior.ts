/**
 * The learner model's prior: what the app assumes about a word before the learner has met it.
 * Learner snapshots do not store the prior, so the same prior must be rebuilt at every start;
 * it is a pure function of the packs and the onboarding choice (settings.startLevel).
 *
 * - 'brandNew' ("I'm brand new", placement skipped): cognates of the pair are probably
 *   understood, everything else is unknown (PlacementTracker.brandNew).
 * - 'placement' ("I know some"): placement's starting estimate, a lower-intermediate learner
 *   by frequency rank, cognates floored at the cognate prior. The first story records
 *   placement answers and narrows it (Story stage).
 */
import {
  PlacementTracker,
  cognateLexemeKeys,
  rankOfFromPack,
  type LanguagePack,
  type PairPack,
  type PriorFn,
} from '@cliffword/engine';
import type { StartLevel } from '../storage/repos/settings';

export interface PriorPacks {
  readonly lang: LanguagePack;
  readonly pair: PairPack;
}

export function learnerPrior(packs: PriorPacks, start: StartLevel): PriorFn {
  const cognates = cognateLexemeKeys(packs.pair);
  switch (start) {
    case 'brandNew':
      return PlacementTracker.brandNew(cognates);
    case 'placement':
      return new PlacementTracker().prior(rankOfFromPack(packs.lang), cognates);
  }
}
