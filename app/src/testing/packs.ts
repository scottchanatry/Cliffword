/**
 * Packs for tests (test-only). The app's packs (defaultPacks: the en-es pair with its authored
 * experiences) make StorySession play the library; tests of the earlier generated flow (starter,
 * placement, model sentences, retell) use generatedPacks(), the same pair without the library.
 */
import { createDefaultPairPack, type PairPack } from '@cliffword/engine';
import { defaultPacks } from '../services/defaults';
import type { ServicePacks } from '../services/types';

let generated: ServicePacks | undefined;

/** The Spanish pack and the en-es pair without its library: StorySession plays the generated flow. */
export function generatedPacks(): ServicePacks {
  generated ??= { lang: defaultPacks().lang, pair: createDefaultPairPack({ library: false }) };
  return generated;
}

/** The generated flow's pair with another starter story (or any other change). */
export function generatedPair(patch: Partial<PairPack> = {}): PairPack {
  return { ...generatedPacks().pair, ...patch };
}

/** The app's packs: the en-es pair with its experiences (only Living in San Juan is written). */
export function libraryPacks(): ServicePacks {
  const packs = defaultPacks();
  if (!packs.pair.library?.length || !packs.pair.tracks?.length) throw new Error('libraryPacks: the en-es pair has no library');
  return packs;
}

/** The first playable experience of the library packs and its episodes, in order. */
export function livingTrack(): { id: string; episodes: number[] } {
  const { pair } = libraryPacks();
  const library = pair.library ?? [];
  const track = (pair.tracks ?? []).find((t) => library.some((s) => s.track === t.id));
  if (!track) throw new Error('libraryPacks: no playable experience');
  const episodes = [...new Set(library.filter((s) => s.track === track.id).map((s) => s.episode))].sort((a, b) => a - b);
  return { id: track.id, episodes };
}
