/**
 * Validation of authored series (PairPack.tracks and PairPack.library), for data tests of
 * every pair: the contract of docs/STORY-FORMAT.md, the language-neutral layer, and that
 * every story resolves (resolveVariants) to playable lines in every combination of the
 * learner's address and the track's choices. Language-neutral: words are located with
 * LanguagePack.segment, as the session does.
 */
import type { LanguagePack } from '../lang/types';
import type { LibraryStory, LibraryTrack } from '../pair/types';
import { locateAnswer } from '../session/cliff';
import { looseText } from '../session/common';
import { LIBRARY_TIERS } from './library';
import { isSyllabusId } from './syllabus';
import { allVariantContexts, hasUnresolved, resolveStory, stringsOf, variantKeys } from './variants';

/** One problem found, with where it is ('en-es.lib.pr.e1 e1.l03'). */
export interface LibraryIssue {
  where: string;
  message: string;
}

export interface ValidateLibraryOptions {
  /** Lines per story (the design: 10-16). */
  minLines: number;
  maxLines: number;
  /** Plot beats per story (4-8). */
  minBeats: number;
  maxBeats: number;
  /** Episodes per series (8). */
  maxEpisode: number;
  /** Check id formats 'e<episode>.l<nn>' and 'e<episode>.t<nn>'. */
  idFormat: boolean;
}

export const DEFAULT_VALIDATE_LIBRARY_OPTIONS: Readonly<ValidateLibraryOptions> = {
  minLines: 10,
  maxLines: 16,
  minBeats: 4,
  maxBeats: 8,
  maxEpisode: 8,
  idFormat: true,
};

const DIALECTS = new Set(['mx', 'ar', 'pe', 'cr', 'pr', 'co']);

const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === '';

/** Problems of the track list itself. */
export function validateTracks(tracks: readonly LibraryTrack[]): LibraryIssue[] {
  const out: LibraryIssue[] = [];
  const ids = new Set<string>();
  for (const t of tracks) {
    const where = t.id || '(track)';
    if (blank(t.id)) out.push({ where, message: 'track id is empty' });
    if (ids.has(t.id)) out.push({ where, message: 'duplicate track id' });
    ids.add(t.id);
    for (const f of ['title', 'tagline', 'city', 'country', 'setting'] as const) if (blank(t[f])) out.push({ where, message: `${f} is empty` });
    if (!DIALECTS.has(t.dialect)) out.push({ where, message: `unknown dialect ${String(t.dialect)}` });
    const cast = Array.isArray(t.cast) ? t.cast : [];
    if (!Array.isArray(t.cast)) out.push({ where, message: 'cast is missing' });
    const castIds = new Set<string>();
    for (const c of cast) {
      if (blank(c.id) || castIds.has(c.id)) out.push({ where, message: `cast id "${c.id}" is empty or duplicate` });
      castIds.add(c.id);
      for (const f of ['role', 'quirk', 'name'] as const) if (blank(c[f])) out.push({ where, message: `cast ${c.id}: ${f} is empty` });
    }
    const keys = new Set<string>();
    for (const c of t.choices ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.key) || c.key === 'you' || keys.has(c.key)) out.push({ where, message: `choice key "${c.key}" is invalid, 'you' or duplicate` });
      keys.add(c.key);
      if (blank(c.prompt)) out.push({ where, message: `choice ${c.key}: prompt is empty` });
      if (c.options.length < 2) out.push({ where, message: `choice ${c.key}: fewer than two options` });
      const optIds = new Set<string>();
      for (const o of c.options) {
        if (blank(o.id) || optIds.has(o.id)) out.push({ where, message: `choice ${c.key}: option id "${o.id}" is empty or duplicate` });
        optIds.add(o.id);
        if (blank(o.label)) out.push({ where, message: `choice ${c.key}: option ${o.id} has no label` });
        if (o.gender !== 'm' && o.gender !== 'f') out.push({ where, message: `choice ${c.key}: option ${o.id} gender must be m or f` });
      }
    }
  }
  return out;
}

/**
 * Problems of one story (with its track, when known): structure, the neutral layer, and
 * every variant combination resolving to lines whose cliff can be located after the
 * first word, with two distractors that differ from the answer.
 */
