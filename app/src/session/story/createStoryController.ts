/**
 * The Story tab's controller (src/session/contract.ts StoryController): it owns one engine
 * StorySession and the speech, storage and model plumbing around it, and publishes a
 * StoryViewModel for StoryView. The engine's screens are the view data; nothing here
 * reshapes them.
 *
 * Session lifecycle
 * - start(): restore the active 'story' session from storage.sessions (its snapshot is the
 *   engine's StorySessionSnapshot, stored with STORY_SESSION_FORMAT as its version; another
 *   version or a snapshot restore() refuses is deactivated, not crashed on). Otherwise create
 *   one: StartMode from settings.startLevel ('brand_new' / 'placement'), or 'continue' for a
 *   learner with an earlier story session or a stored placement prior; SessionSettings from
 *   the app settings (./settings.ts). A restored idle session, or a new one, takes its first
 *   step at once.
 * - Every call into the session runs through one serial queue (the session's async steps
 *   must not overlap, and its sync ones are not busy-safe); `busy` is true while queued
 *   async steps run. An action is checked against the screen when called and again when its
 *   turn comes, so a double tap never lands on the next screen.
 * - The model: the session gets the ModelAdapter while its status is 'ready' and null
 *   (canned mode) otherwise; onStatusChange switches it, effective at the next sentence.
 *
 * After every step, in one storage transaction:
 * - events: the session runs with applyEvents false, and storage.learner.record(learner,
 *   events) applies and logs them in one step, so every event is applied exactly once and
 *   memory and the log stay in step;
 * - prior: when the session replaces the learner's prior (brand new, placement done), a
 *   learner snapshot is saved with that PriorSpec (startup rebuilds the prior from it);
 * - the session snapshot (storage.sessions, kind 'story');
 * - credited speaking time (engine creditedMs of the utterance; typed answers earn none) in
 *   spoken_time. spokenTodayMs is read back for the local day (engine localDay).
 * learnerReplaced: the session's new LearnerModel becomes the learner (onLearnerReplaced
 * hands it to the app state, so every screen uses the same object).
 *
 * Speech: a step's SpeakCue plays through SpeechOut with the language pack's word spans; word
 * boundaries light the ViewWord being spoken (./speech.ts). After the sentence of an options
 * cliff, each option is read in turn (speakingOption). The no-sé answer calls
 * session.played() once it has played. Listening stops speech.
 *
 * Hold to speak: holdBegin checks the permission, holdStart listens in the pack's locale
 * (recognitionLocales) with the screen's words, options and commands as hints, publishing
 * level and partial; holdEnd stops and sends the final transcript to handleUtterance with
 * its voiced time (spokenMsOf) and word timings. typeAnswer takes the same path with no
 * duration, so the engine credits no speaking time.
 */
import {
  STORY_SESSION_FORMAT,
  StorySession,
  creditedMs,
  localDay,
  type LanguageModel,
  type LearnerEvent,
  type LearnerModel,
  type PriorSpec,
  type SentenceView,
  type SpeakCue,
  type SpokenCommand,
  type StoryScreen,
  type StorySessionOptions,
  type StorySessionSnapshot,
  type StoryStep,
  type TextMode,
  type UtteranceInfo,
} from '@cliffword/engine';
import type { Clock } from '../../adapters/clock/types';
import type { Haptics } from '../../adapters/haptics/types';
import type { Unsubscribe } from '../../adapters/listeners';
import type { ModelAdapter } from '../../adapters/model/types';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import { speechInErrorKey } from '../../adapters/speechIn/messages';
import { spokenMsOf } from '../../adapters/speechIn/timings';
import type { FinalTranscript, ListenOptions, SpeechIn, SpeechInErrorCode } from '../../adapters/speechIn/types';
import type { SpeechOut } from '../../adapters/speechOut/types';
import { normalizeLang } from '../../adapters/speechOut/voices';
import { tKey } from '../../i18n/tKey';
import type { ServicePacks } from '../../services/types';
import { createId, type StorageClock } from '../../storage/clock';
import type { AppSettings } from '../../storage/repos/settings';
import type { SqlDatabase, SqlTransaction } from '../../storage/sql/types';
import { createStorage, type Storage } from '../../storage/storage';
import type { ListenState, StoryActions, StoryController, StoryViewModel } from '../contract';
import { sameSessionSettings, sessionSettingsFor, startModeFor, toAppTextMode, toEngineTextMode } from './settings';
import { cueForScreen, hintsFor, planCue, sentenceOf, wordSpansOf, type CuePlan } from './speech';

