/**
 * Story view fixtures: one StoryViewModel per screen kind, for the dev preview gallery
 * (app/(dev)/preview/[screen].tsx) and the view tests. Screens come from real engine
 * StorySession steps (the deterministic mock model, or canned mode without a model) on a small
 * starter built from the design previews' market scene, so they always match the engine's
 * types and wording. States that are hard to reach in a few steps (placement done, an error,
 * listening, a notice) are the engine's screens with app-only state set by hand.
 *
 * Target-language text here is content (data), not interface text.
 */
import {
  cliffUi,
  hintFor,
  LearnerModel,
  StorySession,
  type LanguageModel,
  type LanguagePack,
  type PairPack,
  type PriorFn,
  type SentenceView,
  type StarterStory,
  type StoryScreen,
  type StoryStep,
} from '@cliffword/engine';
import type { StoryViewModel } from '../../session/contract';

/** The market scene of the Main, B1 and B2 previews, as a starter story. */
export const PREVIEW_STARTER: StarterStory = {
  id: 'preview.market',
  title: 'El mercado',
  character: 'Marta',
  taught: [],
  sentences: [
    { text: 'Marta llegó tarde al mercado.', answer: 'mercado', distractors: ['azul', 'feliz'], translation: 'Marta arrived late at the market.' },
    {
      text: 'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
      answer: 'cerrado',
      distractors: ['azul', 'alto'],
      translation: 'She looked for the fruit man, but his stall was closed.',
    },
    {
      text: 'Entonces vio una nota en la puerta y empezó a leerla en voz alta.',
      answer: 'leerla',
      distractors: ['reír', 'llorar'],
      accept: ['leer'],
      translation: 'Then she saw a note on the door and began to read it aloud.',
    },
  ],
  prompts: [{ line: '¿Y tú? ¿Qué hiciste ayer?' }],
};

/** The A2 preview's answer, with the ser/estar slip ("Soy muy cansado"). */
export const PREVIEW_TURN_ANSWER = 'Ayer fui a la playa con mis amigos. Soy muy cansado porque nadamos mucho.';

export const STORY_FIXTURE_NAMES = [
  // Previews
  'main',
  'b1',
  'b2',
  'a2',
  'b3',
  // Every other screen kind
  'retell',
  'noSe',
  'nativeReply',
  'turn',
  'register',
  'placementDone',
  'error',
  'loading',
  'idle',
  'upNext',
  // Variants
  'options',
  'hint',
  'landing',
  'repairHinted',
  'repairAnswer',
  'listening',
  'speaking',
  'meaning',
  'notice',
  'busy',
] as const;

export type StoryFixtureName = (typeof STORY_FIXTURE_NAMES)[number];
export type StoryFixtures = Record<StoryFixtureName, StoryViewModel>;

export function isStoryFixtureName(name: string): name is StoryFixtureName {
  return (STORY_FIXTURE_NAMES as readonly string[]).includes(name);
}

/** 08:00 UTC on the day the previews were drawn: fixtures never depend on the clock. */
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);

/** App-only state of a view model around an engine screen. */
export function viewModel(screen: StoryScreen | null, over: Partial<StoryViewModel> = {}): StoryViewModel {
  return {
    screen,
    listen: { phase: 'idle' },
    busy: false,
    modelMode: 'model',
    meaning: null,
    spokenTodayMs: 252000,
    notice: null,
    speakingWord: null,
    textMode: 'auto',
    ...over,
  };
}

/** Reader prior (Main): knows every word except "puesto", but not yet by ear, and speaks well (free rung). */
const readerPrior: PriorFn = (key, skill) => (skill === 'sound' ? 0.2 : key === 'es:puesto' ? 0.1 : 0.9);
/** Listener prior (B1): knows the words by ear (tiles) except the meaning of "puesto". */
const listenerPrior: PriorFn = (key, skill) => (key === 'es:puesto' && skill === 'meaning' ? 0.1 : 0.9);

function expectKind<K extends StoryScreen['kind']>(step: StoryStep, kind: K): Extract<StoryScreen, { kind: K }> {
  if (step.screen.kind !== kind) throw new Error(`story fixture: expected a ${kind} screen, got ${step.screen.kind}`);
  return step.screen as Extract<StoryScreen, { kind: K }>;
}

function answerOf(s: StorySession): string {
  const state = s.snapshot().state as { current?: { cliff?: { answer?: string } } | null };
  return state.current?.cliff?.answer ?? '';
}

