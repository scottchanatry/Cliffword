/**
 * Library view fixtures (names start with 'lib-'): one StoryViewModel per screen of an experience (the Story home, each
 * cliff mode, feedback by the model and by matching, "no sé", a character's question and its
 * reply, a line deep in an episode under the story so far, the end of an episode and of the
 * experience), for the dev preview gallery and the view tests. Each carries the story so far
 * (vm.transcript) as the session gave it at that screen. Screens come from real engine StorySession steps on the pair's first playable
 * experience (Living in San Juan), canned or with the deterministic mock model, so they always
 * match the engine's types, wording and the series as written.
 *
 * Target-language text here is content (data), not interface text.
 */
import {
  LearnerModel,
  StorySession,
  type EpisodeTranscript,
  type LanguageModel,
  type LanguagePack,
  type LibraryStart,
  type PairPack,
  type StoryScreen,
  type StoryStep,
} from '@cliffword/engine';
import type { StoryViewModel } from '../../../session/contract';
import { viewModel } from '../fixtures';

export const LIBRARY_FIXTURE_NAMES = [
  'lib-home',
  'lib-home-progress',
  'lib-recall-playing',
  'lib-recall-gap',
  'lib-recall-listening',
  'lib-hint',
  'lib-hint-missed',
  'lib-predict',
  'lib-feedback',
  'lib-feedback-model',
  'lib-feedback-wrong',
  'lib-nose',
  'lib-turn',
  'lib-turn-reply',
  'lib-story-so-far',
  'lib-episode-done',
  'lib-track-done',
] as const;

export type LibraryFixtureName = (typeof LIBRARY_FIXTURE_NAMES)[number];
export type LibraryFixtures = Record<LibraryFixtureName, StoryViewModel>;

export function isLibraryFixtureName(name: string): name is LibraryFixtureName {
  return (LIBRARY_FIXTURE_NAMES as readonly string[]).includes(name);
}

export interface LibraryFixtureDeps {
  lang: LanguagePack;
  pair: PairPack;
  /** The deterministic mock model (services/defaults sharedMockModel). */
  model: LanguageModel;
}

const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);

function answerOf(s: StorySession): string {
  const state = s.snapshot().state as { current?: { cliff?: { answer?: string } } | null };
  return state.current?.cliff?.answer ?? '';
}

function session(deps: LibraryFixtureDeps, start: LibraryStart, model: LanguageModel | null): StorySession {
  return StorySession.create({ model, pack: deps.lang, pair: deps.pair, learner: new LearnerModel(), now: T0, seed: 7, library: start });
}

function expectKind<K extends StoryScreen['kind']>(screen: StoryScreen, kind: K): Extract<StoryScreen, { kind: K }> {
  if (screen.kind !== kind) throw new Error(`library fixture: expected a ${kind} screen, got ${screen.kind}`);
  return screen as Extract<StoryScreen, { kind: K }>;
}

/**
 * Answer every cliff right (picked or said), reply to every turn, until the screen `until`.
 * `custom` may take a step first (null: the default one).
 */
async function playUntil(
  s: StorySession,
  until: (screen: StoryScreen) => boolean,
  ...rest: [at: () => number] | [custom: (s: StorySession) => Promise<StoryStep | null>, at: () => number]
): Promise<StoryStep> {
  const [custom, at] = rest.length === 2 ? rest : [null, rest[0]];
  let step: StoryStep = { screen: s.screen, events: [] };
  for (let guard = 0; guard < 600; guard++) {
    const screen = step.screen;
    if (until(screen)) return step;
    const own = custom ? await custom(s) : null;
    if (own) {
      step = own;
      continue;
    }
    if (screen.kind === 'cliff') {
      if (screen.phase === 'playing') step = s.played(at());
      else step = await s.handleUtterance(answerOf(s), at());
    } else if (screen.kind === 'turn' && !screen.example && !screen.reply) {
      step = await s.handleUtterance('Sí, gracias.', at());
    } else {
      step = await s.next(at());
    }
  }
  throw new Error('library fixture: the screen never came');
}