export interface StoryControllerDeps {
  /** The language model; used while its status is 'ready', canned mode otherwise. */
  model: ModelAdapter;
  packs: ServicePacks;
  /** The learner model from the app state (useLearner()). */
  learner: LearnerModel;
  settings: AppSettings;
  /** The opened storage (useAppState().storage). */
  storage: Storage;
  speechOut: SpeechOut;
  speechIn: SpeechIn;
  haptics: Haptics;
  clock: Clock;
  /** The session replaced the learner (a new prior): put it in the app state (replaceLearner). */
  onLearnerReplaced?: (learner: LearnerModel) => void;
  /** Stores a settings change made on the story screen (the text mode pill). */
  updateSettings?: (patch: Partial<AppSettings>) => Promise<unknown>;
  /** The learner's UTC offset in minutes at `at` (local minus UTC). Default: the device's. */
  tzOffsetMin?: (at: number) => number;
  /** Seed of a new session. Default: from the clock. */
  seed?: () => number;
  /** The device's locales (expo-localization), for the recognition locale. */
  deviceLocales?: readonly string[];
  /** Engine session options (tests shorten chapters). */
  sessionOptions?: Partial<StorySessionOptions>;
  /** Unexpected failures (a step that threw, a write that failed). Default: console.warn. */
  onError?: (error: unknown) => void;
}

/** The controller, plus what its hook and tests need. */
export interface StoryControllerHandle extends StoryController {
  /** The learner the session updates now (the app state holds the same object). */
  readonly learner: LearnerModel;
  /** Settings changed elsewhere (profile, Music tab): apply them to the session. */
  setAppSettings(settings: AppSettings): void;
  /** Resolves once every queued call, and what it set off (speech callbacks), has run. */
  idle(): Promise<void>;
}

const IDLE: ListenState = { phase: 'idle' };

/** The view model before the first step. */
export function initialStoryViewModel(textMode: TextMode = 'auto', modelMode: StoryViewModel['modelMode'] = 'canned'): StoryViewModel {
  return {
    screen: null,
    speakingWord: null,
    speakingOption: null,
    textMode,
    listen: IDLE,
    busy: false,
    modelMode,
    meaning: null,
    spokenTodayMs: 0,
    notice: null,
    previous: [],
  };
}

export function createStoryController(deps: StoryControllerDeps): StoryControllerHandle {
  return new StoryControllerImpl(deps);
}

type ScreenKind = StoryScreen['kind'];
type Guard = (screen: StoryScreen | null) => boolean;

/** Screens "continue" applies to (at a cliff, skipping is the 'next' command, not next()). */
const NEXT_KINDS: ReadonlySet<ScreenKind> = new Set<ScreenKind>([
  'idle',
  'landing',
  'noSe',
  'nativeReply',
  'turn',
  'repair',
  'upNext',
  'retell',
  'register',
  'placementDone',
  'error',
]);

const anyScreen: Guard = (screen) => screen !== null;

/** One hold-to-speak gesture, from touch-down to the session's answer. */
interface Hold {
  phase: 'warming' | 'listening' | 'finishing';
  /** The permission check started at touch-down; resolves to an error code or null. */
  warm: Promise<SpeechInErrorCode | null>;
  starting: boolean;
  released: boolean;
  cancelled: boolean;
  gotFinal: boolean;
  gotError: boolean;
  unsubs: Unsubscribe[];
}

interface VoiceChoice {
  lang: string;
  voice?: string;
}

/** A transaction as a database for repositories: their own transactions join it. */
function transactionDatabase(tx: SqlTransaction): SqlDatabase {
  return {
    exec: (sql) => tx.exec(sql),
    run: (sql, params) => tx.run(sql, params),
    all: (sql, params) => tx.all(sql, params),
    get: (sql, params) => tx.get(sql, params),
    transaction: (task) => tx.transaction(task),
    close: () => Promise.reject(new Error('A transaction cannot be closed')),
  };
}

/** The prior a step asks to store: its own, or the finished placement's tracker. */
function priorOf(step: StoryStep): PriorSpec | undefined {
  if (step.prior) return step.prior;
  if (step.placement?.done && step.placement.snapshot) return { kind: 'placement', placement: step.placement.snapshot };
  return undefined;
}

const defaultTzOffset = (at: number) => -new Date(at).getTimezoneOffset();

class StoryControllerImpl implements StoryControllerHandle {
  readonly actions: StoryActions;

