/**
 * The learner model's prior: what the app assumes about a word before the learner has met it.
 * A prior is a function, so it is never stored itself. The engine describes it as data, a
 * PriorSpec, and rebuilds it with buildPrior; the app uses the same form:
 *
 * - 'brandNew' ("I'm brand new", placement skipped): cognates of the pair are probably
 *   understood, everything else is unknown (PlacementTracker.brandNew).
 * - 'placement' ("I know some"): placement's estimate by frequency rank, cognates floored at
 *   the cognate prior. Before placement has run, that is a fresh PlacementTracker (a
 *   lower-intermediate learner); once the first story has placed the learner, the story
 *   session stores the tracker's spec with the learner snapshot (storage.learner.saveSnapshot
 *   with `prior`), and startup reads it back (storage.learner.latestPrior()).
 *
 * The stored spec wins only while it fits settings.startLevel, so changing the start level
 * (or a stored spec of the other kind) falls back to that level's own prior.
 */
import {
  PlacementTracker,
  buildPrior,
  type LanguagePack,
  type PairPack,
  type PriorFn,
  type PriorSpec,
} from '@cliffword/engine';
import type { StartLevel } from '../storage/repos/settings';

export interface PriorPacks {
  readonly lang: LanguagePack;
  readonly pair: PairPack;
}

/** The PriorSpec for a start level, or the stored one when it fits that level. */
export function priorSpecFor(start: StartLevel, stored?: PriorSpec | null): PriorSpec {
  switch (start) {
    case 'brandNew':
      return { kind: 'brandNew' };
    case 'placement':
      return stored?.kind === 'placement' ? stored : { kind: 'placement', placement: new PlacementTracker().snapshot() };
  }
}

/** The prior function of a spec (the engine's buildPrior; 'default' is LearnerModel's own). */
export function priorFromSpec(packs: PriorPacks, spec: PriorSpec): PriorFn | undefined {
  return buildPrior(spec, packs.lang, packs.pair);
}

/** The learner's prior for a start level, from the stored spec when it fits (see above). */
export function learnerPrior(packs: PriorPacks, start: StartLevel, stored?: PriorSpec | null): PriorFn {
  // priorSpecFor never gives 'default', so buildPrior always returns a function here.
  return priorFromSpec(packs, priorSpecFor(start, stored)) as PriorFn;
}