export function validateStory(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  story: LibraryStory,
  track: LibraryTrack | undefined,
  opts: Partial<ValidateLibraryOptions> = {},
): LibraryIssue[] {
  const o: ValidateLibraryOptions = { ...DEFAULT_VALIDATE_LIBRARY_OPTIONS, ...opts };
  const out: LibraryIssue[] = [];
  const sid = story.id || '(story)';
  const add = (where: string, message: string): void => {
    out.push({ where: where ? `${sid} ${where}` : sid, message });
  };
  if (blank(story.id)) add('', 'story id is empty');
  if (!track) add('', `unknown track ${story.track}`);
  if (!Number.isInteger(story.episode) || story.episode < 1 || story.episode > o.maxEpisode) add('', `episode ${story.episode} is not 1-${o.maxEpisode}`);
  if (!LIBRARY_TIERS.includes(story.tier)) add('', `unknown tier ${String(story.tier)}`);
  if (!Number.isInteger(story.level) || story.level < 0 || story.level > 5) add('', `level ${story.level} is not 0-5`);
  if (blank(story.title) || blank(story.titleNative)) add('', 'title or titleNative is empty');
  const beats = Array.isArray(story.beats) ? story.beats : [];
  if (beats.length < o.minBeats || beats.length > o.maxBeats) add('', `${beats.length} beats (want ${o.minBeats}-${o.maxBeats})`);
  if (beats.some(blank)) add('', 'a beat is empty');
  const functions = Array.isArray(story.functions) ? story.functions : [];
  if (functions.length === 0) add('', 'no syllabus functions');
  for (const f of functions) if (!isSyllabusId(f)) add('', `unknown syllabus id ${f}`);
  const n = story.sentences.length;
  if (n < o.minLines || n > o.maxLines) add('', `${n} lines (want ${o.minLines}-${o.maxLines})`);

  // Variant keys must be 'you' or a choice of the track.
  const allowed = new Set(['you', ...(track?.choices ?? []).map((c) => c.key)]);
  for (const s of stringsOf(story)) for (const k of variantKeys(s.text)) if (!allowed.has(k)) add(s.path, `unknown variant key "${k}"`);

  const lineIds = new Set<string>();
  story.sentences.forEach((line, i) => {
    const where = line.id || `line ${i}`;
    if (blank(line.id) || lineIds.has(line.id)) add(where, 'line id is empty or duplicate');
    lineIds.add(line.id);
    if (o.idFormat && !new RegExp(`^e${story.episode}\\.l\\d{2}$`).test(line.id ?? '')) add(where, `line id should look like e${story.episode}.l${String(i + 1).padStart(2, '0')}`);
    if (blank(line.intent)) add(where, 'intent is empty');
    if (line.function !== undefined && !isSyllabusId(line.function)) add(where, `unknown syllabus id ${line.function}`);
    if (blank(line.translation)) add(where, 'translation is empty');
    if (blank(line.cliff?.concept)) add(where, 'cliff.concept is empty');
    if (!Array.isArray(line.cliff?.distractors) || line.cliff.distractors.length !== 2) add(where, 'cliff needs exactly two distractors');
  });
  const turnIds = new Set<string>();
  (story.turns ?? []).forEach((t, i) => {
    const where = t.id || `turn ${i}`;
    if (blank(t.id) || turnIds.has(t.id) || lineIds.has(t.id)) add(where, 'turn id is empty or duplicate');
    turnIds.add(t.id);
    if (o.idFormat && !new RegExp(`^e${story.episode}\\.t\\d{2}$`).test(t.id ?? '')) add(where, `turn id should look like e${story.episode}.t${String(i + 1).padStart(2, '0')}`);
    if (blank(t.intent)) add(where, 'intent is empty');
    if (t.function !== undefined && !isSyllabusId(t.function)) add(where, `unknown syllabus id ${t.function}`);
    if (!Number.isInteger(t.after) || t.after < 0 || t.after >= n) add(where, `after ${t.after} is not a line index`);
    for (const f of ['speaker', 'line', 'translation', 'example'] as const) if (blank(t[f])) add(where, `${f} is empty`);
  });

  // Every combination of address and choices resolves and stays playable.
  const reported = new Set<string>();
  const once = (where: string, message: string): void => {
    const k = `${where}|${message}`;
    if (reported.has(k)) return;
    reported.add(k);
    add(where, message);
  };
  for (const ctx of allVariantContexts(track)) {
    const r = resolveStory(story, ctx);
    for (const s of stringsOf(r)) if (hasUnresolved(s.text)) once(s.path, `unresolved braces: ${s.text}`);
    r.sentences.forEach((line, i) => {
      const where = line.id || `line ${i}`;
      const word = line.cliff?.word ?? '';
      const span = locateAnswer(pack, line.text, word);
      if (!span) once(where, `cliff word "${word}" is not in the line after its first word: ${line.text}`);
      const key = looseText(pack, word);
      const ds = line.cliff?.distractors ?? [];
      for (const d of ds) if (looseText(pack, d) === key || (line.cliff.accept ?? []).some((a) => looseText(pack, a) === looseText(pack, d))) once(where, `distractor "${d}" is the answer or an accepted answer`);
      if (ds.length === 2 && looseText(pack, ds[0] ?? '') === looseText(pack, ds[1] ?? '')) once(where, 'the two distractors are the same');
      for (const a of line.cliff?.accept ?? []) if (looseText(pack, a) === key) once(where, `accept "${a}" repeats the cliff word`);
    });
  }
  return out;
}

/**
 * Problems of a whole library: the tracks, every story, and per track no episode written
 * twice in the same tier. [] when everything is playable.
 */
export function validateLibrary(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>,
  content: { tracks?: readonly LibraryTrack[]; library?: readonly LibraryStory[] },
  opts: Partial<ValidateLibraryOptions> = {},
): LibraryIssue[] {
  const tracks = content.tracks ?? [];
  const out = validateTracks(tracks);
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const story of content.library ?? []) {
    if (ids.has(story.id)) out.push({ where: story.id, message: 'duplicate story id' });
    ids.add(story.id);
    const slot = `${story.track}#${story.episode}#${story.tier}`;
    if (slots.has(slot)) out.push({ where: story.id, message: `episode ${story.episode} (${story.tier}) of ${story.track} is written twice` });
    slots.add(slot);
    out.push(...validateStory(pack, story, tracks.find((t) => t.id === story.track), opts));
  }
  return out;
}
