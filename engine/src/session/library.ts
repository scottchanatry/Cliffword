/**
 * Library state of a story session (the authored series of PairPack.library), as plain
 * data, and the pure helpers StorySession uses to play it: per-track progress, the
 * resolved episode for the learner, the picker view, the feedback alternatives and the
 * gapped speak cue. Language-neutral.
 *
 * Progress is kept per track, so switching experiences keeps each one where it was: the
 * next episode to play, the episode in progress (line, turns asked, cliffs counted), the
 * finished episodes and their results, and the track's choices. The learner level and
 * the form of address belong to the learner and are shared by every track.
 */
import type { LanguagePack } from '../lang/types';
import type { LibraryStory, LibraryTrack, PairPack } from '../pair/types';
import type { NextWord } from '../scoring/types';
import { episodesOfTrack, isComingSoon, clampLevel } from '../content/library';
import { resolveStory, variantContext } from '../content/variants';
import { looseText } from './common';
import type { EpisodeResult, LearnerAddress, LibraryProgress, LibraryStart, TrackProgressView } from './types';

/** An episode being played in a track. */
export interface EpisodePlay {
  episode: number;
  storyId: string;
  /** Index of the line on screen (or next to show). */
  line: number;
  /** The line at `line` was answered (or skipped); next() moves past it. */
  lineDone: boolean;
  /** Ids of the turns already asked. */
  turns: string[];
  cliffs: number;
  unaided: number;
  replay: boolean;
  /** Learner level when the episode started (the cliff mode of the whole episode). */
  level: number;
}

/** One track's progress. */
export interface TrackProgress {
  /** The episode the track continues with (the first unfinished one). */
  next: number;
  completed: number[];
  choices: Record<string, string>;
  results: EpisodeResult[];
  /** Every written episode is finished. */
  done: boolean;
  play: EpisodePlay | null;
  /** The episode in progress, kept while a finished one is replayed. */
  paused: EpisodePlay | null;
}

/** The library part of StoryState. */
export interface LibraryState {
  track: string;
  level: number;
  address: LearnerAddress;
  tracks: Record<string, TrackProgress>;
}

/** Results kept per track (the oldest are dropped). */
export const KEEP_RESULTS = 64;

/** True when the pair has at least one story to play. */
export function libraryAvailable(pair: Pick<PairPack, 'library'>): boolean {
  return (pair.library ?? []).length > 0;
}

/** A fresh progress record for a track: its first written episode next. */
export function newTrackProgress(library: readonly LibraryStory[] | undefined, trackId: string, choices: Record<string, string> = {}): TrackProgress {
  const first = episodesOfTrack(library, trackId)[0];
  return { next: first ?? 1, completed: [], choices: { ...choices }, results: [], done: first === undefined, play: null, paused: null };
}

/** The track a session starts in: the asked one when playable, else the first playable one. */
export function startTrack(pair: Pick<PairPack, 'library' | 'tracks'>, asked: string | undefined): string {
  const library = pair.library;
  if (asked && !isComingSoon(library, asked)) return asked;
  for (const t of pair.tracks ?? []) if (!isComingSoon(library, t.id)) return t.id;
  return (library ?? [])[0]?.track ?? asked ?? '';
}

/** The library state a new session starts with. */
export function initialLibraryState(pair: Pick<PairPack, 'library' | 'tracks'>, start: LibraryStart = {}): LibraryState {
  const track = startTrack(pair, start.trackId);
  const address: LearnerAddress = start.address === 'f' ? 'f' : 'm';
  return {
    track,
    level: clampLevel(start.startLevel ?? 0),
    address,
    tracks: { [track]: newTrackProgress(pair.library, track, start.choices ?? {}) },
  };
}

/** The track's metadata, when the pair has it. */
export function trackOf(pair: Pick<PairPack, 'tracks'>, trackId: string): LibraryTrack | undefined {
  return (pair.tracks ?? []).find((t) => t.id === trackId);
}

