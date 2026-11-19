/**
 * Living in San Juan played through StorySession the way the app plays it: the real en-es
 * pair pack (its library and tracks, not a fixture), every episode in order, canned (no
 * model) and with the deterministic mock model, for a learner addressed as a man and as a
 * woman, answering correctly.
 *
 * For every run: no stall (each step leads to a playable screen within a bounded number
 * of actions), no '{', '}' or variant token on any screen or speech cue, every cliff
 * answerable in its mode (recall: the story word is among the three options, tapping or
 * saying it gets full credit; hint: the gloss is found in the translation and saying the
 * word gets credit; predict: saying the story word gets credit), the lines and turns in
 * the written order, episodeDone after each of the eight episodes and trackDone at the end.
 */
import { describe, expect, it } from 'vitest';
import { resolveStory, variantContext } from '../../../content/variants';
import { LearnerModel } from '../../../learner/model';
import { createMockModel } from '../../../model/mock';
import { createDefaultPairPack, createDefaultSpanishPack } from '../../../packs';
import { StorySession } from '../../../session/story';
import type { CliffMode, LearnerAddress, StoryScreen, StoryStep } from '../../../session/types';
import type { LibraryStory } from '../../types';
import { LIVING_STORIES, LIVING_TRACK } from './living';

const pack = createDefaultSpanishPack();
/** The app's pair pack: createDefaultPairPack() carries EN_ES_LIBRARY and EN_ES_TRACKS. */
const pair = createDefaultPairPack();
const model = createMockModel();
const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);
const TRACK = LIVING_TRACK.id;
const LINES = LIVING_STORIES.reduce((n, s) => n + s.sentences.length, 0);
const TURNS = LIVING_STORIES.reduce((n, s) => n + (s.turns?.length ?? 0), 0);

/** Every string inside a screen or a speech cue. */
function stringsOf(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) stringsOf(v, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) stringsOf(v, out);
  return out;
}

/** Nothing the learner sees or hears may carry a variant token or a stray brace. */
function expectClean(step: StoryStep | StoryScreen, where: string): void {
  const all = stringsOf(step);
  const bad = all.filter((t) => /[{}]/.test(t) || /\b(you|partner)[:.][a-z]/i.test(t));
  expect(bad, where).toEqual([]);
}

type Policy = 'say' | 'tap';
interface Run {
  name: string;
  startLevel: number;
  /** Keep the learner at this level (set again after every episode), or let the level rule move it. */
  pin: number | null;
  policy: Policy;
  /** Expected cliff mode per episode (1-8). */
  modes: CliffMode[];
  /** Also play it with the mock model (each such run takes a few seconds). */
  withModel: boolean;
}

const RUNS: Run[] = [
  { name: 'brand new, says or types every word: the level climbs through all three modes', startLevel: 0, pin: null, policy: 'say', modes: ['recall', 'recall', 'hint', 'hint', 'predict', 'predict', 'predict', 'predict'], withModel: true },
  { name: 'brand new, taps the right option every time: recall all along', startLevel: 0, pin: null, policy: 'tap', modes: Array(8).fill('recall'), withModel: false },
  { name: 'a little (level 2), every episode in hint mode', startLevel: 2, pin: 2, policy: 'say', modes: Array(8).fill('hint'), withModel: false },
  { name: 'comfortable (level 4), every episode in predict mode', startLevel: 4, pin: 4, policy: 'say', modes: Array(8).fill('predict'), withModel: true },
];

interface Played {
  lineIds: string[];
  turnIds: string[];
  episodes: { episode: number; cliffs: number; unaided: number; correct: number; levelBefore: number; levelAfter: number }[];
  modes: CliffMode[];
  texts: string[];
  trackDone: Extract<StoryScreen, { kind: 'trackDone' }> | null;
}

