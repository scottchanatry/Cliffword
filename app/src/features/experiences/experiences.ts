/**
 * The experiences (the pair's series, PairPack.tracks) as the picker, the Story home and Settings
 * show them. Pure: built from the pair pack and, once a story session exists, its library progress
 * (StorySession.libraryProgress). Nothing here is Spanish-specific: titles, taglines, places and
 * episode titles come from the pack, and story text is resolved with the engine's variants.
 */
import {
  episodesOfTrack,
  locateAnswer,
  resolveVariants,
  storyForEpisode,
  trackCards,
  variantContext,
  type LibraryDialect,
  type LibraryGender,
  type LibraryProgress,
  type LibraryTrack,
  type PairPack,
} from '@cliffword/engine';

/** One card of the experience picker. */
export interface ExperienceCardData {
  id: string;
  title: string;
  tagline: string;
  city: string;
  country: string;
  dialect: LibraryDialect | null;
  /** No episode written yet: shown, cannot be started. */
  comingSoon: boolean;
  episodes: number;
  /** Finished episodes (0 before a session exists). */
  completed: number;
  /** The learner is in this experience now. */
  current: boolean;
  /** Every episode is done. */
  done: boolean;
  /** Choices to ask before the first episode, not made yet. */
  missingChoices: string[];
}

/** Every experience of the pair, in picker order, with the learner's progress when known. */
export function experienceCards(pair: Pick<PairPack, 'tracks' | 'library'>, progress?: LibraryProgress | null, currentId?: string | null): ExperienceCardData[] {
  const cards = trackCards(pair.tracks, pair.library);
  return cards.map((card) => {
    const p = progress?.tracks.find((t) => t.id === card.id);
    const meta = (pair.tracks ?? []).find((t) => t.id === card.id);
    return {
      id: card.id,
      title: card.title,
      tagline: card.tagline,
      city: card.city,
      country: card.country,
      dialect: card.dialect,
      comingSoon: card.comingSoon,
      episodes: card.episodes,
      completed: p?.completed.length ?? 0,
      current: progress ? progress.track === card.id : currentId === card.id,
      done: p?.done ?? false,
      missingChoices: p ? p.missingChoices : (meta?.choices ?? []).map((c) => c.key),
    };
  });
}

/** One row of the Story home's episode list. */
export interface EpisodeRow {
  episode: number;
  /** The episode's title in the learner's language. */
  title: string;
  /** The title in the target language. */
  titleTarget: string;
  state: 'done' | 'next' | 'playing' | 'locked';
  /** While playing: lines done and lines in the episode. */
  line?: number;
  lines?: number;
}

/** The track's metadata. */
export function trackOfPair(pair: Pick<PairPack, 'tracks'>, trackId: string | null | undefined): LibraryTrack | undefined {
  return (pair.tracks ?? []).find((t) => t.id === trackId);
}

/**
 * The episodes of an experience for the Story home: done ones (replayable), the next one (or the
 * one in progress, with its line) and the ones after it. Titles are the episode in the tier of the
 * learner's level, resolved for their address and choices.
 */
export function episodeRows(
  pair: Pick<PairPack, 'tracks' | 'library'>,
  progress: LibraryProgress,
  trackId: string = progress.track,
): EpisodeRow[] {
  const p = progress.tracks.find((t) => t.id === trackId);
  const ctx = variantContext(trackOfPair(pair, trackId), progress.address, p?.choices ?? {});
  return episodesOfTrack(pair.library, trackId).map((episode) => {
    const story = storyForEpisode(pair.library, trackId, episode, progress.level);
    const title = resolveVariants(story?.titleNative ?? '', ctx);
    const titleTarget = resolveVariants(story?.title ?? '', ctx);
    if (p?.completed.includes(episode)) return { episode, title, titleTarget, state: 'done' };
    // An episode opened but no line done yet is still "up next".
    if (p?.playing?.episode === episode && p.playing.line > 0) return { episode, title, titleTarget, state: 'playing', line: p.playing.line, lines: p.playing.lines };
    if (p?.playing?.episode === episode) return { episode, title, titleTarget, state: 'next' };
    if ((p?.next ?? null) === episode) return { episode, title, titleTarget, state: 'next' };
    return { episode, title, titleTarget, state: 'locked' };
  });
}

/** The row "Continue" opens: the episode in progress, else the next one; null when the experience is done. */
export function continueRow(rows: readonly EpisodeRow[]): EpisodeRow | null {
  return rows.find((r) => r.state === 'playing') ?? rows.find((r) => r.state === 'next') ?? null;
}

/**
 * A line of the experience said to the learner in both forms of address, for onboarding's "How
 * should people address you?" (e.g. "¡Buenos días, vecino!" and "¡Buenos días, vecina!"). The
 * first story line with a '{you:a|b}' variant whose two forms differ; null when there is none.
 */
export function addressExample(pair: Pick<PairPack, 'tracks' | 'library'>, trackId: string | null): Record<LibraryGender, string> | null {
  const track = trackOfPair(pair, trackId);
  const stories = [...(pair.library ?? [])]
    .filter((s) => s.track === trackId)
    .sort((a, b) => a.episode - b.episode);
  for (const story of stories) {
    for (const line of story.sentences) {
      if (!line.text.includes('{you:')) continue;
      const m = resolveVariants(line.text, variantContext(track, 'm'));
      const f = resolveVariants(line.text, variantContext(track, 'f'));
      if (m !== f && !m.includes('{') && !f.includes('{')) return { m, f };
    }
  }
  return null;
}

/** A line split around its cliff word, for the welcome screen's three-step picture. */
export interface LineSample {
  before: string;
  word: string;
  after: string;
}

/**
 * The first line of the first playable experience that needs no form of address (none is chosen
 * yet on the welcome screen), split around its cliff word with the pack's segmenter
 * (locateAnswer); null when the pair has no library.
 */
export function welcomeSample(pair: Pick<PairPack, 'tracks' | 'library'>, lang: Parameters<typeof locateAnswer>[0]): LineSample | null {
  const cards = trackCards(pair.tracks, pair.library);
  const trackId = cards.find((c) => !c.comingSoon)?.id ?? pair.library?.[0]?.track;
  if (!trackId) return null;
  const first = episodesOfTrack(pair.library, trackId)[0];
  const story = first === undefined ? null : storyForEpisode(pair.library, trackId, first, 0);
  for (const line of story?.sentences ?? []) {
    if (line.text.includes('{') || line.cliff.word.includes('{')) continue;
    const span = locateAnswer(lang, line.text, line.cliff.word);
    if (!span) continue;
    return { before: line.text.slice(0, span.start), word: line.text.slice(span.start, span.end), after: line.text.slice(span.end) };
  }
  return null;
}
