/**
 * Gender variants inside story strings, resolved before anything is shown, spoken,
 * scored or used as a cliff. Language-neutral: the syntax is the same for every pair.
 *
 * - '{you:a|b}': a for a learner addressed as a man, b for one addressed as a woman.
 * - '{<key>:a|b}': agrees with the gender of the option chosen for the track choice
 *   <key> ('{partner:él|ella}').
 * - '{<key>.name}': the label of the option chosen for <key> ('{partner.name}').
 *
 * Alternatives may be empty ('{you:|a}') and never contain braces or a bar; tokens do
 * not nest. A token whose key has no value in the context is left as written, so
 * validation (unresolvedTokens) can report it.
 */
import type { LibraryChoice, LibraryGender, LibraryStory, LibraryTrack } from '../pair/types';

/** A chosen option of a track choice, as the resolver needs it. */
export interface VariantChoice {
  id: string;
  label: string;
  gender: LibraryGender;
}

/** What variants resolve against: the learner's address and the track's choices by key. */
export interface VariantContext {
  you: LibraryGender;
  choices: Readonly<Record<string, VariantChoice>>;
}

/** '{key:a|b}' (two alternatives) and '{key.name}'. Keys start with a letter. */
const TOKEN = /\{([A-Za-z][A-Za-z0-9_]*)(?::([^{}|]*)\|([^{}|]*)|\.name)\}/g;

/** Resolve every variant token of `text` against `ctx` (unknown keys stay as written). */
export function resolveVariants(text: string, ctx: VariantContext): string {
  if (!text.includes('{')) return text;
  return text.replace(TOKEN, (whole: string, key: string, a: string | undefined, b: string | undefined) => {
    if (a === undefined || b === undefined) {
      const c = ctx.choices[key];
      return c ? c.label : whole;
    }
    const gender = key === 'you' ? ctx.you : ctx.choices[key]?.gender;
    if (gender === undefined) return whole;
    return gender === 'f' ? b : a;
  });
}

/** True when the text still holds a brace (an unknown key or a malformed token). */
export function hasUnresolved(text: string): boolean {
  return text.includes('{') || text.includes('}');
}

/** Variant keys a text uses ('you' and choice keys), in order of first use. */
export function variantKeys(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const key = m[1] as string;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** A deep copy of plain data with every string resolved. */
export function resolveDeep<T>(value: T, ctx: VariantContext): T {
  if (typeof value === 'string') return resolveVariants(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveDeep(v, ctx);
    return out as T;
  }
  return value;
}

/** The story with every string resolved (ids contain no tokens, so they stay as they are). */
export function resolveStory(story: LibraryStory, ctx: VariantContext): LibraryStory {
  return resolveDeep(story, ctx);
}

/**
 * The context for a learner: their address, and for every choice of the track the option
 * chosen (by option id), else the first option, so a story always resolves.
 */
export function variantContext(
  track: Pick<LibraryTrack, 'choices'> | undefined,
  you: LibraryGender,
  chosen: Readonly<Record<string, string>> = {},
): VariantContext {
  const choices: Record<string, VariantChoice> = {};
  for (const c of track?.choices ?? []) {
    const opt = c.options.find((o) => o.id === chosen[c.key]) ?? c.options[0];
    if (opt) choices[c.key] = { id: opt.id, label: opt.label, gender: opt.gender };
  }
  return { you, choices };
}

/**
 * Every context a story of the track can be played in: both forms of address times every
 * option of every choice (the validator resolves a story in all of them).
 */
export function allVariantContexts(track: Pick<LibraryTrack, 'choices'> | undefined): VariantContext[] {
  let out: VariantContext[] = [
    { you: 'm', choices: {} },
    { you: 'f', choices: {} },
  ];
  for (const c of (track?.choices ?? []) as LibraryChoice[]) {
    const next: VariantContext[] = [];
    for (const ctx of out) {
      for (const o of c.options) next.push({ you: ctx.you, choices: { ...ctx.choices, [c.key]: { id: o.id, label: o.label, gender: o.gender } } });
    }
    if (next.length) out = next;
  }
  return out;
}

/** Every string of a value with its path ('sentences.2.cliff.word'), for validation messages. */
export function stringsOf(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringsOf(v, path ? `${path}.${i}` : String(i)));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => stringsOf(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/**
 * Strings of a story that still hold braces after resolving in every context of its track
 * (unknown keys, malformed tokens, stray braces). [] when the story always resolves.
 */
export function unresolvedTokens(story: LibraryStory, track: Pick<LibraryTrack, 'choices'> | undefined): { path: string; text: string; you: LibraryGender }[] {
  const out: { path: string; text: string; you: LibraryGender }[] = [];
  const seen = new Set<string>();
  for (const ctx of allVariantContexts(track)) {
    for (const s of stringsOf(resolveStory(story, ctx))) {
      if (!hasUnresolved(s.text) || seen.has(s.path)) continue;
      seen.add(s.path);
      out.push({ ...s, you: ctx.you });
    }
  }
  return out;
}
