/**
 * StorySession: the Story tab as a pure, deterministic state machine the app drives.
 *
 * The app calls step functions (next, handleUtterance, command, pickOption, tapWord,
 * revealWord, played) and renders the plain-data screen each returns. Every step also
 * returns the learner events it produced, already applied to the session's learner, for
 * the app to persist in the same transaction as snapshot(). Time is passed in (ms since
 * epoch) and randomness is seeded, so the same inputs give the same session.
 *
 * Flow (BRIEF "Product" and "Levels")
 * -----------------------------------
 * 1. Sentence: targets (chooseTargets) and settings (deriveParams on estimateVocabulary
 *    and recent performance) drive generateNextSentence; a few positions are rated
 *    (cliffPositions) and pickCliff chooses the cliff; cliffRungFor gives the rung and
 *    showText the text or tile of each word. Starter content (PairPack.starter) is used
 *    at zero knowledge, without a model (canned mode), and whenever generation or cliff
 *    choice fails, so there is always a next step.
 * 2. Utterance at the cliff: spoken commands first (matchCommand: again, slower, no sé,
 *    next, done, meaning), then native-language words (nativeReply), then the answer is
 *    scored (scoreLyricAnswer, which is scoreCliffAnswer plus street tolerance; without
 *    a model, string and form match) and lands (buildOutcome).
 * 3. After a chapter of sentences: a learner turn (a story character asks; judgeAttempt
 *    and repairFlow: self-repair before a fix), then "Up next: retell" with rounds of
 *    60, 45 and 30 seconds (retellMetrics), then the next chapter.
 * 4. Placement (startMode 'placement') is the first story: probe cliffs from the
 *    frequency band PlacementTracker suggests, harder until the learner stalls; then the
 *    tracker's prior replaces the learner's. 'brand_new' skips it with the brandNew prior.
 * 5. At the top (no new frequency-list or slang word left) chapters still flow on
 *    practice targets, and "Up next" also offers register switching, brought text and
 *    lyric cliffs.
 *
 * Language-neutral: words come from LanguagePack.segment(), target-language data from
 * the packs, and display text is UiText (PairPack.ui keys).
 *
 * One step at a time
 * ------------------
 * An async step (next, handleUtterance, command, pickOption, startRegisterTask) can wait
 * for the model for seconds. While it runs, every other step call is refused, not queued:
 * it returns at once with refused: 'busy', the screen as it was before the running step
 * began and no events, and changes nothing (a queued tap or answer would land on whatever
 * screen the running step ends on). That holds for the synchronous calls too (tapWord,
 * revealWord, played, setSettings). Reads during a step see the state from before it:
 * snapshot(), screen, settings, prior and stageAt() never expose a half-done step, so a
 * snapshot taken while busy restores to the session as it was when the step began.
 * setModel() during a step is deferred until the step ends. A step that throws (a model
 * error) leaves the session as it was before the step, so the app can simply retry.
 */
import type { SpokenCommand } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { StarterSentence, StarterStory } from '../pair/types';
import type { CliffRung, DifficultyParams, LearnerEvent } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { LearnerModel } from '../learner/model';
import { cliffRungFor, deriveParams, estimateVocabulary, type RecentStats } from '../learner/difficulty';
import { PlacementTracker, bandOf, type PlacementOptions } from '../learner/placement';
import type { CliffPosition, CliffResult, NextWord } from '../scoring/types';
import { alternativesReusable, cliffPositions } from '../scoring/cliff';
import { scoringContext, slangExemption, slangIn } from '../scoring/context';
import { scoreWords } from '../scoring/wordScores';
import { chooseTargets } from '../story/targets';
import { generateNextSentence, type NextSentenceTuning } from '../story/next';
import type { Pos } from '../lang/types';
import { pickCliff, rankCliffPositions, type CliffPickOptions } from '../story/cliffPick';
import { matchCommand, type CommandOptions } from '../speaking/commands';
import { alignTranscript } from '../speaking/align';
import { nativeReply, type NativeReply } from '../speaking/native';
import { advanceNoSe, startNoSe, type NoSeOptions, type NoSeState } from '../speaking/noSe';
import {
  attemptRepair,
  isRepairFinal,
  repairEvents,
  repairFlow,
  startRepair,
  type RepairOptions,
  type RepairState,
} from '../speaking/repair';
import { RETELL_LANES, retellCoverage, retellMetrics, retellProgress, retellRoundUi, type TimedWord } from '../speaking/retell';
import { creditedMs } from '../speaking/spokenTime';
import { scoreLyricAnswer, type LyricEquivalence } from '../lyrics/cliffs';
import { registerPairs } from '../lyrics/slang';
import { applicableRegisters } from '../lyrics/text';
import {
  DEFAULT_LANDING_OPTIONS,
  DEFAULT_OPTION_CHOICE_OPTIONS,
  arrangeOptions,
  buildOutcome,
  cannedResult,
  chooseDistractors,
  cliffUi,
  locateAnswer,
  optionResult,
  type LandingOptions,
  type OptionChoiceOptions,
} from './cliff';
import {
  alignmentView,
  buildPrior,
  cleanEvents,
  effectiveRate,
  finitePositive,
  hintFor,
  joinSentences,
  leadAfter,
  looseText,
  plain,
  resolveSessionSettings,
  rng,
  sameWords,
  seedFor,
} from './common';
import { DEFAULT_VIEW_OPTIONS, buildSentenceView, sentenceWords, type SentenceWord, type ViewOptions } from './view';
import { DEFAULT_HANDOVER_OPTIONS, bridgeFamiliar, handoverStage, type HandoverOptions, type StoryStage } from './handover';
import { ModelGate } from './prefetch';
import {
  STORY_SESSION_FORMAT,
  type AdvancedTask,
  type CliffOutcome,
  type CliffPrompt,
  type MeaningView,
  type PlacementNews,
  type PriorSpec,
  type RegisterTaskView,
  type RetellRoundView,
  type SaidWord,
  type SentenceView,
  type SessionDeps,
  type SessionSettings,
  type SpeakCue,
  type StartMode,
  type StoryMeta,
  type StoryScreen,
  type StoryStep,
  type UiText,
  type UtteranceInfo,
} from './types';

/** Tunable numbers of a story session. See DEFAULT_STORY_SESSION_OPTIONS for the reasoning. */
export interface StorySessionOptions {
  /** Sentences per chapter of generated story before the learner turn and the retell. */
  sentencesPerChapter: number;
  /** Story sentences in the scoring context and the generation prompt. */
  contextSentences: number;
  /** Story sentences kept in the snapshot (repeat checks look at the last few). */
  keepSentences: number;
  /** Word positions rated per sentence when choosing a cliff (each costs a next-word search). */
  cliffPositions: number;
  /** Generated candidates tried for a cliff, in rank order, before falling back to starter content. */
  candidateTries: number;
  /** "Más despacio" multiplies the rate of this sentence by this. */
  slowerFactor: number;
  /** Slowest rate "más despacio" can reach. */
  minRate: number;
  /** Cliffs and sentences of recent performance fed to deriveParams. */
  recentWindow: number;
  /** Targets of this many recent sentences are not chosen again. */
  recentTargetSentences: number;
  /** Two targets per sentence when newWordsPerSentence reaches this; one otherwise. */
  twoTargetsFrom: number;
  /** Retell lanes in ms. */
  retellLanes: readonly number[];
  /** Placement tracker overrides. */
  placement: Partial<PlacementOptions>;
  /** A placement probe more than this many bands from the asked band ends placement instead. */
  placementBandGap: number;
  /** Parts of speech used as option distractors (they must be recognizable words). */
  distractorPos: readonly string[];
  /** Distractor candidates considered per cliff. */
  distractorPool: number;
  options: Partial<OptionChoiceOptions>;
  landing: Partial<LandingOptions>;
  view: Partial<ViewOptions>;
  noSe: Partial<NoSeOptions>;
  repair: Partial<RepairOptions>;
  command: Partial<CommandOptions>;
  cliffPick: Partial<CliffPickOptions>;
  /** Zero knowledge to generated story: the starter, the bridge, free generation (session/handover.ts). */
  handover: Partial<HandoverOptions>;
  /** Next-sentence generation tuning (story/next.ts DEFAULT_NEXT_SENTENCE_TUNING). */
  generation: Partial<NextSentenceTuning>;
}

/**
 * Defaults (judgement calls unless noted; calibrate from learner logs):
 * - sentencesPerChapter 6: the design's market scene is six sentences, two to three
 *   minutes at a beginner's pace, short enough to retell in a minute.
 * - contextSentences 4: the story module's prompt default (DEFAULT_CONTEXT_SENTENCES).
 * - keepSentences 12: the selector's repeat check looks at 8 (previousSentences).
 * - cliffPositions 3: the README's advice to pass a few positions; 3 searches are about
 *   150 model calls, and pickCliff still chooses among a target, a gap word and a late
 *   word. candidateTries 2: a second candidate rescues a sentence whose positions are
 *   all implausible, and bounds the cost at about 600 calls before the starter fallback
 *   (candidates with no eligible position at all cost nothing and are not counted).
 * - slowerFactor 0.8 and minRate 0.5: one "más despacio" is clearly slower; three reach
 *   half speed, below which synthetic speech distorts.
 * - recentWindow 10: about two to three minutes of cliffs.
 * - recentTargetSentences 3: a target is not asked for again in the next three sentences.
 * - twoTargetsFrom 1.5: the brief's "one or two new words"; two once the known-word band
 *   allows one and a half new words per sentence.
 * - retellLanes: the design's 60, 45 and 30 seconds (RETELL_LANES).
 * - placementBandGap 2: bands are factors of two in rank; a probe three bands from the
 *   asked one (eight times rarer or commoner) is almost surely known or unknown, so once
 *   only such probes are left placement ends with the estimate it has (a learner beyond
 *   the ladder, or below it). Two bands still probe the ladder's top (or bottom) a few
 *   times, so one lucky pick among options cannot end placement.
 * - distractorPos NOUN and ADJ: concrete words a learner recognizes and that rarely fit a
 *   slot by accident; checked against the model anyway. distractorPool 30.
 */
export const DEFAULT_STORY_SESSION_OPTIONS: Readonly<StorySessionOptions> = {
  sentencesPerChapter: 6,
  contextSentences: 4,
  keepSentences: 12,
  cliffPositions: 3,
  candidateTries: 2,
  slowerFactor: 0.8,
  minRate: 0.5,
  recentWindow: 10,
  recentTargetSentences: 3,
  twoTargetsFrom: 1.5,
  retellLanes: RETELL_LANES,
  placement: {},
  placementBandGap: 2,
  distractorPos: ['NOUN', 'ADJ'],
  distractorPool: 30,
  options: {},
  landing: {},
  view: {},
  noSe: {},
  repair: {},
  command: {},
  cliffPick: {},
  handover: {},
  generation: {},
};