/** Builds every fixture by running engine sessions. */
export async function buildLibraryFixtures(deps: LibraryFixtureDeps): Promise<LibraryFixtures> {
  const trackId = (deps.pair.tracks ?? []).find((t) => (deps.pair.library ?? []).some((x) => x.track === t.id))?.id;
  if (!trackId) throw new Error('library fixture: the pair has no playable experience');
  let clock = T0;
  const at = () => (clock += 4000);
  const vm = (s: StorySession, screen: StoryScreen | null, over: Partial<StoryViewModel> = {}) =>
    viewModel(screen, { library: s.libraryProgress, view: 'episode', modelMode: 'canned', micLatched: false, spokenTodayMs: 0, transcript: null, ...over });
  /** The story so far as the session has it now (the fixtures are built later). */
  const sofar = (s: StorySession): { transcript: EpisodeTranscript | null } => ({ transcript: s.libraryTranscript });

  // Recall (level 0), canned: the line plays, then the gap with three options.
  const recall = session(deps, { trackId, startLevel: 0, address: 'f' }, null);
  const home = vm(recall, recall.screen, { view: 'home' });
  const playing = expectKind((await recall.next(at())).screen, 'cliff');
  const playingT = sofar(recall);
  const gap = expectKind(recall.played(at()).screen, 'cliff');
  const right = gap.cliff.options?.find((o) => o.text === answerOf(recall));
  const feedback = expectKind((await recall.pickOption(right?.index ?? 0, at())).screen, 'landing');
  const feedbackT = sofar(recall);
  // A wrong pick on the next line.
  await recall.next(at());
  const gap2 = expectKind(recall.played(at()).screen, 'cliff');
  const wrongOption = gap2.cliff.options?.find((o) => o.text !== answerOf(recall));
  const wrong = expectKind((await recall.pickOption(wrongOption?.index ?? 0, at())).screen, 'landing');
  const wrongT = sofar(recall);
  // The first character's question, a reply, then the episode's end.
  const turnStep = await playUntil(recall, (x) => x.kind === 'turn', at);
  const turn = expectKind(turnStep.screen, 'turn');
  const turnT = sofar(recall);
  const reply = expectKind((await recall.handleUtterance('Sí, muy bien.', at())).screen, 'turn');
  const replyT = sofar(recall);
  const done = expectKind((await playUntil(recall, (x) => x.kind === 'episodeDone', at)).screen, 'episodeDone');

  // Deep in episode 1: the gap of line 12 under the story so far (lines, questions, replies).
  const deep = session(deps, { trackId, startLevel: 0, address: 'f' }, null);
  const replies = ['Estoy cansada.', 'Me llamo Alex. Mucho gusto.', 'No entiendo. ¿Puedes repetir?'];
  let asked = 0;
  await deep.next(at());
  const deepStep = await playUntil(deep, (x) => x.kind === 'cliff' && x.phase === 'gap' && x.meta.library?.line === 12, async (s) => {
    const screen = s.screen;
    if (screen.kind === 'turn' && !screen.reply && !screen.example) return s.handleUtterance(replies[asked++] ?? 'Sí.', at());
    return null;
  }, at);
  const storySoFar = vm(deep, expectKind(deepStep.screen, 'cliff'), sofar(deep));
  const homeProgress = vm(recall, (await recall.next(at())).screen, { view: 'home' });

  // Hint (level 2): the English with the word in bold; a miss brings the options.
  const hintSession = session(deps, { trackId, startLevel: 2, address: 'm' }, null);
  const hint = expectKind((await hintSession.next(at())).screen, 'cliff');
  const missed = expectKind((await hintSession.handleUtterance('mesa', at())).screen, 'cliff');

  // Predict (level 4) with the model: a said answer, checked by the model.
  const predictSession = session(deps, { trackId, startLevel: 4, address: 'm' }, deps.model);
  const predict = expectKind((await predictSession.next(at())).screen, 'cliff');
  const byModel = expectKind((await predictSession.handleUtterance(answerOf(predictSession), at())).screen, 'landing');
  await predictSession.next(at());
  await predictSession.command('dont_know', at());
  const nose = expectKind((await predictSession.command('dont_know', at())).screen, 'noSe');

  // Every episode: the experience is done.
  const all = session(deps, { trackId, startLevel: 0, address: 'm' }, null);
  await all.next(at());
  const trackDone = expectKind((await playUntil(all, (x) => x.kind === 'trackDone', at)).screen, 'trackDone');

  return {
    'lib-home': home,
    'lib-home-progress': homeProgress,
    'lib-recall-playing': vm(recall, playing, { speakingWord: 1, ...playingT }),
    'lib-recall-gap': vm(recall, gap, playingT),
    'lib-recall-listening': vm(recall, gap, { listen: { phase: 'listening', level: 0.6, partial: answerOf(recall) }, micLatched: true, ...playingT }),
    'lib-hint': vm(hintSession, hint),
    'lib-hint-missed': vm(hintSession, missed),
    'lib-predict': vm(predictSession, predict, { modelMode: 'model' }),
    'lib-feedback': vm(recall, feedback, feedbackT),
    'lib-feedback-model': vm(predictSession, byModel, { modelMode: 'model' }),
    'lib-feedback-wrong': vm(recall, wrong, wrongT),
    'lib-nose': vm(predictSession, nose, { modelMode: 'model' }),
    'lib-turn': vm(recall, turn, turnT),
    'lib-turn-reply': vm(recall, reply, replyT),
    'lib-story-so-far': storySoFar,
    'lib-episode-done': vm(recall, done),
    'lib-track-done': vm(all, trackDone),
  };
}

let cached: { deps: LibraryFixtureDeps; fixtures: Promise<LibraryFixtures> } | undefined;

/** buildLibraryFixtures, once per set of packs and model. */
export function libraryFixtures(deps: LibraryFixtureDeps): Promise<LibraryFixtures> {
  if (!cached || cached.deps.lang !== deps.lang || cached.deps.pair !== deps.pair || cached.deps.model !== deps.model) {
    cached = { deps, fixtures: buildLibraryFixtures(deps) };
  }
  return cached.fixtures;
}
