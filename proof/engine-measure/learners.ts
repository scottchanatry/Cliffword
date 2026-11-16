/**
 * Simulated learners for the story-generation measurements (prompt-explore.ts,
 * generation.ts). The same profiles as engine/test/simulated-learners.test.ts: a prior
 * per skill that is a steep logistic on frequency rank around the profile's reach,
 * floored by the brand-new cognate prior. No study events: the generation runs only
 * need what the learner knows when a sentence is generated.
 */
import {
  LearnerModel,
  PlacementTracker,
  cognateLexemeKeys,
  createDefaultPairPack,
  createDefaultSpanishPack,
  frequencyLexemeKeys,
  lexemeOf,
} from '../../engine/src/index';
import type { PriorFn, Skill } from '../../engine/src/index';

export const pack = createDefaultSpanishPack();
export const pair = createDefaultPairPack();
export const KEYS = frequencyLexemeKeys(pack);
const RANK = new Map(KEYS.map((k, i) => [k, i + 1]));
const COGNATES = cognateLexemeKeys(pair);

export type ProfileId = 'brandNew' | 'early' | 'reader' | 'advanced' | 'heritage';
type Reach = Record<Skill, number>;

export const PROFILES: Record<ProfileId, { name: string; reach: Reach }> = {
  brandNew: { name: 'brand new (cognates only)', reach: { meaning: 0, sound: 0, written: 0, speaking: 0 } },
  early: { name: 'early (about 300 lemmas)', reach: { meaning: 300, sound: 200, written: 300, speaking: 80 } },
  reader: { name: 'intermediate reader, weak speaking', reach: { meaning: 2500, sound: 150, written: 2500, speaking: 30 } },
  advanced: { name: 'advanced', reach: { meaning: 5000, sound: 5000, written: 5000, speaking: 3500 } },
  heritage: { name: 'heritage speaker', reach: { meaning: 3000, sound: 3000, written: 40, speaking: 1500 } },
};

export function profilePrior(reach: Reach): PriorFn {
  const cognatePrior = PlacementTracker.brandNew(COGNATES);
  return (key, skill) => {
    const n = reach[skill];
    const r = RANK.get(lexemeOf(key)) ?? 50_000;
    const p = n <= 0 ? 0.002 : 0.002 + (0.97 - 0.002) / (1 + Math.pow(r / n, 6));
    return Math.max(p, cognatePrior(key, skill));
  };
}

export function learnerFor(id: ProfileId): LearnerModel {
  return new LearnerModel({ prior: profilePrior(PROFILES[id].reach) });
}

/** Opening sentences of the running story per profile (the generator continues them). */
export const OPENINGS: Record<ProfileId, string[]> = {
  // The starter story the brand-new learner has just heard (EN_ES_STARTER).
  brandNew: (pair.starter?.sentences ?? []).map((s) => s.text),
  early: ['Marta vive en una casa pequeña.', 'Hoy ella va al mercado con su hermano.'],
  reader: ['Marta llegó tarde al mercado.', 'Buscó al señor de las frutas, pero su puesto estaba cerrado.'],
  advanced: [
    'Marta llegó tarde al mercado.',
    'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
    'Entonces vio una nota en la puerta y empezó a leerla en voz alta.',
  ],
  heritage: ['Mi abuela siempre cocinaba los domingos.', 'Toda la familia llegaba temprano a su casa.'],
};