type Phase = 'idle' | 'cliff' | 'landing' | 'noSe' | 'native' | 'turn' | 'repair' | 'upNext' | 'retell' | 'register' | 'placementDone';

/** The sentence on screen. Plain data (part of the snapshot). */
interface CurrentSentence {
  text: string;
  source: 'model' | 'starter' | 'probe';
  /** Index of the starter sentence or probe. */
  index: number | null;
  words: SentenceWord[];
  cliff: { wordIndex: number; length: number; start: number; end: number; answer: string; key: string };
  /** Scoring context right before the cliff (prefix included). */
  context: string;
  /** The same without the scoring prefix. */
  before: string;
  rung: CliffRung;
  options: { text: string; natural: boolean; prob: number | null }[] | null;
  hint: string | null;
  alternatives: NextWord[];
  actualProb: number | null;
  accept: string[];
  targets: string[];
  translation: string | null;
  params: DifficultyParams;
  slow: number;
  replays: number;
  tapped: number[];
  revealed: number[];
  probe: { key: string; rank: number } | null;
  outcome: CliffOutcome | null;
  resolved: boolean;
  finished: boolean;
}

interface NativeState {
  heard: string;
  target: string | null;
  phrases: { native: string; target: string | null }[];
  keys: string[];
  landed: boolean;
  repeat: ReturnType<typeof alignmentView> | null;
}

interface TurnState {
  speaker: string;
  line: string;
  repair: RepairState;
  said: SaidWord[];
  native: { heard: string; target: string | null } | null;
}

interface RetellState {
  round: number;
  scene: string;
  results: RetellRoundView[];
  stats: { wordsPerMinute: number; pauseCount: number }[];
}

interface RegisterState extends RegisterTaskView {
  keys: string[];
}

/** Everything a story session holds, as plain data. */
export interface StoryState {
  seed: number;
  steps: number;
  startMode: StartMode;
  settings: SessionSettings;
  prior: PriorSpec;
  /** The prior changed and the app has not been told yet. */
  priorPending: boolean;
  placement: { tracker: ReturnType<PlacementTracker['snapshot']>; done: boolean; probed: string[] } | null;
  story: string[];
  chapter: number;
  chapterSentences: string[];
  /** The chapter is the starter story (its length is the starter's). */
  starterChapter: boolean;
  starterUsed: number[];
  starterCursor: number;
  probesUsed: number[];
  /** Target lexemes generated sentences introduced, most recent last (the bridge vocabulary). */
  introduced: string[];
  recentTargets: string[][];
  outcomes: number[];
  replays: number[];
  frontier: 'open' | 'exhausted';
  phase: Phase;
  current: CurrentSentence | null;
  noSe: NoSeState | null;
  native: NativeState | null;
  turn: TurnState | null;
  retell: RetellState | null;
  register: RegisterState | null;
  promptIndex: number;
  spokenMs: number;
  screen: StoryScreen;
}

/** What StorySession.prefetch prepared. */
export interface PrefetchInfo {
  /** True when the prepared step shows a new sentence (a cliff screen). */
  prepared: boolean;
  /** Model calls the prefetch made (answers kept for next()). */
  modelCalls: number;
  /** Kind of the screen next() would show, or null when nothing was prepared. */
  next: StoryScreen['kind'] | null;
}

export interface StorySessionSnapshot {
  format: typeof STORY_SESSION_FORMAT;
  kind: 'story';
  state: StoryState;
}

export interface StorySessionCreate extends SessionDeps {
  /** Time the session starts (ms since epoch). */
  now: number;
  seed: number;
  settings?: Partial<SessionSettings>;
  /** 'continue' (default) for a learner who has used the app before. */
  startMode?: StartMode;
  /** Apply events to the learner (default true). Turn off when the app applies persisted events itself. */
  applyEvents?: boolean;
  options?: Partial<StorySessionOptions>;
}

const CONTENT_ROLE_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

function mergeOptions(o: Partial<StorySessionOptions> = {}): StorySessionOptions {
  return { ...DEFAULT_STORY_SESSION_OPTIONS, ...o };
}

function idleMeta(): StoryMeta {
  return { chapter: 1, title: '', sentence: 0, spokenMs: 0, mode: 'story', canned: true };
}

export class StorySession {
  private deps: SessionDeps;
  private readonly state: StoryState;
  private readonly o: StorySessionOptions;
  private readonly applyEvents: boolean;
  private busy = false;
  /** The state as it was when the running step began (reads while busy, and the rollback of a failed step). */
  private stable: StoryState | null = null;
  /** A model set while a step ran, applied when it ends. */
  private pendingModel: { model: LanguageModel | null } | null = null;
  private lemmaCache: { lemma: string; key: string; pos: string | null; rank: number }[] | null = null;
  /** Every model call of this session goes through the gate (one at a time; prefetched answers replayed). */
  private gate: ModelGate | null = null;
  private prefetching: Promise<PrefetchInfo> | null = null;

  private constructor(
    deps: SessionDeps,
    state: StoryState,
    opts: { applyEvents?: boolean; options?: Partial<StorySessionOptions>; gated?: boolean },
  ) {
    this.deps = { ...deps };
    this.state = state;
    // Snapshots from before the bridge have no introduced list.
    if (!Array.isArray(this.state.introduced)) this.state.introduced = [];
    this.o = mergeOptions(opts.options);
    this.applyEvents = opts.applyEvents !== false;
    if (opts.gated !== false) this.useModel(deps.model);
  }

  /**
   * Route the model through a fresh gate (null: canned mode). The old gate is retired (a
   * prefetch still running on it fails at its next call) and the new one starts after the
   * old one's queue, so model calls never overlap across a model switch.
   */
  private useModel(model: LanguageModel | null): void {
    // A prefetch still running on the old gate stops at its next call.
    this.gate?.retire();
    const previous = this.gate?.idle();
    this.gate = model ? new ModelGate(model, previous) : null;
    this.deps = { ...this.deps, model: this.gate ? this.gate.replay() : null };
  }

  /**
   * A new session. 'brand_new' gives the learner the brandNew prior (cognates probably
   * known, nothing else) and starts with the starter story; 'placement' runs placement
   * inside the first story. Nothing is generated until next().
   */
  static create(c: StorySessionCreate): StorySession {
    const startMode: StartMode = c.startMode ?? 'continue';
    const settings = resolveSessionSettings(c.settings);
    const opts = mergeOptions(c.options);
    const state: StoryState = {
      seed: c.seed >>> 0,
      steps: 0,
      startMode,
      settings,
      prior: startMode === 'brand_new' ? { kind: 'brandNew' } : { kind: 'default' },
      priorPending: startMode === 'brand_new',
      placement: startMode === 'placement' ? { tracker: new PlacementTracker(opts.placement).snapshot(), done: false, probed: [] } : null,
      story: [],
      chapter: 1,
      chapterSentences: [],
      starterChapter: false,
      starterUsed: [],
      starterCursor: 0,
      probesUsed: [],
      introduced: [],
      recentTargets: [],
      outcomes: [],
      replays: [],
      frontier: 'open',
      phase: 'idle',
      current: null,
      noSe: null,
      native: null,
      turn: null,
      retell: null,
      register: null,
      promptIndex: 0,
      spokenMs: 0,
      screen: { kind: 'idle', meta: idleMeta() },
    };
    const session = new StorySession(c, state, { applyEvents: c.applyEvents, options: c.options });
    if (startMode === 'brand_new') session.replacePrior();
    state.screen = { kind: 'idle', meta: session.meta() };
    return session;
  }

  /**
   * Rebuild a session from snapshot(). Pass the learner as the app stored it (with the
   * prior of the latest step's `prior`). Throws on a snapshot of another format or kind.
   */
  static restore(
    snapshot: StorySessionSnapshot,
    deps: SessionDeps,
    opts: { applyEvents?: boolean; options?: Partial<StorySessionOptions> } = {},
  ): StorySession {
    if (!snapshot || snapshot.format !== STORY_SESSION_FORMAT || snapshot.kind !== 'story' || !snapshot.state) {
      throw new Error('StorySession.restore: unsupported snapshot');
    }
    return new StorySession(deps, plain(snapshot.state), opts);
  }

  /**
   * JSON-serializable snapshot of the whole session (not the learner, which the app
   * stores). While a step runs it is the session as it was before that step.
   */
  snapshot(): StorySessionSnapshot {
    return { format: STORY_SESSION_FORMAT, kind: 'story', state: plain(this.readState()) };
  }

  /** The current screen (while a step runs: the screen before it). */
  get screen(): StoryScreen {
    return plain(this.readState().screen);
  }

  /** The learner the session updates (replaced when placement or brand_new set a prior). */
  get learner(): LearnerModel {
    return this.deps.learner;
  }

  get settings(): SessionSettings {
    return plain(this.readState().settings);
  }

  get prior(): PriorSpec {
    return plain(this.readState().prior);
  }

  /** True while a step runs; other step calls are then refused (see the module comment). */
  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Switch between canned mode (null) and a model; takes effect at the next sentence.
   * Drops a prefetch. Called while a step runs, it takes effect when that step ends.
   */
  setModel(model: LanguageModel | null): void {
    if (this.busy) {
      this.pendingModel = { model };
      return;
    }
    this.useModel(model);
  }

  /**
   * The stage the next story sentence would come from at time `at`: the pair's starter,
   * generation on the bridge vocabulary, or free generation (session/handover.ts).
   */
  stageAt(at: number): StoryStage {
    return this.stage(at, this.readState());
  }

  /** Model calls so far: made, answered from a prefetch, made by prefetches. */
  get modelStats(): { calls: number; replayed: number; prefetched: number } {
    const g = this.gate;
    return { calls: g?.calls ?? 0, replayed: g?.replayed ?? 0, prefetched: g?.recordedCalls ?? 0 };
  }