/** The story of the library with this id. */
export function storyById(pair: Pick<PairPack, 'library'>, id: string): LibraryStory | undefined {
  return (pair.library ?? []).find((s) => s.id === id);
}

/** A story resolved for the learner's address and the track's choices. */
export function resolvedStory(pair: Pick<PairPack, 'tracks'>, story: LibraryStory, address: LearnerAddress, choices: Record<string, string>): LibraryStory {
  return resolveStory(story, variantContext(trackOf(pair, story.track), address, choices));
}

/** The picker view: every track (metadata order, then tracks only the stories name) with progress. */
export function libraryProgressView(pair: Pick<PairPack, 'library' | 'tracks'>, lib: LibraryState): LibraryProgress {
  const ids = [...(pair.tracks ?? []).map((t) => t.id)];
  for (const s of pair.library ?? []) if (!ids.includes(s.track)) ids.push(s.track);
  const tracks: TrackProgressView[] = ids.map((id) => {
    const meta = trackOf(pair, id);
    const prog = lib.tracks[id];
    const comingSoon = isComingSoon(pair.library, id);
    const play = prog?.play && !prog.play.replay ? prog.play : prog?.paused ?? null;
    const lines = play ? storyById(pair, play.storyId)?.sentences.length ?? 0 : 0;
    const choices = { ...(prog?.choices ?? {}) };
    return {
      id,
      title: meta?.title ?? '',
      tagline: meta?.tagline ?? '',
      city: meta?.city ?? '',
      country: meta?.country ?? '',
      comingSoon,
      episodes: episodesOfTrack(pair.library, id).length,
      completed: [...(prog?.completed ?? [])].sort((a, b) => a - b),
      next: comingSoon || prog?.done ? null : prog?.next ?? episodesOfTrack(pair.library, id)[0] ?? null,
      done: prog?.done === true,
      current: lib.track === id,
      playing: play ? { episode: play.episode, line: Math.min(play.line + (play.lineDone ? 1 : 0), lines), lines } : null,
      choices,
      missingChoices: (meta?.choices ?? []).map((c) => c.key).filter((k) => choices[k] === undefined),
    };
  });
  return { level: lib.level, address: lib.address, track: lib.track, tracks };
}

/**
 * Other natural answers for the feedback: the listed ones (accept) first, then the model's
 * alternatives at or above `floor`, never the story's words or the learner's answer, no
 * duplicates (loose comparison), at most `max`.
 */
export function feedbackAlternatives(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  args: { expected: string; answer: string; accept: readonly string[]; model: readonly NextWord[]; floor: number; max: number },
): string[] {
  const seen = new Set<string>([looseText(pack, args.expected), looseText(pack, args.answer)]);
  const out: string[] = [];
  const add = (text: string): void => {
    const k = looseText(pack, text);
    if (!k || seen.has(k) || out.length >= args.max) return;
    seen.add(k);
    out.push(text.trim());
  };
  for (const a of args.accept) add(a);
  for (const a of args.model) if (a.prob >= args.floor) add(a.word);
  return out;
}

/** The parts of a line around its gap, for the gapped speak cue. */
export function gapParts(text: string, start: number, end: number): { before: string; after: string } {
  return { before: text.slice(0, start).trim(), after: text.slice(end).trim() };
}

/**
 * True when a reply holds a word of the target language: a word the pack analyses that is
 * not a common native word (accepted turn replies without a model).
 */
export function hasTargetWords(pack: LanguagePack, nativeLexicon: ReadonlySet<string>, text: string): boolean {
  for (const seg of pack.segment(text)) {
    if (seg.kind !== 'word') continue;
    const norm = seg.norm || pack.normalize(seg.text);
    if (nativeLexicon.has(norm)) continue;
    if (pack.analyze(norm).length > 0) return true;
  }
  return false;
}