  private vm: StoryViewModel;
  private readonly listeners = new Set<() => void>();
  private readonly storageClock: StorageClock;
  private readonly unsubModel: Unsubscribe;
  private session: StorySession | null = null;
  private sessionId: string | null = null;
  private starting: Promise<void> | null = null;
  private current: LearnerModel;
  private settings: AppSettings;
  private tail: Promise<unknown> = Promise.resolve();
  private busyJobs = 0;
  private disposed = false;
  private hold: Hold | null = null;
  private speakToken = 0;
  private speechPending = 0;
  private lastCue: SpeakCue | null = null;
  private cliffWordIndex: number | null = null;
  private previous: SentenceView[] = [];
  private resolved: SentenceView | null = null;
  private chapter: number | null = null;
  private voicePick: Promise<VoiceChoice> | null = null;
  /** The "voice could not play" notice is shown once (a device without voices fails every cue). */
  private speechOutNoticed = false;

  constructor(private readonly deps: StoryControllerDeps) {
    this.current = deps.learner;
    this.settings = deps.settings;
    this.storageClock = { now: () => deps.clock.now(), newId: () => createId(deps.clock.now()) };
    this.vm = initialStoryViewModel(toEngineTextMode(deps.settings.textMode), this.modelMode());
    this.unsubModel = deps.model.onStatusChange(() => {
      this.set({ modelMode: this.modelMode() });
      // The session reads the model when it makes the next sentence.
      void this.enqueue(async () => this.session?.setModel(this.liveModel()));
    });
    this.actions = {
      start: () => void this.start(),
      next: () => this.step((s) => s !== null && NEXT_KINDS.has(s.kind), (session, at) => session.next(at), { busy: true, quiet: true }),
      hearWord: (index) => this.hearWord(index),
      revealWord: (index) => this.revealWord(index),
      replay: () => this.replay(),
      setTextMode: (mode) => this.setTextMode(mode),
      startRegisterTask: () =>
        this.step(
          (s) => s?.kind === 'upNext' && s.advanced.includes('register_switch'),
          (session, at) => session.startRegisterTask(at),
          { busy: true, quiet: true },
        ),
      holdBegin: () => this.holdBegin(),
      holdStart: () => this.holdStart(),
      holdEnd: () => this.holdEnd(),
      holdCancel: () => this.holdCancel(),
      typeAnswer: (text) => this.typeAnswer(text),
      command: (cmd, argument) => this.command(cmd, argument),
      pickOption: (index) =>
        this.step(
          (s) => s?.kind === 'cliff' && s.cliff.rung === 'options' && (s.cliff.options ?? []).some((o) => o.index === index),
          (session, at) => session.pickOption(index, at),
          { busy: true, quiet: true },
        ),
      closeMeaning: () => {
        if (this.vm.meaning) this.set({ meaning: null });
      },
      dismissNotice: () => {
        if (this.vm.notice) this.set({ notice: null });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // StoryController
  // ---------------------------------------------------------------------------

  get learner(): LearnerModel {
    return this.current;
  }

  getSnapshot = (): StoryViewModel => this.vm;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async suspend(): Promise<void> {
    if (this.disposed) return;
    this.cancelHold();
    this.stopSpeaking();
    await this.enqueue(async () => {
      const session = this.session;
      const id = this.sessionId;
      if (!session || !id) return;
      const at = this.deps.clock.now();
      try {
        await this.deps.storage.sessions.save({ id, kind: 'story', version: STORY_SESSION_FORMAT, snapshot: session.snapshot(), updatedAt: at });
        // A checkpoint of the learner (it keeps the stored prior).
        await this.deps.storage.learner.saveSnapshot(this.current, at);
      } catch (e) {
        this.report(e);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelHold();
    this.stopSpeaking();
    this.disposed = true;
    this.unsubModel();
    this.listeners.clear();
  }

  setAppSettings(settings: AppSettings): void {
    if (this.disposed) return;
    const before = this.settings;
    this.settings = settings;
    if (before.regions.join() !== settings.regions.join()) this.voicePick = null;
    const textMode = toEngineTextMode(settings.textMode);
    if (textMode !== this.vm.textMode) this.set({ textMode });
    void this.enqueue(async () => {
      const session = this.session;
      if (!session) return;
      const want = sessionSettingsFor(settings);
      if (sameSessionSettings(session.settings, want)) return;
      const at = this.deps.clock.now();
      await this.apply(session.setSettings(want, at), { at, credited: 0 });
    });
  }

  async idle(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const tail = this.tail;
      await tail;
      // Let settled speech promises run their callbacks (they may queue session.played()).
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (tail === this.tail) return;
    }
  }

  // ---------------------------------------------------------------------------
  // The queue and the view model
  // ---------------------------------------------------------------------------

  private set(patch: Partial<StoryViewModel>): void {
    if (this.disposed) return;
    this.vm = { ...this.vm, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Run `job` after every earlier job. A busy job keeps `busy` true from now until it ends. */
  private enqueue<T>(job: () => Promise<T>, busy = false): Promise<T | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (busy) {
      this.busyJobs += 1;
      if (!this.vm.busy) this.set({ busy: true });
    }
    const run = async (): Promise<T | undefined> => {
      try {
        if (this.disposed) return undefined;
        return await job();
      } catch (e) {
        this.report(e);
        return undefined;
      } finally {
        if (busy) {
          this.busyJobs -= 1;
          if (this.busyJobs === 0 && this.vm.busy) this.set({ busy: false });
        }
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result;
    return result;
  }

  /**
   * One call into the session, if `guard` passes now and again when its turn comes. `quiet`
   * stops speech first (the learner moved on).
   */
  private step(
    guard: Guard,
    call: (session: StorySession, at: number) => Promise<StoryStep> | StoryStep,
    opts: { busy?: boolean; quiet?: boolean; credited?: number; at?: number; hearIndex?: number } = {},
  ): Promise<void> {
    if (this.disposed || !this.session || !guard(this.vm.screen)) return Promise.resolve();
    if (opts.quiet) this.stopSpeaking();
    return this.enqueue(async () => {
      const session = this.session;
      if (!session || !guard(this.vm.screen)) return;
      const at = opts.at ?? this.deps.clock.now();
      let step: StoryStep;
      try {
        step = await call(session, at);
      } catch (e) {
        // Nothing of a failed step is written; show the screen the session is on now.
        this.report(e);
        this.set({ screen: session.screen, notice: { key: tKey('story.notice.stepFailed') } });
        return;
      }
      await this.apply(step, { at, credited: opts.credited ?? 0, hearIndex: opts.hearIndex });
    }, opts.busy ?? false).then(() => undefined);
  }

  private report(error: unknown): void {
    if (this.deps.onError) this.deps.onError(error);
    else console.warn('[story] controller error', error);
  }

  // ---------------------------------------------------------------------------
  // Starting and applying steps
  // ---------------------------------------------------------------------------

  private modelMode(): StoryViewModel['modelMode'] {
    return this.deps.model.status === 'ready' ? 'model' : 'canned';
  }

  private liveModel(): LanguageModel | null {
    return this.deps.model.status === 'ready' ? this.deps.model : null;
  }

  private sessionDeps() {
    return { model: this.liveModel(), pack: this.deps.packs.lang, pair: this.deps.packs.pair, learner: this.current };
  }

  private start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.starting ??= this.enqueue(() => this.open(), true).then(() => undefined);
    return this.starting;
  }

  private async open(): Promise<void> {
    if (this.session) return;
    const { storage, clock } = this.deps;
    const at = clock.now();
    await this.refreshSpokenToday(at);
    const options = { applyEvents: false, ...(this.deps.sessionOptions ? { options: this.deps.sessionOptions } : {}) };
    let session: StorySession | null = null;
    const record = await storage.sessions.active<StorySessionSnapshot>('story');
    if (record) {
      if (record.version === STORY_SESSION_FORMAT) {
        try {
          session = StorySession.restore(record.snapshot, this.sessionDeps(), options);
          this.sessionId = record.id;
        } catch (e) {
          this.report(e);
        }
      }
      // A snapshot this build cannot read is kept, but no longer offered for resume.
      if (!session) await storage.sessions.deactivate(record.id);
    }
    if (this.disposed) return;
    if (session) {
      this.session = session;
      const want = sessionSettingsFor(this.settings);
      if (!sameSessionSettings(session.settings, want)) {
        // Settings changed while the story was away (Music tab, profile).
        await this.apply(session.setSettings(want, at), { at, credited: 0 });
      } else {
        this.publishRestored(session.screen);
      }
      if (session.screen.kind !== 'idle') return;
    } else {
      const startMode = startModeFor(this.settings.startLevel, {
        storedPrior: await storage.learner.latestPrior(),
        earlierSessions: (await storage.sessions.list({ kind: 'story', limit: 1 })).length,
      });
      session = StorySession.create({
        ...this.sessionDeps(),
        now: at,
        seed: this.deps.seed?.() ?? at >>> 0,
        settings: sessionSettingsFor(this.settings),
        startMode,
        ...options,
      });
      this.session = session;
      this.sessionId = createId(at);
    }
    const first = clock.now();
    let step: StoryStep;
    try {
      step = await session.next(first);
    } catch (e) {
      this.report(e);
      this.set({ screen: session.screen, notice: { key: tKey('story.notice.stepFailed') } });
      return;
    }
    await this.apply(step, { at: first, credited: 0 });
  }

  private publishRestored(screen: StoryScreen): void {
    if (screen.kind === 'cliff') this.cliffWordIndex = screen.cliff.wordIndex;
    this.chapter = screen.meta.chapter;
    this.resolved = screen.kind === 'cliff' ? null : sentenceOf(screen);
    this.set({ screen, previous: [] });
  }

  /** Publish a step: persist it, then the screen, the meaning, the speech. */
  private async apply(step: StoryStep, ctx: { at: number; credited: number; hearIndex?: number }): Promise<void> {
    const session = this.session;
    // A controller disposed while a step ran (unmounted) writes nothing more.
    if (!session || this.disposed) return;
    if (step.learnerReplaced && session.learner !== this.current) {
      this.current = session.learner;
      this.deps.onLearnerReplaced?.(session.learner);
    }
    let spokenTodayMs = this.vm.spokenTodayMs;
    try {
      await this.persist(session, step.events, priorOf(step), ctx.at, ctx.credited);
      if (ctx.credited > 0) spokenTodayMs = await this.readSpokenToday(this.deps.clock.now());
    } catch (e) {
      this.report(e);
      if (ctx.credited > 0) spokenTodayMs += ctx.credited;
      this.set({ notice: { key: tKey('story.notice.notSaved') } });
    }
    const screen = step.screen;
    this.trackSentences(screen);
    const before = this.vm.screen;
    const meaning = step.meaning ?? (before?.kind === screen.kind ? this.vm.meaning : null);
    this.set({ screen, meaning, spokenTodayMs, previous: [...this.previous] });
    if (step.speak) await this.play(step.speak, { hearIndex: ctx.hearIndex });
    if (screen.kind === 'landing' || screen.kind === 'noSe') this.prefetch();
  }

  /**
   * HOOK (prefetch): engine/src/session/story.ts has no prefetch API yet (checked
   * 2026-11-16). When it gains one (making the next sentence while the learner is on a
   * landing or no-sé screen), call it from here through this.enqueue, so it never overlaps
   * another session call.
   */
  private prefetch(): void {
    // Nothing to do until the engine offers prefetching.
  }

  /** Events, prior, session snapshot and spoken time of one step, in one transaction. */
  private async persist(session: StorySession, events: readonly LearnerEvent[], prior: PriorSpec | undefined, at: number, credited: number): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    const snapshot = session.snapshot();
    const learner = this.current;
    let applied = false;
    try {
      await this.deps.storage.db.transaction(async (tx) => {
        const s = createStorage(transactionDatabase(tx), this.storageClock);
        if (events.length > 0) {
          // record() applies the events to the learner in this same synchronous step.
          const logged = s.learner.record(learner, events);
          applied = true;
          await logged;
        }
        if (prior) await s.learner.saveSnapshot(learner, at, { prior });
        await s.sessions.save({ id, kind: 'story', version: STORY_SESSION_FORMAT, snapshot, updatedAt: at });
        if (credited > 0) await s.spokenTime.addUtterance(credited, at);
      });
    } catch (e) {
      // Keep the learner in memory right even when the log could not be written.
      if (!applied && events.length > 0) learner.applyAll(events);
      throw e;
    }
  }

  /** The chapter's resolved sentences, for the passage above the current one (vm.previous). */
  private trackSentences(screen: StoryScreen): void {
    if (this.chapter !== screen.meta.chapter) {
      this.chapter = screen.meta.chapter;
      this.previous = [];
      this.resolved = null;
    }
    if (screen.kind === 'cliff') {
      this.cliffWordIndex = screen.cliff.wordIndex;
      if (this.resolved && this.resolved.text !== screen.sentence.text) this.previous = [...this.previous, this.resolved];
      if (this.resolved?.text !== screen.sentence.text) this.resolved = null;
      return;
    }
    const sentence = sentenceOf(screen);
    if (sentence) this.resolved = sentence;
  }

  private todayKey(at: number): string {
    return localDay(at, (this.deps.tzOffsetMin ?? defaultTzOffset)(at));
  }

  private readSpokenToday(at: number): Promise<number> {
    return this.deps.storage.spokenTime.day(this.todayKey(at));
  }

  private async refreshSpokenToday(at: number): Promise<void> {
    try {
      const ms = await this.readSpokenToday(at);
      if (ms !== this.vm.spokenTodayMs) this.set({ spokenTodayMs: ms });
    } catch (e) {
      this.report(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private hearWord(index: number): void {
    const visible: Guard = (s) => {
      const w = sentenceOf(s)?.words[index];
      return w !== undefined && (w.display === 'text' || w.display === 'tile');
    };
    void this.step(visible, (session, at) => session.tapWord(index, at), { hearIndex: index });
  }

  private revealWord(index: number): void {
    const tile: Guard = (s) => sentenceOf(s)?.words[index]?.display === 'tile';
    void this.step(tile, (session, at) => session.revealWord(index, at));
  }

  private replay(): void {
    if (this.disposed || !this.vm.screen) return;
    void this.enqueue(async () => {
      const cue = cueForScreen(this.deps.packs.lang, this.vm.screen);
      if (!cue) return;
      // The step's own cue keeps its rate ("más despacio" slows prompts too).
      const last = this.lastCue;
      await this.play(last && last.text === cue.text && last.what === cue.what ? last : cue);
    });
  }

  private setTextMode(mode: TextMode): void {
    if (this.disposed) return;
    const appMode = toAppTextMode(mode);
    this.settings = { ...this.settings, textMode: appMode };
    if (this.vm.textMode !== mode) this.set({ textMode: mode });
    this.deps.updateSettings?.({ textMode: appMode }).catch((e: unknown) => this.report(e));
    void this.step(anyScreen, (session, at) => session.setSettings({ textMode: mode }, at));
  }

  private command(cmd: SpokenCommand, argument?: string): void {
    if (this.disposed || !this.vm.screen) return;
    this.cancelHold();
    void this.step(anyScreen, (session, at) => session.command(cmd, at, argument), { busy: true, quiet: true });
  }

  private typeAnswer(text: string): void {
    const trimmed = text.trim();
    if (this.disposed || !trimmed || !this.vm.screen) return;
    this.cancelHold();
    this.submit({ text: trimmed, durationMs: 0, source: 'typed' }, null);
  }

  /** A final transcript (spoken or typed) to the session. Typed answers carry no duration, so they earn no speaking time. */
  private submit(t: FinalTranscript, hold: Hold | null): void {
    const at = this.deps.clock.now();
    const typed = t.source === 'typed';
    const durationMs = typed ? 0 : spokenMsOf(t);
    const info: UtteranceInfo = typed
      ? {}
      : {
          durationMs,
          ...(t.words && t.words.length > 0 ? { words: t.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })) } : {}),
        };
    this.stopSpeaking();
    void this.step(anyScreen, (session) => session.handleUtterance(t.text, at, info), {
      busy: true,
      at,
      credited: typed ? 0 : creditedMs(durationMs),
    }).finally(() => {
      if (hold && this.hold === hold) {
        this.hold = null;
        this.set({ listen: IDLE });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Hold to speak
  // ---------------------------------------------------------------------------

  private holdBegin(): void {
    if (this.disposed || !this.vm.screen || this.hold) return;
    this.hold = {
      phase: 'warming',
      warm: this.warm(),
      starting: false,
      released: false,
      cancelled: false,
      gotFinal: false,
      gotError: false,
      unsubs: [],
    };
    this.set({ listen: { phase: 'warming' } });
  }

  /** The permission check of touch-down: asks once when undecided. */
  private async warm(): Promise<SpeechInErrorCode | null> {
    const { speechIn } = this.deps;
    try {
      let permission = await speechIn.permissionStatus();
      if (permission === 'undetermined') permission = await speechIn.requestPermission();
      return permission === 'denied' ? 'not-allowed' : null;
    } catch {
      // start() reports what is wrong.
      return null;
    }
  }

  private holdStart(): void {
    if (!this.hold) this.holdBegin();
    const hold = this.hold;
    if (!hold || hold.phase !== 'warming' || hold.starting) return;
    hold.starting = true;
    void this.listen(hold);
  }

  private async listen(hold: Hold): Promise<void> {
    const { speechIn, haptics } = this.deps;
    const error = await hold.warm;
    if (this.hold !== hold || hold.cancelled || this.disposed) return;
    if (error) {
      this.failHold(hold, error);
      return;
    }
    if (hold.released) {
      // Let go before listening began: a tap, not a hold.
      this.endHold(hold, IDLE);
      return;
    }
    this.stopSpeaking();
    haptics.play('tap');
    hold.unsubs.push(
      speechIn.onPartial((text) => {
        if (this.hold === hold && hold.phase === 'listening' && this.vm.listen.phase === 'listening') {
          this.set({ listen: { ...this.vm.listen, partial: text } });
        }
      }),
      speechIn.onMeter((level) => {
        if (this.hold === hold && hold.phase === 'listening' && this.vm.listen.phase === 'listening') {
          this.set({ listen: { ...this.vm.listen, level } });
        }
      }),
      speechIn.onFinal((transcript) => {
        if (this.hold !== hold || hold.gotFinal || hold.cancelled) return;
        hold.gotFinal = true;
        if (hold.phase === 'listening') haptics.play('selection');
        hold.phase = 'finishing';
        this.set({ listen: { phase: 'finishing' } });
        this.submit(transcript, hold);
      }),
      speechIn.onError((e) => {
        if (this.hold !== hold || hold.cancelled) return;
        hold.gotError = true;
        this.failHold(hold, e.code);
      }),
      speechIn.onEnd(() => {
        for (const unsub of hold.unsubs.splice(0)) unsub();
        if (this.hold !== hold || hold.gotFinal || hold.gotError || hold.cancelled) return;
        // Ended with nothing recognized.
        this.failHold(hold, 'no-speech');
      }),
    );
    hold.phase = 'listening';
    this.set({ listen: { phase: 'listening', level: 0, partial: '' } });
    await speechIn.start(this.listenOptions());
    if (this.hold === hold && hold.released && hold.phase === 'listening' && speechIn.isListening) await this.release(hold);
  }

  private holdEnd(): void {
    const hold = this.hold;
    if (!hold) return;
    if (hold.phase === 'warming' && !hold.starting) {
      this.endHold(hold, IDLE);
      return;
    }
    hold.released = true;
    if (hold.phase === 'listening') void this.release(hold);
  }

  private async release(hold: Hold): Promise<void> {
    hold.phase = 'finishing';
    this.deps.haptics.play('selection');
    this.set({ listen: { phase: 'finishing' } });
    try {
      await this.deps.speechIn.stop();
    } catch (e) {
      this.report(e);
      this.failHold(hold, 'unknown');
    }
  }

  private holdCancel(): void {
    this.cancelHold();
  }

  /** Drop the current hold (and its utterance, unless the final already arrived). */
  private cancelHold(): void {
    const hold = this.hold;
    if (!hold) return;
    if (hold.gotFinal) return;
    hold.cancelled = true;
    if (hold.phase !== 'warming' || hold.starting) {
      if (this.deps.speechIn.isListening) this.deps.speechIn.abort();
    }
    this.endHold(hold, IDLE);
  }

  private failHold(hold: Hold, code: SpeechInErrorCode): void {
    if (this.hold !== hold) return;
    this.deps.haptics.play('error');
    this.endHold(hold, { phase: 'error', messageKey: speechInErrorKey(code) });
  }

  private endHold(hold: Hold, listen: ListenState): void {
    if (this.hold === hold) this.hold = null;
    if (!this.deps.speechIn.isListening) for (const unsub of hold.unsubs.splice(0)) unsub();
    this.set({ listen });
  }

  private listenOptions(): ListenOptions {
    const pack = this.deps.packs.lang;
    const locales = recognitionLocales(pack.code, this.settings.regions, this.deps.deviceLocales ?? []);
    return {
      lang: locales[0] ?? pack.code,
      langFallbacks: locales.slice(1),
      onDevice: true,
      interim: true,
      continuous: true,
      hints: hintsFor(pack, this.vm.screen),
    };
  }

  // ---------------------------------------------------------------------------
  // Speech out
  // ---------------------------------------------------------------------------

  /** The voice for the target language: the first installed one in the learner's region order. */
  private voice(): Promise<VoiceChoice> {
    this.voicePick ??= (async (): Promise<VoiceChoice> => {
      const pack = this.deps.packs.lang;
      const wanted = recognitionLocales(pack.code, this.settings.regions, this.deps.deviceLocales ?? []);
      try {
        const voices = await this.deps.speechOut.voices(pack.code);
        for (const lang of wanted) {
          const v = voices.find((x) => normalizeLang(x.lang) === normalizeLang(lang));
          if (v) return { lang: v.lang, voice: v.id };
        }
        const first = voices[0];
        if (first) return { lang: first.lang, voice: first.id };
      } catch {
        // The platform default voice for the language.
      }
      return { lang: wanted[0] ?? pack.code };
    })();
    return this.voicePick;
  }

  /** Play a cue (not awaited to the end): lights tiles, then reads options or reports played(). */
  private async play(cue: SpeakCue, opts: { hearIndex?: number } = {}): Promise<void> {
    if (this.disposed) return;
    if (cue.what !== 'word') this.lastCue = cue;
    if (this.hold && this.hold.phase !== 'finishing') {
      // The learner is about to speak or speaking: do not talk over them; a no-sé answer still moves on.
      this.afterPlayed(cue, true, this.speakToken);
      return;
    }
    const token = ++this.speakToken;
    const pack = this.deps.packs.lang;
    let plan: CuePlan;
    if (opts.hearIndex !== undefined) {
      const spans = wordSpansOf(pack, cue.text);
      plan = { spans, viewIndex: spans.map(() => opts.hearIndex ?? null) };
    } else {
      plan = planCue(pack, cue.text, sentenceOf(this.vm.screen)?.text ?? null, cue.what === 'answer' ? this.cliffWordIndex : 0);
    }
    if (this.vm.speakingWord !== null || this.vm.speakingOption !== null) this.set({ speakingWord: null, speakingOption: null });
    const voice = await this.voice();
    if (token !== this.speakToken || this.disposed) return;
    this.speechPending += 1;
    void this.deps.speechOut
      .speak(cue.text, {
        ...voice,
        rate: cue.rate,
        words: plan.spans,
        onWordBoundary: (b) => {
          if (token === this.speakToken) this.set({ speakingWord: plan.viewIndex[b.index] ?? null });
        },
      })
      .then(
        (result) => {
          if (token !== this.speakToken) return;
          this.set({ speakingWord: null });
          this.afterPlayed(cue, result.completed, token);
        },
        (e: unknown) => {
          this.report(e);
          if (token !== this.speakToken) return;
          this.set({ speakingWord: null });
          if (!this.speechOutNoticed) {
            this.speechOutNoticed = true;
            this.set({ notice: { key: tKey('story.notice.speechOut') } });
          }
          // The learner can read the answer: the no-sé flow still moves on.
          this.afterPlayed(cue, true, token, true);
        },
      )
      .finally(() => {
        this.speechPending -= 1;
      });
  }

  private afterPlayed(cue: SpeakCue, completed: boolean, token: number, failed = false): void {
    const screen = this.vm.screen;
    if (!completed || this.disposed) return;
    if (cue.what === 'answer' && screen?.kind === 'noSe' && screen.step === 'play_answer') {
      void this.step((s) => s?.kind === 'noSe' && s.step === 'play_answer', (session, at) => session.played(at));
      return;
    }
    if (!failed && cue.what === 'sentence' && screen?.kind === 'cliff' && screen.cliff.rung === 'options' && screen.cliff.options?.length) {
      void this.readOptions(screen.cliff.options, cue.rate, token);
    }
  }

  /** The options rung: each option spoken in turn, its chip lit (speakingOption). */
  private async readOptions(options: readonly { index: number; text: string }[], rate: number, token: number): Promise<void> {
    const pack = this.deps.packs.lang;
    this.speechPending += 1;
    try {
      for (const option of options) {
        if (token !== this.speakToken || this.disposed) return;
        this.set({ speakingOption: option.index });
        const voice = await this.voice();
        if (token !== this.speakToken) return;
        const result = await this.deps.speechOut.speak(option.text, { ...voice, rate, words: wordSpansOf(pack, option.text) });
        if (!result.completed) return;
      }
    } catch (e) {
      this.report(e);
    } finally {
      this.speechPending -= 1;
      if (token === this.speakToken && this.vm.speakingOption !== null) this.set({ speakingOption: null });
    }
  }

  /** Stop what this controller is saying (a new step, listening, suspend). */
  private stopSpeaking(): void {
    this.speakToken += 1;
    if (this.vm.speakingWord !== null || this.vm.speakingOption !== null) this.set({ speakingWord: null, speakingOption: null });
    if (this.speechPending > 0) void this.deps.speechOut.stop().catch((e: unknown) => this.report(e));
  }
}