  /**
   * Prepare the next step while the learner is still on the current screen (the landing
   * or no-sé screen): run what next(at) would do on a copy of the session and keep every
   * model answer, so that next() replays them instead of waiting for the model.
   *
   * - Determinism: next() recomputes everything (targets, settings, prompts, cliffs) from
   *   the learner and the time it is given, and only reuses answers to identical model
   *   requests, which a deterministic model gives again. The same seed gives the same
   *   story whether or not prefetch ran.
   * - Learner changes in between (an answer, a tap, a reveal on the landing screen) that
   *   change the choice make different requests, which go to the model: nothing stale is
   *   ever shown. Changes that do not change the requests reuse the answers.
   * - snapshot() never holds prefetched answers and restore() starts without them; next()
   *   after a restore makes the requests itself and shows the same sentence.
   * - setModel() drops the answers. A second prefetch replaces the first; next() waits for
   *   a running prefetch. Model calls of the prefetch and of other steps never overlap.
   * Does nothing while a step runs or without a model (canned steps are instant).
   */
  async prefetch(at: number): Promise<PrefetchInfo> {
    const gate = this.gate;
    if (!gate) return { prepared: false, modelCalls: 0, next: null };
    if (this.prefetching) return this.prefetching;
    if (this.busy) return { prepared: false, modelCalls: 0, next: null };
    gate.clear();
    const ghost = new StorySession({ ...this.deps, model: gate.record() }, plain(this.state), {
      applyEvents: false,
      options: this.o,
      gated: false,
    });
    ghost.lemmaCache = this.lemmaCache;
    const before = gate.recordedCalls;
    const run = (async (): Promise<PrefetchInfo> => {
      try {
        const step = await ghost.advance(at);
        return { prepared: step.screen.kind === 'cliff', modelCalls: gate.recordedCalls - before, next: step.screen.kind };
      } catch {
        // A failed prefetch only costs the replay: next() asks the model itself.
        return { prepared: false, modelCalls: gate.recordedCalls - before, next: null };
      } finally {
        this.prefetching = null;
      }
    })();
    this.prefetching = run;
    return run;
  }

  // -------------------------------------------------------------------------
  // Step functions
  // -------------------------------------------------------------------------

  /** Move on: the next sentence, the next activity, or the next chapter (see the module comment). */
  async next(at: number): Promise<StoryStep> {
    return this.run(async () => this.advanceStep(at));
  }

  /**
   * advance() for the session's own steps (next, and the next / done commands): after a
   * running prefetch, replaying its answers, which are dropped afterwards.
   */
  private async advanceStep(at: number): Promise<StoryStep> {
    if (this.prefetching) await this.prefetching;
    try {
      return await this.advance(at);
    } finally {
      this.gate?.clear();
    }
  }

  /**
   * Route a recognized utterance: a spoken command first, then native-language words,
   * then whatever the current screen waits for (a cliff answer, a repeat, the learner's
   * sentence, a retell round, a register switch).
   */
  async handleUtterance(transcript: string, at: number, info: UtteranceInfo = {}): Promise<StoryStep> {
    return this.run(async () => {
      this.state.spokenMs += creditedMs(finitePositive(info.durationMs));
      return this.route(transcript, at, info);
    });
  }

  /** A spoken command from a chip or the recognizer. */
  async command(cmd: SpokenCommand, at: number, argument?: string): Promise<StoryStep> {
    return this.run(async () => this.doCommand(cmd, at, argument, {}));
  }

  /** The learner picked option `index` on the options rung. */
  async pickOption(index: number, at: number): Promise<StoryStep> {
    return this.run(async () => this.chooseOption(index, at));
  }

  /** The no-sé answer (or a native target phrase) finished playing. */
  played(at: number): StoryStep {
    if (this.busy) return this.refused();
    if (this.state.phase === 'noSe' && this.state.noSe) {
      this.state.noSe = advanceNoSe(this.state.noSe, { type: 'played' }, this.deps.pack, this.noSeOpts());
      this.state.screen = this.noSeScreen(at);
    }
    return this.step([]);
  }

  /** Tap a word: hear it again (tap_rehear). Hidden and masked words cannot be tapped. */
  tapWord(index: number, at: number): StoryStep {
    if (this.busy) return this.refused();
    const cur = this.state.current;
    const w = cur?.words[index];
    if (!cur || !w || !this.visible(index)) return this.step([]);
    if (!cur.tapped.includes(index)) cur.tapped.push(index);
    const events: LearnerEvent[] = w.lemma !== null && w.kind === 'word' ? [{ type: 'tap_rehear', key: w.key, at }] : [];
    return this.step(events, { speak: { text: w.text, rate: this.rate(), what: 'word' } });
  }

  /** Hold a word: see it (hold_reveal); it stays text for the rest of the sentence. */
  revealWord(index: number, at: number): StoryStep {
    if (this.busy) return this.refused();
    const cur = this.state.current;
    const w = cur?.words[index];
    if (!cur || !w || !this.visible(index)) return this.step([]);
    if (!cur.revealed.includes(index)) cur.revealed.push(index);
    const events: LearnerEvent[] = w.lemma !== null && w.kind === 'word' ? [{ type: 'hold_reveal', key: w.key, at }] : [];
    this.rerender(at);
    return this.step(events);
  }

  /**
   * Change settings. Text mode and explicit masking redraw the current sentence at once;
   * register, regions and the rate bias apply from the next sentence (the current one
   * was generated and scored under the old ones).
   */
  setSettings(change: Partial<SessionSettings>, at: number): StoryStep {
    if (this.busy) return this.refused();
    this.state.settings = resolveSessionSettings(change, this.state.settings);
    this.rerender(at);
    return this.step([]);
  }

  /** Start a register-switching task now (offered at the top; usable any time). */
  async startRegisterTask(at: number): Promise<StoryStep> {
    return this.run(async () => this.registerTask(at));
  }

  // -------------------------------------------------------------------------
  // Internals: running steps and events
  // -------------------------------------------------------------------------

  /**
   * Run one async step: refused while another runs; the state before it is kept for reads
   * during the step and restored if the step throws.
   */
  private async run(fn: () => Promise<StoryStep>): Promise<StoryStep> {
    if (this.busy) return this.refused();
    this.busy = true;
    const before = plain(this.state);
    this.stable = before;
    try {
      return await fn();
    } catch (e) {
      // Nothing of a failed step stays: the app can retry it on the same state.
      for (const k of Object.keys(this.state)) delete (this.state as unknown as Record<string, unknown>)[k];
      Object.assign(this.state, before);
      throw e;
    } finally {
      this.busy = false;
      this.stable = null;
      const pending = this.pendingModel;
      this.pendingModel = null;
      if (pending) this.useModel(pending.model);
    }
  }

  /** The state reads see: the state before the running step while busy. */
  private readState(): StoryState {
    return this.busy && this.stable ? this.stable : this.state;
  }

  /** A refused call (StepRefusal): nothing changes. */
  private refused(): StoryStep {
    return { screen: plain(this.readState().screen), events: [], refused: 'busy' };
  }

  /** Apply events to the learner and wrap the current screen into a step. */
  private step(events: readonly LearnerEvent[], extra: Partial<Omit<StoryStep, 'screen' | 'events'>> = {}): StoryStep {
    const clean = cleanEvents(events);
    if (this.applyEvents && clean.length) this.deps.learner.applyAll(clean);
    const out: StoryStep = { screen: plain(this.state.screen), events: clean, ...extra };
    if (this.state.priorPending) {
      out.prior = plain(this.state.prior);
      out.learnerReplaced = true;
      this.state.priorPending = false;
    }
    return out;
  }

  /** Rebuild the learner with the prior of state.prior, keeping its memory. */
  private replacePrior(): void {
    const prior = buildPrior(this.state.prior, this.deps.pack, this.deps.pair);
    this.deps = { ...this.deps, learner: LearnerModel.restore(this.deps.learner.snapshot(), prior ? { prior } : {}) };
    this.state.priorPending = true;
  }

  private get starter(): StarterStory | undefined {
    return this.deps.pair.starter;
  }

  private frequencyKeys(): string[] {
    return (this.deps.pack.frequencyList ?? []).map((l) => lexemeKey(this.deps.pack.code, l));
  }

  /** Slang lexemes of the applicable register packs (explicit ones only when shown). */
  private slangKeys(): string[] {
    const out = new Set<string>();
    for (const reg of applicableRegisters(this.deps.pack, this.state.settings.regions)) {
      for (const e of reg.entries) if (e.lemma && (this.state.settings.showExplicit || !e.explicit)) out.add(lexemeKey(this.deps.pack.code, e.lemma));
    }
    return [...out];
  }

  private recentStats(): RecentStats | undefined {
    const w = this.o.recentWindow;
    const outs = this.state.outcomes.slice(-w);
    const reps = this.state.replays.slice(-w);
    if (outs.length === 0 && reps.length === 0) return undefined;
    const stats: RecentStats = {
      successRate: outs.length ? outs.reduce((s, x) => s + x, 0) / outs.length : 0.8,
      replaysPerSentence: reps.length ? reps.reduce((s, x) => s + x, 0) / reps.length : 0.5,
    };
    return stats;
  }

  private params(at: number): DifficultyParams {
    const vocab = estimateVocabulary(this.deps.learner, at, this.frequencyKeys());
    return deriveParams({ vocab, recent: this.recentStats() });
  }

  private rate(): number {
    const cur = this.state.current;
    const derived = cur?.params.speechRate ?? 1;
    return effectiveRate(derived, this.state.settings.speechRateBias, cur?.slow ?? 1, this.o.minRate);
  }

  private nextSeed(): number {
    return seedFor(this.state.seed, this.state.steps++);
  }

  private placementActive(): boolean {
    return this.state.placement !== null && !this.state.placement.done;
  }

  private meta(): StoryMeta {
    const cur = this.state.current;
    return {
      chapter: this.state.chapter,
      title: this.state.starterChapter ? this.starter?.title ?? '' : '',
      sentence: this.state.chapterSentences.length,
      spokenMs: this.state.spokenMs,
      mode: this.placementActive() ? 'placement' : cur && cur.source !== 'model' && this.state.starterChapter ? 'starter' : 'story',
      canned: this.deps.model === null,
    };
  }

  private noSeOpts(): Partial<NoSeOptions> {
    return { register: this.state.settings.register, regions: this.state.settings.regions, ...this.o.noSe };
  }

  private regOpts(): { register: SessionSettings['register']; regions: readonly string[] } {
    return { register: this.state.settings.register, regions: this.state.settings.regions };
  }

  private visible(index: number): boolean {
    const cur = this.state.current;
    if (!cur) return false;
    const w = cur.words[index];
    if (!w || (w.explicit && !this.state.settings.showExplicit)) return false;
    if (cur.resolved) return true;
    return index < cur.cliff.wordIndex;
  }