/** Word timings of a retell round: the scene's words (from the pack's segmenter) with pauses after the given word numbers. */
function retellWords(pack: LanguagePack, scene: string, pausesAfter: readonly number[], wordMs: number): { text: string; startMs: number; endMs: number }[] {
  const words = pack.segment(scene).filter((s) => s.kind === 'word' || s.kind === 'number');
  let t = 400;
  return words.map((w, i) => {
    const out = { text: w.text, startMs: t, endMs: t + wordMs };
    t += wordMs + (pausesAfter.includes(i) ? 1400 : 120);
    return out;
  });
}

export interface StoryFixtureDeps {
  lang: LanguagePack;
  pair: PairPack;
  /** The deterministic mock model (services/defaults sharedMockModel). */
  model: LanguageModel;
}

/** Builds every fixture by running engine sessions (a few seconds with the mock model). */
export async function buildStoryFixtures({ lang, pair, model }: StoryFixtureDeps): Promise<StoryFixtures> {
  const p: PairPack = { ...pair, starter: PREVIEW_STARTER };
  let t = T0;
  const at = () => (t += 1500);

  // The cliffs run on the starter (canned mode, as before the model is loaded) so the text is
  // the previews'; the model is set before an answer is scored, so landings have their line.
  // Ink: a reader, mostly text (Main), then a landing with a shadowed line.
  const ink = StorySession.create({ model: null, pack: lang, pair: p, learner: new LearnerModel({ prior: readerPrior }), now: T0, seed: 7, startMode: 'continue' });
  const idle = ink.screen;
  const inkPrev: SentenceView[] = [];
  for (let i = 0; i < 2; i++) {
    expectKind(await ink.next(at()), 'cliff');
    inkPrev.push(expectKind(await ink.handleUtterance(answerOf(ink), at(), { durationMs: 900 }), 'landing').sentence);
  }
  const main = expectKind(await ink.next(at()), 'cliff');
  const hint = hintFor(answerOf(ink));
  const hintScreen: StoryScreen = { ...main, cliff: { ...main.cliff, rung: 'hint', hint, ui: cliffUi('hint', hint) } };
  ink.setModel(model);
  expectKind(await ink.handleUtterance('leer', at(), { durationMs: 700 }), 'landing');
  const inkLanding = expectKind(
    await ink.handleUtterance('Entonces vio una nota en la puerta y empezó a leer en voz alta', at(), { durationMs: 4200 }),
    'landing',
  );

  // Voice: a listener, mostly tiles (B1), "puesto" held to see; then B2, the turn (A2) and the retell (B3).
  const voice = StorySession.create({ model: null, pack: lang, pair: p, learner: new LearnerModel({ prior: listenerPrior }), now: T0, seed: 7, startMode: 'continue' });
  // This listener chose "Hide text" (all tiles), as in B1; held words and answered cliffs still show.
  voice.setSettings({ textMode: 'all_tiles' }, at());
  const voicePrev: SentenceView[] = [];
  for (let i = 0; i < 2; i++) {
    const cliff = expectKind(await voice.next(at()), 'cliff');
    const puesto = cliff.sentence.words.find((w) => w.text === 'puesto');
    if (puesto) voice.revealWord(puesto.index, at());
    voicePrev.push(expectKind(await voice.handleUtterance(answerOf(voice), at(), { durationMs: 900 }), 'landing').sentence);
  }
  const b1 = expectKind(await voice.next(at()), 'cliff');
  voice.setModel(model);
  const b2Step = await voice.handleUtterance('leer', at(), { durationMs: 700 });
  const b2 = expectKind(b2Step, 'landing');
  const meaning = (await voice.command('meaning', at())).meaning ?? null;
  const turn = expectKind(await voice.next(at()), 'turn');
  const a2 = expectKind(await voice.handleUtterance(PREVIEW_TURN_ANSWER, at(), { durationMs: 5200 }), 'repair');
  const repairAnswer = expectKind(await voice.handleUtterance('Soy muy cansado.', at(), { durationMs: 1800 }), 'repair');
  const upNext = expectKind(await voice.next(at()), 'upNext');
  const retellStart = expectKind(await voice.next(at()), 'retell');
  const round1 = retellWords(lang, retellStart.scene, [4, 10, 15, 19, 23], 520);
  const b3 = expectKind(await voice.handleUtterance('', at(), { durationMs: 30000, words: round1 }), 'retell');
  const round2 = retellWords(lang, retellStart.scene, [12], 420);
  expectKind(await voice.handleUtterance('', at(), { durationMs: 20000, words: round2 }), 'retell');
  const round3 = retellWords(lang, retellStart.scene, [], 380);
  const retellDone = expectKind(await voice.handleUtterance('', at(), { durationMs: 15000, words: round3 }), 'retell');

  // Canned (no model yet): a brand-new learner on the options rung, no sé, an answer in English.
  const canned = StorySession.create({ model: null, pack: lang, pair: p, learner: new LearnerModel(), now: T0, seed: 7, startMode: 'brand_new' });
  const options = expectKind(await canned.next(at()), 'cliff');
  expectKind(await canned.command('dont_know', at()), 'noSe');
  canned.played(at());
  const noSe = expectKind(await canned.handleUtterance('mesa', at(), { durationMs: 600 }), 'noSe');
  expectKind(await canned.command('next', at()), 'cliff');
  const nativeReply = expectKind(await canned.handleUtterance('closed', at(), { durationMs: 700 }), 'nativeReply');

  // Register switching at the top of the frequency list.
  const reg = StorySession.create({ model, pack: lang, pair: p, learner: new LearnerModel({ prior: listenerPrior }), now: T0, seed: 7, startMode: 'continue' });
  expectKind(await reg.next(at()), 'cliff');
  const regTask = expectKind(await reg.startRegisterTask(at()), 'register');
  const register = expectKind(await reg.handleUtterance(regTask.task.expected, at(), { durationMs: 1500 }), 'register');

  // Hand-made: a hinted repair (a 1-3 nat margin), placement done, an error.
  const repairHinted: StoryScreen = {
    ...a2,
    phase: 'hinted',
    highlight: 8,
    said: a2.said.map((w, i) => ({ ...w, heat: i === 8 ? 1 : 0 })),
    expected: 'Estoy muy cansado.',
    ui: { key: 'repair.expected', params: { expected: 'Estoy muy cansado.' } },
    explanation: null,
    explainKey: null,
    done: true,
  };
  const meta = main.meta;
  const placementDone: StoryScreen = { kind: 'placementDone', meta: { ...meta, mode: 'placement' }, vocabulary: 1850, thresholdRank: 2048, items: 14 };
  const error: StoryScreen = { kind: 'error', meta, ui: { key: 'story.noSentence' } };

  const voicePassage = { previous: voicePrev, textMode: 'all_tiles' as const };
  return {
    main: viewModel(main, { previous: inkPrev }),
    b1: viewModel(b1, voicePassage),
    b2: viewModel(b2, { spokenTodayMs: 255000, textMode: 'all_tiles' }),
    a2: viewModel(a2, { spokenTodayMs: 303000 }),
    b3: viewModel(b3, { spokenTodayMs: 400000, listen: { phase: 'listening', level: 0.5, partial: '' } }),
    retell: viewModel(retellDone, { spokenTodayMs: 460000 }),
    noSe: viewModel(noSe, { modelMode: 'canned' }),
    nativeReply: viewModel(nativeReply, { modelMode: 'canned' }),
    turn: viewModel(turn, { spokenTodayMs: 290000 }),
    register: viewModel(register),
    placementDone: viewModel(placementDone),
    error: viewModel(error),
    loading: viewModel(null),
    idle: viewModel(idle),
    upNext: viewModel(upNext),
    options: viewModel(options, { modelMode: 'canned', spokenTodayMs: 0 }),
    hint: viewModel(hintScreen, { previous: inkPrev }),
    landing: viewModel(inkLanding, { previous: inkPrev }),
    repairHinted: viewModel(repairHinted, { spokenTodayMs: 303000 }),
    repairAnswer: viewModel(repairAnswer, { spokenTodayMs: 310000 }),
    listening: viewModel(b1, { ...voicePassage, listen: { phase: 'listening', level: 0.7, partial: 'leerla en' } }),
    speaking: viewModel(b1, { ...voicePassage, speakingWord: 3 }),
    meaning: viewModel(b2, { meaning, textMode: 'all_tiles' }),
    notice: viewModel(main, { previous: inkPrev, notice: { key: 'error.speechUnavailable' } }),
    busy: viewModel(b1, { ...voicePassage, busy: true }),
  };
}

let cached: { deps: StoryFixtureDeps; fixtures: Promise<StoryFixtures> } | undefined;

/** buildStoryFixtures, once per set of packs and model. */
export function storyFixtures(deps: StoryFixtureDeps): Promise<StoryFixtures> {
  if (!cached || cached.deps.lang !== deps.lang || cached.deps.pair !== deps.pair || cached.deps.model !== deps.model) {
    cached = { deps, fixtures: buildStoryFixtures(deps) };
  }
  return cached.fixtures;
}
