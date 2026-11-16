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
 * - Every call into the session runs through one serial queue (src/session/common/queue.ts:
 *   the session's async steps must not overlap, and its sync ones are not busy-safe); `busy`
 *   is true while queued async steps run. An action is checked against the screen when called and again when its
 *   turn comes, so a double tap never lands on the next screen.
 * - The model: the session gets the ModelAdapter while its status is 'ready' and null
 *   (canned mode) otherwise; onStatusChange switches it, effective at the next sentence.
 *
 * After every step, in one storage transaction (src/session/common/persist.ts):
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
 * Speech: a step's SpeakCue plays through the shared Speaker (src/session/common/speaker.ts: the
 * learner's chosen voice, else picked by region) with the language pack's word spans; word
 * boundaries light the ViewWord being spoken (./speech.ts). After the sentence of an options
 * cliff, each option is read in turn (speakingOption). The no-sé answer calls
 * session.played() once it has played. Listening stops speech.
 *
 * Hold to speak (src/session/common/hold.ts, shared with the Music tab): holdBegin checks the
 * permission, holdStart listens in the pack's locale (recognitionLocales; on the device unless
 * network recognition is allowed) with the screen's words, options and commands as hints,
 * publishing level and partial; holdEnd stops and sends the final transcript to
 * handleUtterance with its voiced time and word timings (utteranceOf). typeAnswer takes the
 * same path with no duration, so the engine credits no speaking time.
 */
import {
  STORY_SESSION_FORMAT,
  StorySession,
  type LanguageModel,
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
} from '@cliffword/engine';
import type { Clock } from '../../adapters/clock/types';
import type { Haptics } from '../../adapters/haptics/types';
import type { Unsubscribe } from '../../adapters/listeners';
import type { ModelAdapter } from '../../adapters/model/types';
import type { FinalTranscript, SpeechIn } from '../../adapters/speechIn/types';
import type { SpeechOut } from '../../adapters/speechOut/types';
import { tKey } from '../../i18n/tKey';
import type { ServicePacks } from '../../services/types';
import { createId, type StorageClock } from '../../storage/clock';
import type { AppSettings } from '../../storage/repos/settings';
import type { Storage } from '../../storage/storage';
import { HoldToSpeak, LISTEN_IDLE } from '../common/hold';
import { listenOptionsFor } from '../common/listen';
import { dayKey, persistStep, storageClockOf } from '../common/persist';
import { SerialQueue } from '../common/queue';
import { Speaker } from '../common/speaker';
import { typedTranscript, utteranceOf } from '../common/utterance';
import type { StoryActions, StoryController, StoryViewModel } from '../contract';
import { sameSessionSettings, sessionSettingsFor, startModeFor, toAppTextMode, toEngineTextMode } from './settings';
import { cueForScreen, planCue, sentenceOf, storyHintWords, wordSpansOf, type CuePlan } from './speech';

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