  private view(at: number): SentenceView {
    const cur = this.state.current as CurrentSentence;
    return buildSentenceView(
      cur.text,
      cur.words,
      { cliff: { wordIndex: cur.cliff.wordIndex, length: cur.cliff.length, answered: cur.resolved }, revealed: cur.revealed },
      {
        pack: this.deps.pack,
        pair: this.deps.pair,
        learner: this.deps.learner,
        now: at,
        params: cur.params,
        settings: this.state.settings,
        rate: this.rate(),
        options: { ...DEFAULT_VIEW_OPTIONS, ...this.o.view },
      },
    );
  }

  private cliffPrompt(): CliffPrompt {
    const cur = this.state.current as CurrentSentence;
    const p: CliffPrompt = {
      wordIndex: cur.cliff.wordIndex,
      length: cur.cliff.length,
      rung: cur.rung,
      ui: cliffUi(cur.rung, cur.hint ?? undefined),
      nativeAllowed: this.state.settings.nativeAnswersAllowed,
    };
    if (cur.rung === 'options' && cur.options) p.options = cur.options.map((x, index) => ({ index, text: x.text }));
    if (cur.rung === 'hint' && cur.hint) p.hint = cur.hint;
    return p;
  }

  /** Redraw the screen of the current sentence (settings or a revealed word changed). */
  private rerender(at: number): void {
    const s = this.state.screen;
    const cur = this.state.current;
    if (!cur) return;
    if (s.kind === 'cliff') this.state.screen = { kind: 'cliff', meta: this.meta(), sentence: this.view(at), cliff: this.cliffPrompt() };
    else if (s.kind === 'landing') this.state.screen = { ...s, meta: this.meta(), sentence: this.view(at) };
    else if (s.kind === 'noSe') this.state.screen = { ...s, meta: this.meta(), sentence: this.view(at) };
  }

  private speakUpToCliff(): SpeakCue {
    const cur = this.state.current as CurrentSentence;
    return { text: cur.text.slice(0, cur.cliff.start).trimEnd(), rate: this.rate(), what: 'sentence' };
  }

  // -------------------------------------------------------------------------
  // Advancing
  // -------------------------------------------------------------------------

  private async advance(at: number): Promise<StoryStep> {
    const s = this.state;
    const events: LearnerEvent[] = [];
    let news: PlacementNews | undefined;
    switch (s.phase) {
      case 'cliff': {
        // "Siguiente" at a cliff: skip it without the no-sé repeat.
        const cur = s.current as CurrentSentence;
        events.push({ type: 'cliff_skip', key: cur.cliff.key, at });
        s.outcomes.push(0);
        news = this.recordProbe(false);
        cur.resolved = true;
        break;
      }
      case 'upNext':
        return this.startRetell(at);
      case 'retell':
        if (s.retell && s.retell.round < this.o.retellLanes.length) {
          s.retell.round = this.o.retellLanes.length;
          this.state.screen = this.retellScreen();
          return this.step([]);
        }
        s.retell = null;
        this.newChapter();
        break;
      case 'turn':
      case 'repair':
        // A finished repair flow already sent its events; an unfinished one has none.
        s.turn = null;
        return this.toUpNext(events);
      default:
        break;
    }
    events.push(...this.finishSentence(at));
    s.noSe = null;
    s.native = null;
    s.register = null;
    if (this.placementActive() && this.tracker().done) return this.finishPlacement(at, events, news);
    if (!this.placementActive() && s.phase !== 'placementDone' && this.chapterComplete()) return this.chapterEnd(events);
    return this.prepareSentence(at, events, news);
  }

  private chapterComplete(): boolean {
    const limit = this.state.starterChapter ? this.starter?.sentences.length ?? this.o.sentencesPerChapter : this.o.sentencesPerChapter;
    return this.state.chapterSentences.length >= limit;
  }

  private newChapter(): void {
    this.state.chapter += 1;
    this.state.chapterSentences = [];
    this.state.starterChapter = false;
  }

  /** heard / read events for the words of the finished sentence the learner moved past without help. */
  private finishSentence(at: number): LearnerEvent[] {
    const cur = this.state.current;
    if (!cur || cur.finished) return [];
    cur.finished = true;
    this.state.replays.push(cur.replays);
    this.state.recentTargets.push([...cur.targets]);
    this.state.recentTargets = this.state.recentTargets.slice(-this.o.recentTargetSentences);
    const view = this.view(at);
    const events: LearnerEvent[] = [];
    const seen = new Set<string>();
    for (const w of cur.words) {
      if (w.kind !== 'word' || w.lemma === null || w.pos === 'PROPN') continue;
      const inCliff = w.index >= cur.cliff.wordIndex && w.index < cur.cliff.wordIndex + cur.cliff.length;
      if (inCliff || cur.tapped.includes(w.index) || cur.revealed.includes(w.index) || seen.has(w.key)) continue;
      const d = view.words[w.index]?.display;
      if (d !== 'text' && d !== 'tile') continue;
      seen.add(w.key);
      events.push({ type: d === 'text' ? 'read' : 'heard', key: w.key, at });
    }
    return events;
  }

  private async chapterEnd(events: LearnerEvent[]): Promise<StoryStep> {
    const prompts = this.starter?.prompts ?? [];
    if (this.deps.model && prompts.length > 0) {
      const p = prompts[this.state.promptIndex % prompts.length] as { line: string; speaker?: string };
      this.state.promptIndex += 1;
      const speaker = p.speaker ?? this.starter?.character ?? '';
      this.state.turn = { speaker, line: p.line, repair: startRepair(), said: [], native: null };
      this.state.phase = 'turn';
      this.state.screen = { kind: 'turn', meta: this.meta(), prompt: { speaker, line: p.line }, ui: { key: 'story.asks', params: { speaker } } };
      return this.step(events, { speak: { text: p.line, rate: this.rate(), what: 'prompt' } });
    }
    return this.toUpNext(events);
  }

  private toUpNext(events: LearnerEvent[]): StoryStep {
    this.state.phase = 'upNext';
    const advanced: AdvancedTask[] = this.state.frontier === 'exhausted' ? ['register_switch', 'brought_text', 'lyrics'] : [];
    this.state.screen = { kind: 'upNext', meta: this.meta(), next: 'retell', advanced };
    return this.step(events);
  }

  // -------------------------------------------------------------------------
  // Preparing a sentence
  // -------------------------------------------------------------------------

  private async prepareSentence(at: number, events: LearnerEvent[], news?: PlacementNews): Promise<StoryStep> {
    let cur: CurrentSentence | null = null;
    if (this.placementActive()) {
      cur = await this.probeSentence(at);
      if (!cur) return this.finishPlacement(at, events, news);
    } else if (this.useStarter(at)) {
      cur = await this.starterSentence(at, false);
    } else if (this.deps.model) {
      cur = await this.modelSentence(this.deps.model, at);
    }
    // Never stall, never loop early: unused starter sentences, then unused ladder
    // sentences, then (only then) the starter again, least recently used first.
    if (!cur && !this.placementActive()) cur = await this.starterSentence(at, false);
    if (!cur && !this.placementActive()) cur = await this.unusedProbeSentence(at);
    if (!cur && !this.placementActive()) cur = await this.starterSentence(at, true);
    if (!cur && this.deps.model && !this.placementActive()) cur = await this.modelSentence(this.deps.model, at);
    if (!cur) cur = await this.lastResortSentence(at);
    if (!cur) {
      // Nothing to show (no starter content and the model gave nothing usable): next() tries again.
      this.state.phase = 'idle';
      this.state.screen = { kind: 'error', meta: this.meta(), ui: { key: 'story.noSentence' } };
      return this.step(events, news ? { placement: news } : {});
    }
    if (this.state.chapterSentences.length === 0) this.state.starterChapter = cur.source === 'starter';
    this.state.current = cur;
    this.state.story = [...this.state.story, cur.text].slice(-this.o.keepSentences);
    this.state.chapterSentences.push(cur.text);
    this.state.phase = 'cliff';
    this.state.screen = { kind: 'cliff', meta: this.meta(), sentence: this.view(at), cliff: this.cliffPrompt() };
    const extra: Partial<StoryStep> = { speak: this.speakUpToCliff() };
    if (news) extra.placement = news;
    else if (this.placementActive()) extra.placement = { nextBand: this.tracker().nextBand().band, done: false };
    return this.step(events, extra);
  }

  /** Zero knowledge: a brand-new learner, or a learner with no evidence at all. */
  private zeroStart(): boolean {
    if (this.state.startMode === 'brand_new') return true;
    const known = this.deps.learner.knownKeys();
    for (const _ of known) return false;
    return true;
  }

  /** The hand-over stage of the next story sentence (session/handover.ts). */
  private stage(at: number, state: StoryState = this.state): StoryStage {
    return handoverStage({
      pack: this.deps.pack,
      pair: this.deps.pair,
      learner: this.deps.learner,
      now: at,
      starterUsed: state.starterUsed.length,
      zeroStart: this.zeroStart(),
      hasModel: this.deps.model !== null,
      options: this.o.handover,
    });
  }

  /** The starter story plays first at zero knowledge, and in canned mode while it has unused sentences. */
  private useStarter(at: number): boolean {
    const st = this.starter;
    if (!st || this.state.starterUsed.length >= st.sentences.length) return false;
    return this.stage(at) === 'starter';
  }

  /** The next unused sentence of the placement ladder (canned mode after the starter). */
  private async unusedProbeSentence(at: number): Promise<CurrentSentence | null> {
    const probes = this.starter?.probes ?? [];
    for (let i = 0; i < probes.length; i++) {
      if (this.state.probesUsed.includes(i)) continue;
      this.state.probesUsed.push(i);
      const cur = await this.cannedSentence(probes[i] as StarterSentence, 'probe', i, at);
      if (cur) return cur;
    }
    return null;
  }

  private storyText(): string {
    return joinSentences(this.state.story.slice(-this.o.contextSentences));
  }

  private scoringCtx(before: string, text: string): string {
    const { register, regions } = this.state.settings;
    return scoringContext(this.deps.pack, before, { register, regions, words: register === 'street' ? slangIn(this.deps.pack, before + text, regions) : [] });
  }