async function playSeries(run: Run, withModel: boolean, address: LearnerAddress): Promise<Played> {
  const stories = new Map<number, LibraryStory>(LIVING_STORIES.map((s) => [s.episode, resolveStory(s, variantContext(LIVING_TRACK, address))]));
  const s = StorySession.create({
    model: withModel ? model : null,
    pack,
    pair,
    learner: new LearnerModel(),
    now: T0,
    seed: 5,
    library: { trackId: TRACK, startLevel: run.startLevel, address },
  });
  expect(s.playsLibrary).toBe(true);
  expect(s.libraryProgress).toMatchObject({ track: TRACK, address, level: run.startLevel });
  const out: Played = { lineIds: [], turnIds: [], episodes: [], modes: [], texts: [], trackDone: null };
  let t = T0;
  let step = await s.next((t += 1000));
  for (let guard = 0; ; guard++) {
    expect(guard, 'stalled').toBeLessThan(LINES * 3 + TURNS * 3 + 40);
    expectClean(step, `step ${guard}`);
    const sc = step.screen;
    expect(['cliff', 'turn', 'episodeDone', 'trackDone'], `screen ${sc.kind} after ${out.lineIds.at(-1)}`).toContain(sc.kind);
    if (sc.kind === 'trackDone') {
      out.trackDone = sc;
      break;
    }
    if (sc.kind === 'episodeDone') {
      out.episodes.push({ episode: sc.episode, cliffs: sc.cliffs, unaided: sc.unaided, correct: sc.correct, levelBefore: sc.levelBefore, levelAfter: sc.levelAfter });
      if (run.pin !== null) expectClean(s.setLibraryProfile({ level: run.pin }, (t += 10)), 'setLibraryProfile');
    } else if (sc.kind === 'turn') {
      const ep = sc.meta.library?.episode ?? 0;
      const turn = stories.get(ep)?.turns?.find((x) => x.line === sc.prompt.line);
      expect(turn, `turn "${sc.prompt.line}" in episode ${ep}`).toBeDefined();
      out.turnIds.push(turn?.id ?? '?');
      out.texts.push(sc.prompt.line, sc.translation ?? '');
      const r = await s.handleUtterance(turn?.example ?? 'Sí.', (t += 1000));
      expectClean(r, `turn ${turn?.id}`);
      expect(['turn', 'repair'], `after turn ${turn?.id}`).toContain(r.screen.kind);
      // The example answer is accepted, and the screen says so before showing the example.
      if (r.screen.kind === 'turn') expect(r.screen.reply, `${turn?.id} canned reply`).toMatchObject({ accepted: true, scoredBy: 'canned', ui: { key: 'turn.accepted' } });
      if (r.screen.kind === 'repair' && r.screen.phase === 'ok') expect(r.screen.ui, `${turn?.id} model reply`).toEqual({ key: 'turn.accepted' });
    } else if (sc.kind === 'cliff') {
      const meta = sc.meta.library;
      const id = meta?.lineId ?? '?';
      const ep = meta?.episode ?? 0;
      const line = stories.get(ep)?.sentences.find((x) => x.id === id);
      expect(line, `line ${id} in episode ${ep}`).toBeDefined();
      if (!line) break;
      out.lineIds.push(`e${ep}:${id}`);
      out.modes.push(sc.mode ?? 'recall');
      out.texts.push(line.text, line.translation);
      // The answer as it stands in the line (a sentence-initial word is capitalized).
      const answer = s.snapshot().state.current?.cliff.answer ?? '';
      expect(answer.toLocaleLowerCase('es'), `${id} answer`).toBe(line.cliff.word.toLocaleLowerCase('es'));
      let c = sc;
      if (c.mode === 'recall') {
        expect(c.phase).toBe('playing');
        expect(step.speak?.text, `${id} is played complete`).toBe(line.text);
        const gap = s.played((t += 500));
        expectClean(gap, `${id} gap`);
        expect(gap.screen.kind).toBe('cliff');
        if (gap.screen.kind !== 'cliff') break;
        c = gap.screen;
        expect(c.phase).toBe('gap');
        const options = c.cliff.options?.map((o) => o.text) ?? [];
        expect(options, `${id} options`).toHaveLength(3);
        expect(options, `${id} options`).toContain(answer);
      } else if (c.mode === 'hint') {
        expect(c.translation).toBe(line.translation);
        expect(c.translationHint, `${id} hint "${line.cliff.hint}" in "${line.translation}"`).toMatchObject({ found: true });
      } else {
        expect(c.translation ?? null).toBeNull();
      }
      let r: StoryStep;
      if (run.policy === 'tap' && c.mode === 'recall') {
        const opt = c.cliff.options?.find((o) => o.text === answer);
        r = await s.pickOption(opt?.index ?? -1, (t += 1000));
      } else {
        r = await s.handleUtterance(answer, (t += 1000));
      }
      expectClean(r, `${id} landing`);
      const landing = r.screen;
      expect(landing.kind, `${id} answered "${answer}"`).toBe('landing');
      if (landing.kind === 'landing') {
        expect(landing.outcome.credit, `${id} credit for "${answer}"`).toBe('full');
        expect(landing.expected).toBe(answer);
        expect(landing.translation).toBe(line.translation);
        expect(landing.alternatives?.length ?? 0).toBeLessThanOrEqual(3);
        if (withModel && run.policy === 'say') expect(landing.scoredBy, id).toBe('model');
      }
    }
    step = await s.next((t += 1000));
  }
  expect(s.libraryProgress?.tracks.find((x) => x.id === TRACK)).toMatchObject({ completed: [1, 2, 3, 4, 5, 6, 7, 8], done: true, next: null });
  return out;
}

