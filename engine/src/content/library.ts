/**
 * The authored library as data the session plays: series (tracks) of episodes in order,
 * the tier of an episode for a learner level, the cliff mode of a level, and the level
 * rule after an episode. Pure and language-neutral.
 *
 * Levels (the learner's, 0-5, not the episode's):
 * - tier: 0-1 beginner, 2-3 intermediate, 4-5 advanced; the nearest written tier when the
 *   wanted one is not written (the easier one on a tie).
 * - cliff mode: 0-1 recall (hear and see the whole line, then pick or say the missing
 *   word), 2-3 hint (the translation shows the gap word in bold; say it), 4-5 predict
 *   (say what comes next; any natural answer counts).
 * - after each episode: up one when at least 80% of its cliffs were answered without
 *   options or "no sé", down one under 50%, else unchanged; always within 0-5.
 */
import type { LibraryStory, LibraryTier, LibraryTrack } from '../pair/types';

/** How a cliff is asked, by learner level. */
export type CliffMode = 'recall' | 'hint' | 'predict';

export const LIBRARY_TIERS: readonly LibraryTier[] = ['beginner', 'intermediate', 'advanced'];

/** Lowest and highest learner level. */
export const MIN_LEVEL = 0;
export const MAX_LEVEL = 5;

/** A level as an integer in 0-5 (non-finite counts as 0). */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}

/** The tier written for a learner level: 0-1 beginner, 2-3 intermediate, 4-5 advanced. */
export function tierForLevel(level: number): LibraryTier {
  const l = clampLevel(level);
  return l <= 1 ? 'beginner' : l <= 3 ? 'intermediate' : 'advanced';
}

/** The cliff mode of a learner level: 0-1 recall, 2-3 hint, 4-5 predict. */
export function cliffModeForLevel(level: number): CliffMode {
  const l = clampLevel(level);
  return l <= 1 ? 'recall' : l <= 3 ? 'hint' : 'predict';
}

/** Tunable numbers of the level rule. */
export interface LevelRuleOptions {
  /** Up one level when the unaided share is at least this. */
  upAt: number;
  /** Down one level when the unaided share is below this. */
  downBelow: number;
}

/** The redesign's rule: up at 80% unaided, down under 50%. */
export const DEFAULT_LEVEL_RULE: Readonly<LevelRuleOptions> = { upAt: 0.8, downBelow: 0.5 };

/**
 * The learner level after an episode with `cliffs` cliffs, `unaided` of them answered
 * without options or "no sé". An episode without cliffs leaves the level unchanged.
 */
export function levelAfterEpisode(level: number, cliffs: number, unaided: number, opts: Partial<LevelRuleOptions> = {}): number {
  const o = { ...DEFAULT_LEVEL_RULE, ...opts };
  const l = clampLevel(level);
  if (!(cliffs > 0)) return l;
  const share = Math.max(0, Math.min(1, unaided / cliffs));
  if (share >= o.upAt) return clampLevel(l + 1);
  if (share < o.downBelow) return clampLevel(l - 1);
  return l;
}

/** The library's stories of a track. */
export function storiesOfTrack(library: readonly LibraryStory[] | undefined, trackId: string): LibraryStory[] {
  return (library ?? []).filter((s) => s.track === trackId);
}

/** Episode numbers written for a track, ascending, without duplicates. */
export function episodesOfTrack(library: readonly LibraryStory[] | undefined, trackId: string): number[] {
  return [...new Set(storiesOfTrack(library, trackId).map((s) => s.episode))].filter((e) => Number.isFinite(e)).sort((a, b) => a - b);
}

/** A track with no written story is coming soon: shown on the picker, cannot be started. */
export function isComingSoon(library: readonly LibraryStory[] | undefined, trackId: string): boolean {
  return episodesOfTrack(library, trackId).length === 0;
}

/** The first written episode after `episode` (0 gives the first), or null after the last. */
export function nextEpisodeOf(library: readonly LibraryStory[] | undefined, trackId: string, episode: number): number | null {
  return episodesOfTrack(library, trackId).find((e) => e > episode) ?? null;
}

/**
 * The story of an episode for a learner level: the wanted tier (tierForLevel) when
 * written, else the nearest written tier, the easier one on a tie; among stories of the
 * same tier, the first in library order. null when the episode is not written.
 */
export function storyForEpisode(
  library: readonly LibraryStory[] | undefined,
  trackId: string,
  episode: number,
  level: number,
): LibraryStory | null {
  const written = storiesOfTrack(library, trackId).filter((s) => s.episode === episode);
  if (written.length === 0) return null;
  const want = LIBRARY_TIERS.indexOf(tierForLevel(level));
  let best: LibraryStory | null = null;
  let bestKey = Infinity;
  for (const s of written) {
    const t = LIBRARY_TIERS.indexOf(s.tier);
    const idx = t < 0 ? 0 : t;
    // Distance first, then the easier tier.
    const key = Math.abs(idx - want) * 10 + idx;
    if (key < bestKey) {
      best = s;
      bestKey = key;
    }
  }
  return best;
}

/** The display name of a speaker: a cast member's local name when `speaker` is a cast id, else as written. */
export function speakerName(track: Pick<LibraryTrack, 'cast'> | undefined, speaker: string | undefined): string | null {
  if (speaker === undefined || speaker === '') return null;
  const member = track?.cast?.find((c) => c.id === speaker);
  return member ? member.name : speaker;
}

/** The tracks of a pair with their state on the picker. */
export interface TrackCard {
  id: string;
  title: string;
  tagline: string;
  city: string;
  country: string;
  dialect: LibraryTrack['dialect'];
  /** No written episode yet: shown, cannot be started. */
  comingSoon: boolean;
  /** Written episodes. */
  episodes: number;
  /** Choices to ask before the first episode. */
  hasChoices: boolean;
}

/** Picker cards for every track, in the pair's order (no progress; see StorySession.libraryProgress). */
export function trackCards(tracks: readonly LibraryTrack[] | undefined, library: readonly LibraryStory[] | undefined): TrackCard[] {
  return (tracks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    tagline: t.tagline,
    city: t.city,
    country: t.country,
    dialect: t.dialect,
    comingSoon: isComingSoon(library, t.id),
    episodes: episodesOfTrack(library, t.id).length,
    hasChoices: (t.choices ?? []).length > 0,
  }));
}

/** The first track that can be started (has a written episode), or null. */
export function firstPlayableTrack(tracks: readonly LibraryTrack[] | undefined, library: readonly LibraryStory[] | undefined): string | null {
  for (const t of tracks ?? []) if (!isComingSoon(library, t.id)) return t.id;
  // Stories whose track has no metadata still play.
  const s = (library ?? [])[0];
  return s ? s.track : null;
}

/**
 * Where the text `hint` sits in `translation` (case-insensitive; whole words preferred),
 * for the bold gap word at the hint level. null when it is not there.
 */
export function hintSpan(translation: string, hint: string | undefined): { start: number; end: number } | null {
  const h = (hint ?? '').trim();
  if (!h || !translation) return null;
  const lower = translation.toLowerCase();
  const want = h.toLowerCase();
  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  let from = 0;
  let first: number | null = null;
  for (;;) {
    const i = lower.indexOf(want, from);
    if (i < 0) break;
    if (first === null) first = i;
    if (!isWordChar(translation[i - 1]) && !isWordChar(translation[i + want.length])) return { start: i, end: i + want.length };
    from = i + 1;
  }
  return first === null ? null : { start: first, end: first + want.length };
}