  /** The next starter sentence: unused ones in order, then (cycle) the least recently used. */
  private async starterSentence(at: number, cycle: boolean): Promise<CurrentSentence | null> {
    const st = this.starter;
    if (!st || st.sentences.length === 0) return null;
    const n = st.sentences.length;
    for (let tries = 0; tries < n; tries++) {
      let index = -1;
      for (let i = 0; i < n; i++) if (!this.state.starterUsed.includes(i)) { index = i; break; }
      if (index < 0) {
        if (!cycle) return null;
        index = this.state.starterCursor % n;
        this.state.starterCursor += 1;
      } else {
        this.state.starterUsed.push(index);
      }
      const cur = await this.cannedSentence(st.sentences[index] as StarterSentence, 'starter', index, at);
      if (cur) return cur;
    }
    return null;
  }

  /** A canned sentence (starter or probe) as the current sentence; null when its answer cannot be located. */
  private async cannedSentence(s: StarterSentence, source: 'starter' | 'probe', index: number, at: number): Promise<CurrentSentence | null> {
    const pack = this.deps.pack;
    const span = locateAnswer(pack, s.text, s.answer);
    if (!span) return null;
    const words = sentenceWords(pack, s.text, this.regOpts());
    const first = words[span.wordIndex];
    if (!first) return null;
    const storyText = this.storyText();
    const lead = leadAfter(storyText);
    const upToCliff = lead + s.text.slice(0, span.start);
    const params = this.params(at);
    const rung = cliffRungFor(this.deps.learner, first.key, at);
    const answer = s.text.slice(span.start, span.end);
    const cur: CurrentSentence = {
      text: s.text,
      source,
      index,
      words,
      cliff: { ...span, answer, key: first.key },
      context: this.scoringCtx(storyText, lead + s.text) + upToCliff,
      before: storyText + upToCliff,
      rung,
      options: null,
      hint: hintFor(first.text),
      alternatives: [],
      actualProb: null,
      accept: [...(s.accept ?? [])],
      targets: [],
      translation: s.translation ?? null,
      params,
      slow: 1,
      replays: 0,
      tapped: [],
      revealed: [],
      probe: null,
      outcome: null,
      resolved: false,
      finished: false,
    };
    if (rung === 'options') {
      const distractors = s.distractors.filter((d) => !sameWords(pack, d, answer)).slice(0, DEFAULT_OPTION_CHOICE_OPTIONS.count);
      this.setOptions(cur, answer, distractors.map((text) => ({ text, prob: null })));
    }
    return cur;
  }

  private setOptions(cur: CurrentSentence, natural: string, distractors: { text: string; prob: number | null }[]): void {
    if (distractors.length === 0) {
      cur.rung = 'hint';
      cur.options = null;
      return;
    }
    const { options, naturalIndex } = arrangeOptions(natural, distractors.map((d) => d.text), rng(this.nextSeed()));
    cur.options = options.map((opt, i) => ({
      text: opt.text,
      natural: i === naturalIndex,
      prob: i === naturalIndex ? cur.actualProb : distractors.find((d) => d.text === opt.text)?.prob ?? null,
    }));
  }

  /** Lemmas of the frequency list with their part of speech and rank (cached per session object). */
  private lemmas(): { lemma: string; key: string; pos: string | null; rank: number }[] {
    if (!this.lemmaCache) {
      const pack = this.deps.pack;
      this.lemmaCache = (pack.frequencyList ?? []).map((lemma, i) => ({
        lemma,
        key: lexemeKey(pack.code, lemma),
        pos: pack.analyze(pack.normalize(lemma))[0]?.pos ?? null,
        rank: i + 1,
      }));
    }
    return this.lemmaCache;
  }

  /** True when the lexeme's first analysis has one of these parts of speech. */
  private lemmaPos(key: string, pos: ReadonlySet<Pos>): boolean {
    const prefix = `${this.deps.pack.code}:`;
    const lex = lexemeOf(key);
    if (!lex.startsWith(prefix)) return false;
    const p = this.deps.pack.analyze(this.deps.pack.normalize(lex.slice(prefix.length)))[0]?.pos;
    return p !== undefined && pos.has(p);
  }

  /** Distractor candidates: recognizable words (best understood first), never words of the current sentence. */
  private distractorPool(at: number, words: readonly SentenceWord[]): string[] {
    const inSentence = new Set(words.map((w) => w.key));
    const allowed = new Set(this.o.distractorPos);
    const learner = this.deps.learner;
    return this.lemmas()
      .filter((l) => l.pos !== null && allowed.has(l.pos) && !inSentence.has(l.key))
      .map((l) => ({ l, p: learner.pKnown(l.key, 'meaning', at) }))
      .sort((a, b) => b.p - a.p || a.l.rank - b.l.rank)
      .slice(0, this.o.distractorPool)
      .map((x) => x.l.lemma);
  }

  /**
   * Generate and select (generateNextSentence), then cut a cliff into the best accepted
   * candidate that takes one (cutCliff), trying at most `candidateTries` of them in rank
   * order: a top candidate can be too short for a cliff ("Ti.") or hold no plausible
   * position. Explicit slang is skipped while explicit is off. null when none works.
   */
  private async modelSentence(model: LanguageModel, at: number, forced?: { key: string; rank: number }): Promise<CurrentSentence | null> {
    const pack = this.deps.pack;
    const settings = this.state.settings;
    const vocab = estimateVocabulary(this.deps.learner, at, this.frequencyKeys());
    const params = deriveParams({ vocab, recent: this.recentStats() });
    // The bridge (session/handover.ts): the starter's words, cognates and introduced words count as known.
    const bridge = !forced && this.stage(at) === 'bridge';
    const familiar = bridge ? bridgeFamiliar(pack, this.deps.pair, this.state.introduced) : [];
    let targets: string[];
    if (forced) targets = [forced.key];
    else {
      const extra = settings.register === 'street' ? this.slangKeys() : [];
      const handover = { ...DEFAULT_HANDOVER_OPTIONS, ...this.o.handover };
      const targetPos = new Set<Pos>(handover.bridgeTargetPos);
      const chosen = chooseTargets({
        learner: this.deps.learner,
        now: at,
        frequencyKeys: this.frequencyKeys(),
        extra,
        exclude: [...this.state.recentTargets.flat(), ...familiar],
        ...(bridge ? { accept: (key: string) => this.lemmaPos(key, targetPos) } : {}),
        options: { count: params.newWordsPerSentence >= this.o.twoTargetsFrom ? 2 : 1 },
      });
      this.state.frontier = chosen.some((c) => c.reason === 'new' || c.reason === 'extra') ? 'open' : 'exhausted';
      targets = chosen.map((c) => c.key);
    }
    const story = this.state.story.slice(-this.o.contextSentences);
    const character = this.starter?.character;
    const next = await generateNextSentence(
      model,
      { pack, learner: this.deps.learner, pair: this.deps.pair },
      {
        story,
        targets,
        params,
        now: at,
        seed: this.nextSeed(),
        register: settings.register,
        ...(settings.regions[0] ? { region: settings.regions[0] } : {}),
        ...(character ? { names: [character] } : {}),
        vocab,
        ...(familiar.length ? { familiar } : {}),
        tuning: { contextSentences: this.o.contextSentences, ...this.o.generation },
      },
    );
    let tries = 0;
    const usable = next.ranked.filter((c) => c.accepted);
    for (const [k, cand] of usable.entries()) {
      const words = sentenceWords(pack, cand.text, this.regOpts());
      if (!settings.showExplicit && words.some((w) => w.explicit)) continue;
      if (tries >= this.o.candidateTries) break;
      // The band comes first: the last in-band candidate the session will try takes its best
      // rated cliff even below the plausibility floor rather than leave the band (the
      // options rung and "no sé" keep a hard cliff fair; a sentence outside the band is not).
      const lastInBand = cand.inBand && (tries + 1 >= this.o.candidateTries || !usable.slice(k + 1).some((c) => c.inBand));
      const cur = await this.cutCliff(model, cand.text, words, joinSentences(story), forced ? [forced.key] : cand.targetsHit, targets, params, at, forced, lastInBand);
      if (cur === 'no_position') continue;
      tries += 1;
      if (cur) {
        const keep = Math.max(0, Math.floor({ ...DEFAULT_HANDOVER_OPTIONS, ...this.o.handover }.introducedKeep));
        const introduced = this.state.introduced.filter((k) => !cand.targetsHit.includes(k));
        // slice(-0) would keep everything: introducedKeep 0 keeps none.
        this.state.introduced = keep > 0 ? [...introduced, ...cand.targetsHit].slice(-keep) : [];
        return cur;
      }
    }
    return null;
  }

