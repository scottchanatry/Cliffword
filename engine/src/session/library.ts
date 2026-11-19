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
import type { LanguagePack, Pos } from '../lang/types';
import type { LibraryStory, LibraryTrack, PairPack } from '../pair/types';
import type { NextWord } from '../scoring/types';
import { episodesOfTrack, isComingSoon, clampLevel } from '../content/library';
import { resolveStory, variantContext } from '../content/variants';
import { locateAnswer } from './cliff';
import { looseText } from './common';
import type { EpisodeResult, LearnerAddress, LibraryProgress, LibraryStart, TrackProgressView, TranscriptEntry } from './types';

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
  /** Cliffs answered with credit (a tapped option too); missing in snapshots from before it. */
  correct?: number;
  replay: boolean;
  /** Learner level when the episode started (the cliff mode of the whole episode). */
  level: number;
  /**
   * The learner's last reply to each question of the episode (turn id -> what was heard),
   * for the transcript; missing in snapshots from before it.
   */
  replies?: Record<string, string>;
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
 * The episode of a play so far, as a conversation (EpisodeTranscript.entries): the lines
 * before `play.line` in story order (the gap filled with the story's words, its span located
 * with the pack's segmentation), each followed by the questions asked after it and the
 * learner's reply to each. `story` is the play's story resolved for the learner (resolvedStory);
 * `exclude` is the question on screen (the focus, not yet part of the story so far);
 * `speaker` gives a speaker's display name.
 */
export function episodeTranscript(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  story: LibraryStory,
  play: Pick<EpisodePlay, 'line' | 'turns' | 'replies'>,
  opts: { exclude?: string | null; speaker: (speaker: string | undefined) => string | null },
): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const asked = new Set(play.turns);
  const last = Math.min(play.line, story.sentences.length) - 1;
  const turnsAfter = (i: number) => (story.turns ?? []).filter((t) => (i < 0 ? t.after < 0 : t.after === i) && asked.has(t.id) && t.id !== opts.exclude);
  for (let i = -1; i <= last; i++) {
    const line = i >= 0 ? story.sentences[i] : undefined;
    if (line) {
      const span = locateAnswer(pack, line.text, line.cliff.word);
      out.push({
        kind: 'line',
        id: line.id,
        speakerId: line.speaker ?? null,
        speaker: opts.speaker(line.speaker),
        text: line.text,
        translation: line.translation,
        gap: span ? { start: span.start, end: span.end } : null,
      });
    }
    for (const turn of turnsAfter(i)) {
      out.push({ kind: 'question', id: turn.id, speakerId: turn.speaker ?? null, speaker: opts.speaker(turn.speaker), text: turn.line, translation: turn.translation });
      const reply = play.replies?.[turn.id];
      if (typeof reply === 'string' && reply.trim() !== '') out.push({ kind: 'reply', turnId: turn.id, text: reply.trim() });
    }
  }
  return out;
}

/** Open word classes: a model alternative must share one with the story's word to be shown. */
const OPEN_CLASSES: ReadonlySet<Pos> = new Set<Pos>(['NOUN', 'PROPN', 'VERB', 'AUX', 'ADJ', 'ADV', 'NUM', 'INTJ']);

/** The word classes the pack gives a word (empty when it does not know the word). */
function classesOf(pack: Pick<LanguagePack, 'normalize' | 'analyze'>, word: string): Set<Pos> {
  const norm = pack.normalize(word.trim());
  return new Set(norm ? pack.analyze(norm).map((a) => a.pos) : []);
}

/**
 * True when a model alternative can stand in the story word's slot, judged by word class
 * (the next-word search only sees the words before the gap, so it proposes articles and
 * prepositions that would continue the sentence, not fill the gap: 'Pancho tiene ___.'
 * gets 'tu', 'el', 'mi'). The alternative must share an open class (noun, verb,
 * adjective, adverb, number, interjection) with the story's word; a story word of closed
 * classes only (a determiner or pronoun) gets no model alternative; when the pack does not
 * know the story's word, the alternative needs an open class or to be unknown too.
 */
export function alternativeFits(pack: Pick<LanguagePack, 'normalize' | 'analyze'>, expected: string, alternative: string): boolean {
  const want = classesOf(pack, expected);
  const have = classesOf(pack, alternative);
  if (want.size === 0) return have.size === 0 || [...have].some((c) => OPEN_CLASSES.has(c));
  for (const c of want) if (OPEN_CLASSES.has(c) && have.has(c)) return true;
  return false;
}

/**
 * Other natural answers for the feedback: the listed ones (accept) first, then the model's
 * alternatives at or above `floor` that fit the slot (alternativeFits), never the story's
 * words or the learner's answer, no duplicates (loose comparison), at most `max`.
 */
export function feedbackAlternatives(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents' | 'analyze'>,
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
  for (const a of args.model) if (a.prob >= args.floor && alternativeFits(pack, args.expected, a.word)) add(a.word);
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
