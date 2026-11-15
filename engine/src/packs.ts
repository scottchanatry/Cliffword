/**
 * Ready-made packs for the first pair (Spanish for English speakers), and small helpers
 * that turn pack data into learner keys.
 *
 * The engine core never imports a language: the app picks packs here and passes them
 * in. Adding a pair means adding its language pack, rules, registers and pair pack, and
 * a factory like the ones below.
 */
import type { LanguagePack, RegisterPack } from './lang/types';
import type { PairPack } from './pair/types';
import { lexemeKey } from './learner/types';
import { createSpanishPack } from './lang/es';
import { SPANISH_RULES } from './lang/es/rules';
import { SPANISH_REGISTERS, expandRegions } from './lang/es/registers';
import { createEnEsPairPack } from './pair/en-es';

export interface DefaultPackOptions {
  /**
   * Region codes whose slang packs are loaded, e.g. ["PR"]. A Caribbean member region
   * (PR, DO, CU, CO) also loads the shared Caribbean pack (CARIB). All regions when
   * omitted; [] loads none.
   */
  regions?: readonly string[];
}

/**
 * The Spanish register packs for a region selection, in SPANISH_REGISTERS order (the
 * shared Caribbean pack first). No selection means all of them.
 */
export function spanishRegistersFor(regions?: readonly string[]): readonly RegisterPack[] {
  if (regions === undefined) return SPANISH_REGISTERS;
  const allowed = expandRegions(regions);
  if (!allowed) return [];
  return SPANISH_REGISTERS.filter((p) => allowed.has(p.region));
}

/**
 * The Spanish language pack with every Spanish correction rule and the slang register
 * packs: createSpanishPack({ rules: SPANISH_RULES, registers: SPANISH_REGISTERS }), or the
 * registers of opts.regions only.
 */
export function createDefaultSpanishPack(opts: DefaultPackOptions = {}): LanguagePack {
  return createSpanishPack({ rules: SPANISH_RULES, registers: spanishRegistersFor(opts.regions) });
}

/**
 * The English -> Spanish pair pack, with slang glosses from the same register packs as
 * createDefaultSpanishPack (all regions unless opts.regions is given).
 */
export function createDefaultPairPack(opts: DefaultPackOptions = {}): PairPack {
  return createEnEsPairPack({ registers: spanishRegistersFor(opts.regions) });
}

/**
 * Lexeme keys of the pack's frequency list, most frequent first ("es:el", "es:de", ...);
 * [] when the pack has no frequencyList. Input for estimateVocabulary, chooseTargets and
 * placement word picking.
 */
export function frequencyLexemeKeys(pack: Pick<LanguagePack, 'code' | 'frequencyList'>): string[] {
  return (pack.frequencyList ?? []).map((lemma) => lexemeKey(pack.code, lemma));
}

/**
 * Lexeme keys of the pair's cognates ("es:hospital"), for PlacementTracker.brandNew and
 * PlacementTracker.prior, which take keys while PairPack.cognates holds lemmas.
 */
export function cognateLexemeKeys(pair: Pick<PairPack, 'target' | 'cognates'>): string[] {
  return [...pair.cognates].map((lemma) => lexemeKey(pair.target, lemma));
}

/**
 * Lexeme keys of the slang lemmas in the pack's register packs, in pack order, without
 * duplicates. Material beyond the frequency list: pass as `extra` to chooseTargets in
 * street mode.
 */
export function slangLexemeKeys(pack: Pick<LanguagePack, 'code' | 'registers'>): string[] {
  const out = new Set<string>();
  for (const reg of pack.registers) for (const e of reg.entries) if (e.lemma) out.add(lexemeKey(pack.code, e.lemma));
  return [...out];
}