  /**
   * Choose the cliff of a model sentence: a cheap pre-ranking (rankCliffPositions with
   * every probability at 1, so only the exclusions and the learner terms count) picks the
   * positions worth a next-word search; cliffPositions rates them, a batch at a time (two
   * batches at most), and pickCliff chooses. A forced probe word is the only position,
   * with no plausibility floor (placement measures whether the learner knows the word).
   * With `relax`, when no rated position clears the floor, the best rated one is picked
   * without it (no further model call). 'no_position' when no word can be a cliff at all
   * (no model call was made).
   */
  private async cutCliff(
    model: LanguageModel,
    sentence: string,
    words: SentenceWord[],
    storyText: string,
    hit: readonly string[],
    targets: string[],
    params: DifficultyParams,
    at: number,
    forced?: { key: string; rank: number },
    relax = false,
  ): Promise<CurrentSentence | null | 'no_position'> {
    const pack = this.deps.pack;
    const lead = leadAfter(storyText);
    const sentenceText = lead + sentence;
    const context = this.scoringCtx(storyText, sentenceText);
    const pickCtx = {
      text: sentenceText,
      pack,
      learner: this.deps.learner,
      now: at,
      targets: [...hit],
      params,
      options: forced ? { ...this.o.cliffPick, probFloor: 0 } : this.o.cliffPick,
    };
    const wordSegs = pack.segment(sentenceText).filter((x) => x.kind === 'word');
    let candidatesIdx: number[];
    if (forced) {
      const w = words.find((x) => x.key === forced.key && x.index > 0 && x.kind === 'word');
      candidatesIdx = w ? [wordSegs.findIndex((x) => x.start === w.start + lead.length)].filter((i) => i >= 0) : [];
    } else {
      const fake: CliffPosition[] = wordSegs.map((segment, wordIndex) => ({ wordIndex, segment, actualLogprob: 0, alternatives: [], plausibleCount: 0 }));
      candidatesIdx = rankCliffPositions(fake, pickCtx)
        .filter((c) => c.eligible)
        .sort((a, b) => b.score - a.score || b.wordIndex - a.wordIndex)
        .map((c) => c.wordIndex);
    }
    if (candidatesIdx.length === 0) return 'no_position';
    let pick = null as ReturnType<typeof pickCliff>;
    let positions: CliffPosition[] = [];
    const batch = Math.max(1, Math.floor(this.o.cliffPositions));
    const rated: CliffPosition[] = [];
    for (let from = 0; from < Math.min(candidatesIdx.length, batch * 2) && !pick; from += batch) {
      positions = await cliffPositions(model, pack, context, sentenceText, { positions: candidatesIdx.slice(from, from + batch) });
      rated.push(...positions);
      pick = pickCliff(positions, pickCtx);
    }
    if (!pick && relax && !forced && rated.length) {
      positions = rated;
      pick = pickCliff(rated, { ...pickCtx, options: { ...this.o.cliffPick, probFloor: 0 } });
    }
    if (!pick || (forced && pick.key !== forced.key)) return null;
    const start = pick.start - lead.length;
    const end = pick.end - lead.length;
    const inSpan = words.filter((w) => w.start >= start && w.end <= end);
    const first = inSpan[0];
    if (!first || first.index === 0) return null;
    const position = positions.find((p) => p.wordIndex === pick?.wordIndex);
    const answer = sentence.slice(start, end);
    const cur: CurrentSentence = {
      text: sentence,
      source: 'model',
      index: null,
      words,
      cliff: { wordIndex: first.index, length: inSpan.length, start, end, answer, key: pick.key },
      context: context + sentenceText.slice(0, pick.start),
      before: storyText + sentenceText.slice(0, pick.start),
      rung: cliffRungFor(this.deps.learner, pick.key, at),
      options: null,
      hint: hintFor(first.text),
      alternatives: position?.alternatives ?? [],
      actualProb: position && inSpan.length === 1 && Number.isFinite(position.actualLogprob) ? Math.exp(position.actualLogprob) : null,
      accept: [],
      targets,
      translation: null,
      params,
      slow: 1,
      replays: 0,
      tapped: [],
      revealed: [],
      probe: forced ?? null,
      outcome: null,
      resolved: false,
      finished: false,
    };
    if (cur.rung === 'options') {
      const firstWord = sentence.slice(first.start, first.end);
      const distractors = await chooseDistractors(model, pack, {
        context: cur.context,
        actual: firstWord,
        alternatives: cur.alternatives,
        pool: this.distractorPool(at, words),
        random: rng(this.nextSeed()),
        options: this.o.options,
      });
      // A multi-word cliff: a distractor replaces its first word, the rest stays.
      const rest = sentence.slice(first.end, end);
      this.setOptions(cur, answer, distractors.map((d) => ({ text: d.text + rest, prob: d.prob })));
    }
    return cur;
  }