/** The view model before the first step. */
export function initialStoryViewModel(textMode: TextMode = 'auto', modelMode: StoryViewModel['modelMode'] = 'canned'): StoryViewModel {
  return {
    screen: null,
    speakingWord: null,
    speakingOption: null,
    textMode,
    listen: LISTEN_IDLE,
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

/** The prior a step asks to store: its own, or the finished placement's tracker. */
function priorOf(step: StoryStep): PriorSpec | undefined {
  if (step.prior) return step.prior;
  if (step.placement?.done && step.placement.snapshot) return { kind: 'placement', placement: step.placement.snapshot };
  return undefined;
}

class StoryControllerImpl implements StoryControllerHandle {
  readonly actions: StoryActions;

  private vm: StoryViewModel;
  private readonly listeners = new Set<() => void>();
  private readonly storageClock: StorageClock;
  private readonly unsubModel: Unsubscribe;
  private readonly queue: SerialQueue;
  private readonly hold: HoldToSpeak;
  private readonly speaker: Speaker;
  private session: StorySession | null = null;
  private sessionId: string | null = null;
  private starting: Promise<void> | null = null;
  private current: LearnerModel;
  private settings: AppSettings;
  private disposed = false;
  /** Advances with every cue played or stopped: callbacks of an older cue do nothing. */
  private speakToken = 0;
  private lastCue: SpeakCue | null = null;
  private cliffWordIndex: number | null = null;
  private previous: SentenceView[] = [];
  private resolved: SentenceView | null = null;
  private chapter: number | null = null;
  /** The "voice could not play" notice is shown once (a device without voices fails every cue). */
  private speechOutNoticed = false;

  constructor(private readonly deps: StoryControllerDeps) {
    this.current = deps.learner;
    this.settings = deps.settings;
    this.storageClock = storageClockOf(deps.clock);
    this.vm = initialStoryViewModel(toEngineTextMode(deps.settings.textMode), this.modelMode());
    this.queue = new SerialQueue({
      onBusy: (busy) => this.set({ busy }),
      onError: (e) => this.report(e),
    });
    this.speaker = new Speaker({
      speechOut: deps.speechOut,
      pack: deps.packs.lang,
      regions: () => this.settings.regions,
      voiceId: () => this.settings.voiceId,
      ...(deps.deviceLocales ? { deviceLocales: deps.deviceLocales } : {}),
      onError: (e) => this.report(e),
    });
    this.hold = new HoldToSpeak({
      speechIn: deps.speechIn,
      haptics: deps.haptics,
      publish: (listen) => this.set({ listen }),
      current: () => this.vm.listen,
      canHold: () => !this.disposed && this.vm.screen !== null,
      // Listening stops speech: never talk over the learner.
      beforeListen: () => this.stopSpeaking(),
      listenOptions: () =>
        listenOptionsFor(deps.packs.lang, this.settings.regions, deps.deviceLocales ?? [], storyHintWords(deps.packs.lang, this.vm.screen), {
          allowNetwork: this.settings.allowNetworkRecognition,
        }),
      onFinal: (t) => this.submit(t),
      onError: (e) => this.report(e),
    });
    this.unsubModel = deps.model.onStatusChange(() => {
      this.set({ modelMode: this.modelMode() });
      // The session reads the model when it makes the next sentence.
      void this.queue.enqueue(() => this.session?.setModel(this.liveModel()));
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
      holdBegin: () => this.hold.begin(),
      holdStart: () => this.hold.start(),
      holdEnd: () => this.hold.end(),
      holdCancel: () => this.hold.cancel(),
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
    this.hold.cancel();
    this.stopSpeaking();
    await this.queue.enqueue(async () => {
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
    this.hold.dispose();
    this.stopSpeaking();
    this.disposed = true;
    this.queue.close();
    this.unsubModel();
    this.listeners.clear();
  }

  setAppSettings(settings: AppSettings): void {
    if (this.disposed) return;
    const before = this.settings;
    this.settings = settings;
    if (before.regions.join() !== settings.regions.join() || before.voiceId !== settings.voiceId) this.speaker.resetVoice();
    const textMode = toEngineTextMode(settings.textMode);
    if (textMode !== this.vm.textMode) this.set({ textMode });
    void this.queue.enqueue(async () => {
      const session = this.session;
      if (!session) return;
      const want = sessionSettingsFor(settings);
      if (sameSessionSettings(session.settings, want)) return;
      const at = this.deps.clock.now();
      await this.apply(session.setSettings(want, at), { at, credited: 0 });
    });
  }

  /** Every queued call and what it set off (settled speech promises may queue session.played()). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ---------------------------------------------------------------------------
  // The queue and the view model
  // ---------------------------------------------------------------------------

  private set(patch: Partial<StoryViewModel>): void {
    if (this.disposed) return;
    this.vm = { ...this.vm, ...patch };
    for (const listener of [...this.listeners]) listener();
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
    return this.queue.enqueue(async () => {
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
    this.starting ??= this.queue.enqueue(() => this.open(), true).then(() => undefined);
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
      await this.persist(session, step, ctx.at, ctx.credited);
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

  /** Events, prior, session snapshot and spoken time of one step, in one transaction (persistStep). */
  private async persist(session: StorySession, step: StoryStep, at: number, credited: number): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    const learner = this.current;
    const prior = priorOf(step);
    await persistStep(this.deps.storage, this.storageClock, {
      learner,
      events: step.events,
      session: { id, kind: 'story', version: STORY_SESSION_FORMAT, snapshot: session.snapshot(), updatedAt: at },
      creditedMs: credited,
      at,
      ...(prior ? { extra: async (tx: Storage) => void (await tx.learner.saveSnapshot(learner, at, { prior })) } : {}),
    });
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

  private readSpokenToday(at: number): Promise<number> {
    return this.deps.storage.spokenTime.day(dayKey(at, this.deps.tzOffsetMin));
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
    void this.queue.enqueue(async () => {
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
    this.hold.cancel();
    void this.step(anyScreen, (session, at) => session.command(cmd, at, argument), { busy: true, quiet: true });
  }

  private typeAnswer(text: string): void {
    const trimmed = text.trim();
    if (this.disposed || !trimmed || !this.vm.screen) return;
    this.hold.cancel();
    void this.submit(typedTranscript(trimmed));
  }

  /**
   * A final transcript (spoken or typed) to the session. Typed answers carry no duration, so
   * they earn no speaking time. A hold stays 'finishing' until this resolves.
   */
  private submit(t: FinalTranscript): Promise<void> {
    const u = utteranceOf(t);
    const at = this.deps.clock.now();
    this.stopSpeaking();
    return this.step(anyScreen, (session) => session.handleUtterance(u.text, at, u.info), { busy: true, at, credited: u.credited });
  }

  // ---------------------------------------------------------------------------
  // Speech out
  // ---------------------------------------------------------------------------

  /** Play a cue (not awaited to the end): lights tiles, then reads options or reports played(). */
  private async play(cue: SpeakCue, opts: { hearIndex?: number } = {}): Promise<void> {
    if (this.disposed) return;
    if (cue.what !== 'word') this.lastCue = cue;
    if (this.hold.holding) {
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
    // The voice is picked once; once it is known, the cue starts on the next tick.
    await this.speaker.voice();
    if (token !== this.speakToken || this.disposed) return;
    void this.speaker
      .say(cue.text, {
        rate: cue.rate,
        words: plan.spans,
        onWord: (b) => {
          if (token === this.speakToken) this.set({ speakingWord: plan.viewIndex[b.index] ?? null });
        },
      })
      .then((outcome) => {
        if (token !== this.speakToken || this.disposed) return;
        if (this.vm.speakingWord !== null) this.set({ speakingWord: null });
        if (outcome === 'failed') {
          if (!this.speechOutNoticed) {
            this.speechOutNoticed = true;
            this.set({ notice: { key: tKey('story.notice.speechOut') } });
          }
          // The learner can read the answer: the no-sé flow still moves on.
          this.afterPlayed(cue, true, token, true);
          return;
        }
        this.afterPlayed(cue, outcome === 'completed', token);
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
    try {
      for (const option of options) {
        if (token !== this.speakToken || this.disposed || this.hold.holding) return;
        this.set({ speakingOption: option.index });
        const outcome = await this.speaker.say(option.text, { rate });
        if (outcome !== 'completed') return;
      }
    } finally {
      if (token === this.speakToken && this.vm.speakingOption !== null) this.set({ speakingOption: null });
    }
  }

  /** Stop what this controller is saying (a new step, listening, suspend). */
  private stopSpeaking(): void {
    this.speakToken += 1;
    if (this.vm.speakingWord !== null || this.vm.speakingOption !== null) this.set({ speakingWord: null, speakingOption: null });
    this.speaker.stop();
  }
}
