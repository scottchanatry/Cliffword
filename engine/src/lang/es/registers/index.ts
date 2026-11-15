/**
 * Spanish slang register packs (Puerto Rico, Dominican Republic, Cuba, Colombia and the
 * shared Caribbean clipped forms) and slang lookup.
 *
 * Pass SPANISH_REGISTERS to the Spanish language pack so street mode recognizes these
 * forms; use findSlang() to show a slang note (meaning, region, formality) for a word.
 */
import type { RegisterPack, SlangEntry } from '../../types';
import { CARIB, CARIB_MEMBERS, looseSlangKey, slangNorm } from './entry';
import { CARIB_REGISTER } from './caribbean';
import { CO_REGISTER } from './colombia';
import { CU_REGISTER } from './cuba';
import { DO_REGISTER } from './dominican';
import { PR_REGISTER } from './puertoRico';

/** All Spanish register packs. The shared Caribbean pack comes first. */
export const SPANISH_REGISTERS: RegisterPack[] = [CARIB_REGISTER, PR_REGISTER, DO_REGISTER, CU_REGISTER, CO_REGISTER];

export interface FindSlangOptions {
  /**
   * When true, entries whose accent- and apostrophe-free key matches are returned after
   * the exact matches ("ta" finds "'tá", "pa" finds "pa'"). Lyrics and speech
   * recognition often drop these marks.
   */
  loose: boolean;
  /** Packs to search. Defaults to SPANISH_REGISTERS. */
  packs: readonly RegisterPack[];
}

/** Defaults for findSlang: loose matching on, all Spanish packs. */
export const DEFAULT_FIND_SLANG_OPTIONS: FindSlangOptions = {
  loose: true,
  packs: SPANISH_REGISTERS,
};

interface SlangIndex {
  exact: Map<string, SlangEntry[]>;
  loose: Map<string, SlangEntry[]>;
}

const indexCache = new WeakMap<readonly RegisterPack[], SlangIndex>();

function push(map: Map<string, SlangEntry[]>, key: string, e: SlangEntry): void {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [e]);
  else if (!list.includes(e)) list.push(e);
}

/** Build (once per packs array) the exact and loose lookup maps, keeping pack order. */
function slangIndex(packs: readonly RegisterPack[]): SlangIndex {
  const hit = indexCache.get(packs);
  if (hit) return hit;
  const exact = new Map<string, SlangEntry[]>();
  const loose = new Map<string, SlangEntry[]>();
  for (const pack of packs) {
    for (const e of pack.entries) {
      push(exact, slangNorm(e.norm), e);
      push(exact, slangNorm(e.form), e);
      push(loose, looseSlangKey(e.norm), e);
    }
  }
  const index = { exact, loose };
  indexCache.set(packs, index);
  return index;
}

/**
 * Expand a region filter: any Caribbean member region (PR, DO, CU, CO) also admits the
 * shared CARIB entries. Returns undefined when there is no filter.
 */
export function expandRegions(regions?: readonly string[]): Set<string> | undefined {
  if (!regions || regions.length === 0) return undefined;
  const out = new Set(regions);
  if (regions.some((r) => CARIB_MEMBERS.includes(r))) out.add(CARIB);
  return out;
}

/** True if the entry belongs to one of the allowed regions (no filter admits everything). */
export function inRegions(entry: SlangEntry, allowed: ReadonlySet<string> | undefined): boolean {
  return !allowed || entry.regions.some((r) => allowed.has(r));
}

/**
 * Find slang entries for a word or phrase.
 *
 * Method: normalize the query like the Spanish pack does (lowercase, accents and clipped
 * apostrophes kept, edge punctuation trimmed) and look it up by norm and by form across
 * the packs, in pack order. If loose matching is on, entries whose accent- and
 * apostrophe-free key matches follow the exact matches. With `regions`, only entries
 * tagged with one of them are returned; a Caribbean member region (PR, DO, CU, CO) also
 * admits the shared CARIB entries. An empty or punctuation-only query returns [].
 *
 * Examples: findSlang("'tá") -> ['tá = está]; findSlang("ta") -> the same via loose
 * matching; findSlang("asere", ["PR"]) -> [] (asere is Cuban).
 */
export function findSlang(
  norm: string,
  regions?: readonly string[],
  opts: Partial<FindSlangOptions> = {},
): SlangEntry[] {
  const o: FindSlangOptions = { ...DEFAULT_FIND_SLANG_OPTIONS, ...opts };
  const key = slangNorm(norm);
  if (!key) return [];
  const index = slangIndex(o.packs);
  const allowed = expandRegions(regions);
  const out: SlangEntry[] = [];
  const add = (list: readonly SlangEntry[] | undefined) => {
    for (const e of list ?? []) if (inRegions(e, allowed) && !out.includes(e)) out.push(e);
  };
  add(index.exact.get(key));
  if (o.loose) add(index.loose.get(looseSlangKey(key)));
  return out;
}

/** The register pack for a region code, or undefined. */
export function registerFor(region: string): RegisterPack | undefined {
  return SPANISH_REGISTERS.find((p) => p.region === region);
}

export { CARIB_REGISTER } from './caribbean';
export { CO_REGISTER } from './colombia';
export { CU_REGISTER } from './cuba';
export { DO_REGISTER } from './dominican';
export { PR_REGISTER } from './puertoRico';
export { CARIB, CARIB_MEMBERS, CO, CU, DO, PR, REGION_CODES, looseSlangKey, slang, slangNorm } from './entry';
export type { EntryOptions } from './entry';