  /** When the starter story and the model gave nothing: the placement ladder's sentences, cycled. */
  private async lastResortSentence(at: number): Promise<CurrentSentence | null> {
    const probes = this.starter?.probes ?? [];
    for (let tries = 0; tries < probes.length; tries++) {
      const i = this.state.starterCursor % probes.length;
      this.state.starterCursor += 1;
      const cur = await this.cannedSentence(probes[i] as StarterSentence, 'probe', i, at);
      if (cur) return cur;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------

  private tracker(): PlacementTracker {
    return PlacementTracker.restore((this.state.placement as NonNullable<StoryState['placement']>).tracker);
  }

  private rankOfKey(key: string): number | undefined {
    const prefix = `${this.deps.pack.code}:`;
    const lex = lexemeOf(key);
    return lex.startsWith(prefix) ? this.deps.pack.frequencyRank(lex.slice(prefix.length)) : undefined;
  }

  /**
   * The next placement probe: the starter's probe whose cliff word is in the band the
   * tracker asks for (else the nearest band, the harder one on a tie), unused; without
   * probes, a generated sentence carrying a word of that band. null when none is left.
   */
  private async probeSentence(at: number): Promise<CurrentSentence | null> {
    const st = this.starter;
    const band = this.tracker().nextBand().band;
    const opts = this.tracker().options;
    const probes = st?.probes ?? [];
    const ranked: { i: number; d: number; b: number; rank: number; key: string }[] = [];
    probes.forEach((p, i) => {
      if (this.state.probesUsed.includes(i)) return;
      const span = locateAnswer(this.deps.pack, p.text, p.answer);
      if (!span) return;
      const w = sentenceWords(this.deps.pack, p.text, this.regOpts())[span.wordIndex];
      const rank = w ? this.rankOfKey(w.key) : undefined;
      if (!w || rank === undefined) return;
      const b = bandOf(rank, opts);
      ranked.push({ i, d: Math.abs(b - band), b, rank, key: w.key });
    });
    ranked.sort((x, y) => x.d - y.d || y.b - x.b || x.i - y.i);
    // Probes far from the asked band say little (all known, or all unknown): stop there.
    const best = ranked[0] && ranked[0].d <= this.o.placementBandGap ? ranked[0] : undefined;
    if (best) {
      this.state.probesUsed.push(best.i);
      const cur = await this.cannedSentence(probes[best.i] as StarterSentence, 'probe', best.i, at);
      if (cur) {
        cur.probe = { key: cur.cliff.key, rank: this.rankOfKey(cur.cliff.key) ?? best.rank };
        return cur;
      }
    }
    if (!this.deps.model || ranked.length > 0 || probes.length > 0) return null;
    // No ladder in this pair: generate a sentence around a word of the band.
    const range = this.tracker().nextBand();
    const placement = this.state.placement as NonNullable<StoryState['placement']>;
    const cand = this.lemmas().find((l) => l.rank >= range.minRank && l.rank < range.maxRank && l.pos !== null && CONTENT_ROLE_POS.has(l.pos) && !placement.probed.includes(l.key))
      ?? [...this.lemmas()].reverse().find((l) => l.pos !== null && CONTENT_ROLE_POS.has(l.pos) && !placement.probed.includes(l.key));
    if (!cand) return null;
    placement.probed.push(cand.key);
    return this.modelSentence(this.deps.model, at, { key: cand.key, rank: cand.rank });
  }

  /** Record the probe of the current sentence (if any) with the tracker. */
  private recordProbe(success: boolean): PlacementNews | undefined {
    const cur = this.state.current;
    const placement = this.state.placement;
    if (!cur || !placement || placement.done || !cur.probe) return undefined;
    const t = this.tracker();
    t.record(cur.probe.key, cur.probe.rank, success);
    placement.tracker = t.snapshot();
    const recorded = { key: cur.probe.key, rank: cur.probe.rank, success };
    cur.probe = null;
    return { recorded, nextBand: t.nextBand().band, done: t.done };
  }

  private finishPlacement(at: number, events: LearnerEvent[], news?: PlacementNews): StoryStep {
    const placement = this.state.placement as NonNullable<StoryState['placement']>;
    const t = this.tracker();
    placement.done = true;
    this.state.prior = { kind: 'placement', placement: t.snapshot() };
    this.replacePrior();
    // The rest of the session continues as the learner's own story.
    this.newChapter();
    const est = t.estimate();
    this.state.phase = 'placementDone';
    this.state.screen = {
      kind: 'placementDone',
      meta: this.meta(),
      vocabulary: Math.round(estimateVocabulary(this.deps.learner, at, this.frequencyKeys())),
      thresholdRank: Math.round(est.thresholdRank),
      items: est.items,
    };
    return this.step(events, {
      placement: { ...(news?.recorded ? { recorded: news.recorded } : {}), nextBand: t.nextBand().band, done: true, snapshot: t.snapshot() },
    });
  }

  // -------------------------------------------------------------------------
  // Utterances and commands
  // -------------------------------------------------------------------------

  private async route(transcript: string, at: number, info: UtteranceInfo): Promise<StoryStep> {
    const s = this.state;
    const pack = this.deps.pack;
    if (looseText(pack, transcript) === '' && s.phase !== 'retell') return this.step([]);
    const expected =
      s.phase === 'cliff' || s.phase === 'noSe' ? s.current?.cliff.answer : s.phase === 'native' ? s.native?.target ?? undefined : undefined;
    const cmd = matchCommand(transcript, pack, { ...this.o.command, ...(expected ? { answer: expected } : {}) });
    if (cmd) return this.doCommand(cmd.command, at, cmd.argument, info);
    switch (s.phase) {
      case 'cliff':
        return this.answer(transcript, at);
      case 'landing':
        return this.shadow(transcript);
      case 'noSe':
        return this.noSeRepeat(transcript, at);
      case 'native':
        return this.nativeRepeat(transcript, at);
      case 'turn':
      case 'repair':
        return this.turnAttempt(transcript, at);
      case 'retell':
        return this.retellRound(transcript, info, false);
      case 'register':
        return this.registerAnswer(transcript, at);
      default:
        return this.step([]);
    }
  }

  private async doCommand(cmd: SpokenCommand, at: number, argument: string | undefined, info: UtteranceInfo): Promise<StoryStep> {
    const s = this.state;
    const tag = { command: cmd };
    switch (cmd) {
      case 'again':
      case 'slower':
        return { ...this.replay(cmd === 'slower', at), ...tag };
      case 'meaning':
        return { ...this.meaning(at, argument), ...tag };
      case 'next':
        return { ...(await this.advanceStep(at)), ...tag };
      case 'dont_know': {
        if (s.phase === 'cliff') return { ...this.startNoSeFlow(at), ...tag };
        if ((s.phase === 'turn' || s.phase === 'repair') && s.turn) return { ...this.giveUp(at), ...tag };
        if (s.phase === 'register' && s.register) return { ...this.registerReveal(), ...tag };
        if (s.phase === 'noSe' && s.noSe) {
          s.noSe = advanceNoSe(s.noSe, { type: 'skip' }, this.deps.pack, this.noSeOpts());
          s.screen = this.noSeScreen(at);
          return { ...this.step([]), ...tag };
        }
        return { ...this.step([]), ...tag };
      }
      case 'done': {
        if (s.phase === 'retell') return { ...this.retellRound('', info, true), ...tag };
        if (this.placementActive() || s.phase === 'upNext' || s.phase === 'placementDone' || s.chapterSentences.length === 0) {
          return { ...(await this.advanceStep(at)), ...tag };
        }
        // Finish the chapter now: the learner turn and the retell come next.
        const events: LearnerEvent[] = [];
        if (s.phase === 'cliff' && s.current) {
          s.current.resolved = true;
        }
        events.push(...this.finishSentence(at));
        s.noSe = null;
        s.native = null;
        if (s.phase === 'turn' || s.phase === 'repair') {
          s.turn = null;
          return { ...this.toUpNext(events), ...tag };
        }
        return { ...(await this.chapterEnd(events)), ...tag };
      }
    }
  }

  private replay(slower: boolean, at: number): StoryStep {
    const s = this.state;
    const cur = s.current;
    if (cur && (s.phase === 'cliff' || s.phase === 'landing' || s.phase === 'noSe' || s.phase === 'native')) {
      cur.replays += 1;
      if (slower) cur.slow *= this.o.slowerFactor;
    }
    const rate = this.rate();
    let speak: SpeakCue | undefined;
    switch (s.phase) {
      case 'cliff':
        speak = this.speakUpToCliff();
        break;
      case 'landing':
        speak = { text: cur?.text ?? '', rate, what: 'sentence' };
        break;
      case 'noSe':
        if (s.noSe) {
          s.noSe = advanceNoSe(s.noSe, { type: 'replay', slower }, this.deps.pack, this.noSeOpts());
          s.screen = this.noSeScreen(at);
          speak = { text: s.noSe.answer, rate, what: 'answer' };
        }
        break;
      case 'native':
        if (s.native?.target) speak = { text: s.native.target, rate, what: 'answer' };
        break;
      case 'turn':
      case 'repair':
        if (s.turn) speak = { text: s.turn.line, rate, what: 'prompt' };
        break;
      case 'retell':
        if (s.retell) speak = { text: s.retell.scene, rate, what: 'scene' };
        break;
      case 'register':
        if (s.register) speak = { text: s.register.prompt, rate, what: 'prompt' };
        break;
      default:
        break;
    }
    // Tile widths follow the new rate.
    if (slower) this.rerender(at);
    return this.step([], speak ? { speak } : {});
  }

  /** "What does it mean": the word named in the command, else the first new word in view, else the sentence translation. */
  private meaning(at: number, argument: string | undefined): StoryStep {
    const cur = this.state.current;
    const pack = this.deps.pack;
    const pair = this.deps.pair;
    let word: string | undefined;
    let key: string | undefined;
    let lemma: string | undefined;
    if (argument && looseText(pack, argument) !== '') {
      const firstKey = looseText(pack, argument).split(' ')[0];
      const w = cur?.words.find((x) => looseText(pack, x.text) === firstKey && this.visible(x.index));
      if (w) {
        word = w.text;
        key = w.key;
        lemma = w.lemma ?? w.norm;
      } else {
        const segs = pack.segment(argument).filter((x) => x.kind === 'word');
        const seg = segs[0];
        if (seg) {
          const norm = seg.norm || pack.normalize(seg.text);
          lemma = pack.analyze(norm)[0]?.lemma ?? norm;
          word = seg.text;
          key = lexemeKey(pack.code, lemma);
        }
      }
    } else if (cur) {
      const w = cur.words.find((x) => this.visible(x.index) && x.kind === 'word' && x.lemma !== null && x.pos !== 'PROPN' && this.deps.learner.pKnown(x.key, 'meaning', at) < (this.o.view.newBelow ?? DEFAULT_VIEW_OPTIONS.newBelow));
      if (w) {
        word = w.text;
        key = w.key;
        lemma = w.lemma ?? w.norm;
      }
    }
    if (!word || !key || !lemma) {
      if (cur?.translation) return this.step([], { meaning: { word: cur.text, key: '', gloss: null, translation: cur.translation } });
      return this.step([]);
    }
    const m: MeaningView = { word, key, gloss: pair.gloss(lemma) ?? null };
    const ff = pair.falseFriends?.[lemma];
    if (ff !== undefined) m.falseFriend = ff;
    if (cur?.translation) m.translation = cur.translation;
    return this.step([{ type: 'gloss_lookup', key, at }], { meaning: m });
  }

  // -- cliff answers -----------------------------------------------------------

  private async answer(transcript: string, at: number): Promise<StoryStep> {
    const cur = this.state.current as CurrentSentence;
    const pack = this.deps.pack;
    if (cur.options) {
      const idx = cur.options.findIndex((o) => sameWords(pack, transcript, o.text));
      if (idx >= 0) return this.chooseOption(idx, at);
    }
    if (this.state.settings.nativeAnswersAllowed) {
      const nr = nativeReply(transcript, pack, this.deps.pair, { at, expected: cur.cliff.answer });
      if (nr.hasNative && nr.targetPhrase !== null) return this.toNative(transcript, nr, at);
    }
    const model = this.deps.model;
    let result: CliffResult;
    let equivalence: LyricEquivalence | undefined;
    let scoredBy: CliffOutcome['scoredBy'];
    if (model) {
      const r = await scoreLyricAnswer(model, pack, { context: cur.context, answer: cur.cliff.answer, before: cur.before, ...this.precomputed(cur) }, transcript, this.regOpts());
      result = r;
      equivalence = r.equivalence;
      scoredBy = 'model';
      if (result.credit !== 'full') {
        const listed = cur.accept.find((a) => sameWords(pack, transcript, a));
        if (listed !== undefined) result = { ...result, credit: 'full', reason: 'likely' };
      }
    } else {
      result = cannedResult(pack, transcript, cur.cliff.answer, cur.accept);
      scoredBy = 'canned';
    }
    return this.land(result, scoredBy, at, equivalence);
  }

  /**
   * What cliffPositions already found at the cliff of a model sentence (its alternatives
   * and, for a single-word cliff, P(actual)), so the answer costs no next-word search.
   * Canned sentences were never rated: their answers search as usual.
   */
  private precomputed(cur: CurrentSentence): { alternatives?: NextWord[]; actualLogprob?: number } {
    if (cur.source !== 'model' || !alternativesReusable({}, {})) return {};
    const out: { alternatives?: NextWord[]; actualLogprob?: number } = { alternatives: cur.alternatives };
    if (cur.actualProb !== null && cur.actualProb > 0) out.actualLogprob = Math.log(cur.actualProb);
    return out;
  }

  private async chooseOption(index: number, at: number): Promise<StoryStep> {
    const cur = this.state.current;
    if (this.state.phase !== 'cliff' || !cur || !cur.options) return this.step([]);
    const opt = cur.options[index];
    if (!opt) return this.step([]);
    const result = optionResult(opt.text, opt.natural, opt.natural ? cur.actualProb : opt.prob, cur.alternatives);
    return this.land(result, 'options', at);
  }

  private land(result: CliffResult, scoredBy: CliffOutcome['scoredBy'], at: number, equivalence?: LyricEquivalence): StoryStep {
    const cur = this.state.current as CurrentSentence;
    const outcome = buildOutcome(result, {
      pack: this.deps.pack,
      expected: cur.cliff.answer,
      rung: cur.rung,
      scoredBy: scoredBy === 'options' && cur.actualProb === null ? 'canned' : scoredBy,
      actualProb: cur.actualProb,
      ...(equivalence ? { equivalence } : {}),
      options: { ...DEFAULT_LANDING_OPTIONS, ...this.o.landing },
    });
    if (scoredBy === 'options') outcome.scoredBy = 'options';
    cur.outcome = outcome;
    cur.resolved = true;
    this.state.outcomes.push(result.credit === 'none' ? 0 : 1);
    const news = this.recordProbe(result.credit === 'full');
    this.state.phase = 'landing';
    this.state.screen = { kind: 'landing', meta: this.meta(), sentence: this.view(at), outcome };
    const events: LearnerEvent[] = [{ type: 'cliff_answer', key: cur.cliff.key, at, credit: result.credit, rung: cur.rung }];
    return this.step(events, news ? { placement: news } : {});
  }

  private shadow(transcript: string): StoryStep {
    const cur = this.state.current;
    const s = this.state.screen;
    if (!cur || s.kind !== 'landing') return this.step([]);
    const a = alignTranscript(cur.text, transcript, this.deps.pack, this.regOpts());
    this.state.screen = { ...s, shadow: alignmentView(a) };
    return this.step([]);
  }

  // -- no sé -------------------------------------------------------------------

  private startNoSeFlow(at: number): StoryStep {
    const cur = this.state.current as CurrentSentence;
    this.state.noSe = startNoSe({ answer: cur.cliff.answer, key: cur.cliff.key, at });
    cur.resolved = true;
    this.state.outcomes.push(0);
    const news = this.recordProbe(false);
    this.state.phase = 'noSe';
    this.state.screen = this.noSeScreen(at);
    const extra: Partial<StoryStep> = { speak: { text: cur.cliff.answer, rate: this.rate(), what: 'answer' } };
    if (news) extra.placement = news;
    return this.step(this.state.noSe.events, extra);
  }

  private noSeScreen(at: number): StoryScreen {
    const st = this.state.noSe as NoSeState;
    const screen: StoryScreen = {
      kind: 'noSe',
      meta: this.meta(),
      sentence: this.view(at),
      step: st.step,
      answer: st.answer,
      ui: st.ui,
    };
    if (st.last) screen.repeat = alignmentView(st.last);
    return screen;
  }

  private noSeRepeat(transcript: string, at: number): StoryStep {
    const st = this.state.noSe;
    if (!st) return this.step([]);
    const before = st.events.length;
    this.state.noSe = advanceNoSe(st, { type: 'repeat', transcript, at }, this.deps.pack, this.noSeOpts());
    this.state.screen = this.noSeScreen(at);
    return this.step(this.state.noSe.events.slice(before));
  }

  // -- native-language answers -------------------------------------------------

  private toNative(transcript: string, nr: NativeReply, at: number): StoryStep {
    const cur = this.state.current as CurrentSentence;
    const keys = [...new Set(nr.phrases.filter((p) => p.lemma !== null).map((p) => lexemeKey(this.deps.pack.code, p.lemma as string)))];
    this.state.native = {
      heard: transcript,
      target: nr.targetPhrase,
      phrases: nr.phrases.map((p) => ({ native: p.native, target: p.target })),
      keys,
      landed: false,
      repeat: null,
    };
    cur.resolved = true;
    this.state.outcomes.push(0);
    // Placement measures understanding: naming the expected word in the native language shows it.
    const news = this.recordProbe(nr.phrases.some((p) => p.fromExpected));
    this.state.phase = 'native';
    this.state.screen = this.nativeScreen(nr.ui, at);
    const extra: Partial<StoryStep> = nr.targetPhrase ? { speak: { text: nr.targetPhrase, rate: this.rate(), what: 'answer' } } : {};
    if (news) extra.placement = news;
    return this.step(nr.events, extra);
  }

  private nativeScreen(ui: UiText | null, at: number): StoryScreen {
    const n = this.state.native as NativeState;
    const screen: StoryScreen = { kind: 'nativeReply', meta: this.meta(), heard: n.heard, target: n.target, phrases: n.phrases, ui };
    if (this.state.current) screen.sentence = this.view(at);
    if (n.repeat) screen.repeat = n.repeat;
    return screen;
  }

  private nativeRepeat(transcript: string, at: number): StoryStep {
    const n = this.state.native;
    if (!n || !n.target) return this.step([]);
    const a = alignTranscript(n.target, transcript, this.deps.pack, this.regOpts());
    n.repeat = alignmentView(a);
    const landed = a.total > 0 && a.understood === a.total;
    const events: LearnerEvent[] = landed && !n.landed ? n.keys.map((key) => ({ type: 'spoke_correct' as const, key, at })) : [];
    if (landed) n.landed = true;
    this.state.screen = this.nativeScreen(landed ? null : { key: 'cliff.repeatAloud' }, at);
    return this.step(events);
  }

  // -- learner turns and self-repair --------------------------------------------

  private async turnAttempt(transcript: string, at: number): Promise<StoryStep> {
    const turn = this.state.turn;
    const model = this.deps.model;
    if (!turn || isRepairFinal(turn.repair)) return this.step([]);
    const pack = this.deps.pack;
    const events: LearnerEvent[] = [];
    turn.native = null;
    if (this.state.settings.nativeAnswersAllowed) {
      const nr = nativeReply(transcript, pack, this.deps.pair, { at });
      if (nr.hasNative) {
        events.push(...nr.events);
        turn.native = { heard: transcript, target: nr.targetPhrase };
        if (nr.allNative) {
          // Nothing to judge yet: offer the target words and wait for the sentence.
          this.state.screen = this.repairScreen();
          return this.step(events, nr.targetPhrase ? { speak: { text: nr.targetPhrase, rate: this.rate(), what: 'answer' } } : {});
        }
      }
    }
    if (!model) return this.step(events);
    const { register, regions } = this.regOpts();
    const storyText = this.storyText();
    turn.repair = await attemptRepair(turn.repair, model, pack, transcript, at, {
      judge: { before: storyText, register, regions },
      flow: { ...this.o.repair, register, regions },
    });
    const lead = leadAfter(storyText);
    const scores = await scoreWords(model, pack, this.scoringCtx(storyText, lead + transcript), lead + transcript, register === 'street' ? { exempt: slangExemption(pack, regions) } : {});
    const said: SaidWord[] = scores.map((w) => ({ text: w.segment.text, heat: w.heat }));
    const h = turn.repair.highlight;
    if (h && said[h.wordIndex]) {
      const sw = said[h.wordIndex] as SaidWord;
      if (h.heat > sw.heat) sw.heat = h.heat;
    }
    turn.said = said;
    if (isRepairFinal(turn.repair)) events.push(...repairEvents(turn.repair, pack, { ...this.o.repair, register, regions }));
    this.state.phase = 'repair';
    this.state.screen = this.repairScreen();
    return this.step(events);
  }

  private giveUp(at: number): StoryStep {
    const turn = this.state.turn as TurnState;
    const before = turn.repair;
    turn.repair = repairFlow(turn.repair, { type: 'give_up', at }, this.deps.pack, { ...this.o.repair, ...this.regOpts() });
    const events = turn.repair !== before && isRepairFinal(turn.repair) ? repairEvents(turn.repair, this.deps.pack, { ...this.o.repair, ...this.regOpts() }) : [];
    if (turn.repair === before && turn.repair.phase === 'awaiting_attempt') {
      // Nothing said yet: "no sé" skips the turn.
      this.state.turn = null;
      return this.toUpNext([]);
    }
    this.state.phase = 'repair';
    this.state.screen = this.repairScreen();
    return this.step(events);
  }

  private repairScreen(): StoryScreen {
    const turn = this.state.turn as TurnState;
    const r = turn.repair;
    if (r.phase === 'awaiting_attempt') {
      const screen: StoryScreen = { kind: 'turn', meta: this.meta(), prompt: { speaker: turn.speaker, line: turn.line }, ui: { key: 'story.asks', params: { speaker: turn.speaker } } };
      if (turn.native) screen.native = turn.native;
      return screen;
    }
    const screen: StoryScreen = {
      kind: 'repair',
      meta: this.meta(),
      prompt: { speaker: turn.speaker, line: turn.line },
      phase: r.phase,
      said: turn.said,
      attempts: r.attempts.length,
      highlight: r.highlight?.wordIndex ?? null,
      expected: r.expected,
      explanation: r.explainKey ? this.deps.pair.explanations[r.explainKey] ?? null : null,
      explainKey: r.explainKey,
      ui: r.ui,
      done: isRepairFinal(r),
    };
    if (turn.native) screen.native = turn.native;
    return screen;
  }

  // -- retell -------------------------------------------------------------------

  private startRetell(at: number): StoryStep {
    const scene = joinSentences(this.state.chapterSentences);
    this.state.retell = { round: 0, scene, results: [], stats: [] };
    this.state.phase = 'retell';
    this.state.screen = this.retellScreen();
    return this.step([]);
  }

  private retellScreen(): StoryScreen {
    const r = this.state.retell as RetellState;
    const lanes = this.o.retellLanes;
    const round = Math.min(r.round, Math.max(0, lanes.length - 1));
    return {
      kind: 'retell',
      meta: this.meta(),
      round,
      rounds: lanes.length,
      laneMs: lanes[round] ?? 0,
      ui: retellRoundUi(round, lanes),
      scene: r.scene,
      results: r.results,
      progress: retellProgress(r.stats),
      done: r.round >= lanes.length,
    };
  }

  /**
   * One retell round from an utterance. Word timings come from the recognizer
   * (info.words); without them the transcript's words are spread evenly over the
   * utterance (or the lane), which gives words per minute but no pauses. A "listo"
   * ends the round with whatever words came with it.
   */
  private retellRound(transcript: string, info: UtteranceInfo, ended: boolean): StoryStep {
    const r = this.state.retell;
    const lanes = this.o.retellLanes;
    if (!r || r.round >= lanes.length) return this.step([]);
    const laneMs = lanes[r.round] ?? 0;
    let words: TimedWord[] = (info.words ?? []).map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    if (words.length === 0 && !ended) {
      const segs = this.deps.pack.segment(transcript).filter((x) => x.kind === 'word' || x.kind === 'number');
      const span = finitePositive(info.durationMs) || laneMs * 0.9;
      const each = segs.length ? span / segs.length : 0;
      words = segs.map((x, i) => ({ text: x.text, startMs: i * each, endMs: (i + 1) * each }));
    }
    const m = retellMetrics(words, { laneMs });
    const cov = retellCoverage(m.words, r.scene, this.deps.pack);
    r.results.push({
      round: r.round,
      laneMs,
      words: m.wordCount,
      wordsPerMinute: m.wordsPerMinute,
      tiles: m.words.map((w) => ({ startMs: w.startMs, endMs: w.endMs })),
      pauses: m.pauses.map((p) => ({ startMs: p.startMs, endMs: p.endMs })),
      covered: cov.covered.length,
      total: cov.total,
    });
    r.stats.push({ wordsPerMinute: m.wordsPerMinute, pauseCount: m.pauseCount });
    r.round += 1;
    this.state.screen = this.retellScreen();
    return this.step([]);
  }

  // -- register switching ----------------------------------------------------------

  private registerTask(at: number): StoryStep {
    const pack = this.deps.pack;
    const settings = this.state.settings;
    const events = this.finishSentence(at);
    let street: string | null = null;
    let neutral: string | null = null;
    let swaps: { street: string; neutral: string; lemma: string }[] = [];
    for (const sentence of [...this.state.story].reverse()) {
      const p = registerPairs(sentence, pack, settings.regions, { alsoStandard: false });
      if (p.substitutions.length === 0) continue;
      if (!settings.showExplicit && sentenceWords(pack, sentence, { register: 'street', regions: settings.regions }).some((w) => w.explicit)) continue;
      street = p.street;
      neutral = p.neutral;
      swaps = p.substitutions.map((x) => ({ street: x.street, neutral: x.neutral, lemma: x.lemma }));
      break;
    }
    if (street === null || neutral === null) {
      const entries = applicableRegisters(pack, settings.regions)
        .flatMap((r) => r.entries)
        .filter((e) => (settings.showExplicit || !e.explicit) && looseText(pack, e.form) !== looseText(pack, e.neutral));
      const e = entries.length ? entries[Math.floor(rng(this.nextSeed())() * entries.length)] : undefined;
      if (!e) return this.step(events);
      street = e.form;
      neutral = e.neutral;
      swaps = [{ street: e.form, neutral: e.neutral, lemma: e.lemma }];
    }
    // Practise the register the learner chose: street learners hear neutral and say it street.
    const to = settings.register === 'street' ? 'street' : 'neutral';
    const task: RegisterState = {
      prompt: to === 'street' ? neutral : street,
      from: to === 'street' ? 'neutral' : 'street',
      to,
      expected: to === 'street' ? street : neutral,
      swaps: swaps.map((x) => (to === 'street' ? { from: x.neutral, to: x.street } : { from: x.street, to: x.neutral })),
      keys: [...new Set(swaps.map((x) => lexemeKey(pack.code, x.lemma)))],
    };
    this.state.register = task;
    this.state.phase = 'register';
    this.state.screen = { kind: 'register', meta: this.meta(), task: this.registerView() };
    return this.step(events, { speak: { text: task.prompt, rate: this.rate(), what: 'prompt' } });
  }

  private registerView(): RegisterTaskView {
    const t = this.state.register as RegisterState;
    const v: RegisterTaskView = { prompt: t.prompt, from: t.from, to: t.to, expected: t.expected, swaps: t.swaps };
    if (t.result) v.result = t.result;
    return v;
  }

  private registerAnswer(transcript: string, at: number): StoryStep {
    const t = this.state.register;
    if (!t) return this.step([]);
    const a = alignTranscript(t.expected, transcript, this.deps.pack, { register: t.to, regions: this.state.settings.regions });
    t.result = alignmentView(a);
    const landed = a.total > 0 && a.understood === a.total;
    const events: LearnerEvent[] = landed && t.to === 'street' ? t.keys.map((key) => ({ type: 'spoke_correct' as const, key, at })) : [];
    this.state.screen = { kind: 'register', meta: this.meta(), task: this.registerView() };
    return this.step(events);
  }

  private registerReveal(): StoryStep {
    const t = this.state.register as RegisterState;
    return this.step([], { speak: { text: t.expected, rate: this.rate(), what: 'answer' } });
  }
}