const expectedLineIds = LIVING_STORIES.flatMap((s) => s.sentences.map((l) => `e${s.episode}:${l.id}`));
const expectedTurnIds = LIVING_STORIES.flatMap((s) => (s.turns ?? []).map((x) => x.id));

describe('Living in San Juan through StorySession', () => {
  it('the app pack carries the series: six experiences, San Juan playable from episode 1, five coming soon', async () => {
    expect(pair.tracks?.map((x) => x.title)).toEqual([
      'Living in San Juan',
      'Mystery in Cartagena',
      'Dating in Buenos Aires',
      'Making friends in Mexico City',
      'Food lover in Lima',
      'Travel vlogger in Costa Rica',
    ]);
    expect(pair.library?.filter((x) => x.track === TRACK)).toHaveLength(8);
    const s = StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 1 });
    const progress = s.libraryProgress;
    expect(progress?.track).toBe(TRACK);
    expect(progress?.tracks.filter((x) => x.comingSoon).map((x) => x.title)).toEqual(pair.tracks?.slice(1).map((x) => x.title));
    expect(progress?.tracks[0]).toMatchObject({ id: TRACK, comingSoon: false, episodes: 8, next: 1, completed: [] });
    // A coming-soon experience cannot be started: the session stays in San Juan.
    const soon = StorySession.create({ model: null, pack, pair, learner: new LearnerModel(), now: T0, seed: 1, library: { trackId: 'en-es.track.dating' } });
    expect(soon.libraryProgress?.track).toBe(TRACK);
    const first = await s.next(T0 + 1);
    expect(first.screen.kind).toBe('cliff');
    expect(first.screen.meta.library).toMatchObject({ track: TRACK, episode: 1, line: 1, lineId: 'e1.l01', storyId: 'en-es.living.e1' });
  });

  for (const withModel of [false, true]) {
    for (const address of ['m', 'f'] as const) {
      for (const run of RUNS.filter((r) => r.withModel || !withModel)) {
        it(`${withModel ? 'mock model' : 'canned'}, addressed as ${address === 'm' ? 'a man' : 'a woman'}: ${run.name}`, async () => {
          const played = await playSeries(run, withModel, address);
          expect(played.lineIds).toEqual(expectedLineIds);
          expect(played.turnIds).toEqual(expectedTurnIds);
          expect(played.episodes.map((e) => e.episode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
          LIVING_STORIES.forEach((story, i) => {
            expect(played.episodes[i]?.cliffs).toBe(story.sentences.length);
            expect(played.episodes[i]?.unaided).toBe(run.policy === 'say' ? story.sentences.length : 0);
            // Tapped or said, every answer was right, and the summary says so.
            expect(played.episodes[i]?.correct).toBe(story.sentences.length);
          });
          // The mode of each episode follows the learner level.
          const perEpisode = LIVING_STORIES.map((story) => played.modes.filter((_, k) => played.lineIds[k]?.startsWith(`e${story.episode}:`)));
          perEpisode.forEach((modes, i) => expect(new Set(modes), `episode ${i + 1}`).toEqual(new Set([run.modes[i]])));
          if (run.pin === null && run.policy === 'say') expect(played.episodes.map((e) => e.levelAfter)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
          if (run.policy === 'tap') expect(played.episodes.every((e) => e.levelAfter === 0)).toBe(true);
          expect(played.trackDone).toMatchObject({ track: TRACK, title: 'Living in San Juan', episodes: 8, suggestions: [] });
          // The learner's address reaches every line: feminine forms for a woman, masculine for a man.
          const text = played.texts.join(' ');
          if (address === 'f') {
            expect(text).toMatch(/\bvecina\b/);
            expect(text).toMatch(/\bcansada\b/);
            expect(text).not.toMatch(/\b(cansado|Bienvenido|vecino|amigos)\b/);
          } else {
            expect(text).toMatch(/\bvecino\b/);
            expect(text).toMatch(/\bcansado\b/);
            expect(text).not.toMatch(/\b(cansada|Bienvenida|amigas)\b/); // 'la vecina' is Doña Mari
          }
        }, 60_000);
      }
    }
  }
});
