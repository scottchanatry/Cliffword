/**
 * The Music tab's controller (src/session/contract.ts LyricController) for one song with pasted
 * lyrics or one brought text: it owns an engine LyricSession and the speech, music and storage
 * plumbing around it, and publishes a LyricViewModel. The engine's LyricScreens are the view
 * data; nothing here reshapes them.
 *
 * Session lifecycle
 * - start(): loads the song (or text) from storage (./source.ts). A song without lyrics, or one
 *   that does not exist, publishes that state (getSource()) and no session. Otherwise the
 *   stored session of that song is restored (row 'lyric:<songId>' / 'text:<textId>', version
 *   LYRIC_SESSION_FORMAT, made from the same lyrics), or a new one is created on the song page
 *   (read). Restoring plays nothing: audio only ever follows a learner's action.
 * - Every call into the session runs through one serial queue (src/session/common/queue.ts);
 *   `busy` is true while queued async steps run. Actions are checked against the screen when
 *   called and again when their turn comes.
 * - The model: the session gets the ModelAdapter while it is 'ready' and runs canned otherwise
 *   (cliffs on slang or the last word, answers matched by form); onStatusChange switches it.
 *
 * After every step, in one transaction (src/session/common/persist.ts): the step's learner events
 * (the session runs with applyEvents false; storage.learner.record applies and logs them once),
 * the session snapshot, and the credited speaking time of a spoken answer (typed answers earn
 * none) in spoken_time. spokenTodayMs is read back for the local day.
 *
 * Sound
 * - Manual mode (no Apple Music, a song not linked to it, or lines without times): the voice
 *   reads each step's SpeakCue (the line up to the gap, the answer, the line), then the options
 *   of an options cliff in turn. A no-sé answer reports played() once heard.
 * - Timed mode (the song is an Apple Music library song, access granted, and the line has LRC or
 *   tapped times): on next, a tapped line, again or play the track plays up to the cliff
 *   (LinePlay.pauseAtMs) and pauses there (MusicPlayer.pauseAt). When the pause is at the line
 *   start (no word marks), the voice then reads the line up to the gap. Playback resumes only on
 *   a learner's action (App Review 4.5.2), never on its own.
 * - Never record while the track plays, never talk over it: holding pauses the track first, and
 *   so does every spoken cue. The sing-back (startEcho) pauses before it starts.
 *
 * Hold to speak and typed answers work exactly as on the Story tab (src/session/common/hold.ts):
 * the final transcript goes to handleUtterance with its voiced time; a recognized command
 * ("siguiente", "otra vez") acts like its chip.
 *
 * Brought text: the same session over { kind: 'text' }; with the model loaded, the controller
 * also scores the text's surprise map (vm.surprise) for the reader's amber shading.
 */
import {
  LYRIC_SESSION_FORMAT,
  LyricSession,
  lexemeKey,
  surpriseMap,
  type LanguageModel,
  type LearnerEvent,
  type LearnerModel,
  type LinePlay,
  type LyricScreen,
  type LyricSessionOptions,
  type LyricSessionSnapshot,
  type LyricStep,
  type SpeakCue,
  type SpokenCommand,
} from '@cliffword/engine';
import type { Clock } from '../../adapters/clock/types';
import type { Haptics } from '../../adapters/haptics/types';
import type { Unsubscribe } from '../../adapters/listeners';
import type { ModelAdapter } from '../../adapters/model/types';
import type { MusicPlayer } from '../../adapters/music/types';
import type { FinalTranscript, SpeechIn } from '../../adapters/speechIn/types';
import type { SpeechOut } from '../../adapters/speechOut/types';
import { tKey } from '../../i18n/tKey';
import type { ServicePacks } from '../../services/types';
import type { AppSettings } from '../../storage/repos/settings';
import type { StorageClock } from '../../storage/clock';
import type { Storage } from '../../storage/storage';
import { HoldToSpeak, LISTEN_IDLE } from '../common/hold';
import { listenOptionsFor } from '../common/listen';
import { dayKey, persistStep, storageClockOf } from '../common/persist';
import { SerialQueue } from '../common/queue';
import { Speaker, type SayOutcome } from '../common/speaker';
import { typedTranscript, utteranceOf } from '../common/utterance';
import type { LyricActions, LyricController, LyricViewModel, PlaybackState } from '../contract';
import { sameSessionSettings, sessionSettingsFor } from '../story/settings';
import { loadLyricSource, sameSource, type LoadedSource, type LyricSourceState, type LyricTarget } from './source';
import { lyricCueForScreen, lyricHintWords } from './speech';
import { NO_PLAYBACK, Track, type Ticker } from './track';

export interface LyricControllerDeps {
  /** The song or text to open. */
  target: LyricTarget;
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
  /** Apple Music (UnsupportedMusicPlayer on Android and web). */
  music: MusicPlayer;
  /** Stores a settings change made on a song screen (register, explicit lyrics). */
  updateSettings?: (patch: Partial<AppSettings>) => Promise<unknown>;
  /** The learner's UTC offset in minutes at `at` (local minus UTC). Default: the device's. */
  tzOffsetMin?: (at: number) => number;
  /** Seed of a new session. Default: from the clock. */
  seed?: () => number;
  /** The device's locales (expo-localization), for the recognition locale. */
  deviceLocales?: readonly string[];
  /** Engine session options. */
  sessionOptions?: Partial<LyricSessionOptions>;
  /** Re-reads the playback position while the track plays. Default: setInterval; null: none (tests). */
  ticker?: Ticker | null;
  /** Unexpected failures (a step that threw, a write that failed). Default: console.warn. */
  onError?: (error: unknown) => void;
}

/** A line of the song or text with its tapped start, for "time it while you listen". */
export interface TimingLine {
  index: number;
  text: string;
  /** Tapped (or LRC) start, ms; null until known. */
  startMs: number | null;
}

/** The controller, plus what its hook, routes and tests need. */
export interface LyricControllerHandle extends Omit<LyricController, 'actions'> {
  /** The contract's actions; the optional ones (setShowExplicit, hearWord) are always present here. */
  readonly actions: Required<LyricActions>;
  readonly target: LyricTarget;
  /** Loading, missing, a song that needs lyrics, or ready (title, artist, genre, linked). */
  getSource(): LyricSourceState;
  /** Settings changed elsewhere (profile, library pills): apply them to the session. */
  setAppSettings(settings: AppSettings): void;
  /** The lyrics were pasted again (or the song renamed): load the song and session afresh. */
  reload(): void;
  /** Lines with their tapped starts ("time it while you listen"). */
  timingLines(): TimingLine[];
  /** The track's position now (exact, not the throttled vm value); 0 without a track. */
  positionMs(): number;
  /** Play the track from `ms` (a learner's tap on the timing screen). */
  playFrom(ms: number): void;
  /** Resolves once every queued call, and what it set off, has run. */
  idle(): Promise<void>;
}

/** The view model before the session opens. */
export function initialLyricViewModel(settings?: Pick<AppSettings, 'register' | 'regions' | 'showExplicit'>, modelMode: LyricViewModel['modelMode'] = 'canned'): LyricViewModel {
  return {
    screen: null,
    playback: NO_PLAYBACK,
    register: settings?.register ?? 'neutral',
    showExplicit: settings?.showExplicit ?? true,
    regions: settings?.regions ?? [],
    surprise: null,
    listen: LISTEN_IDLE,
    busy: false,
    modelMode,
    meaning: null,
    spokenTodayMs: 0,
    notice: null,
  };
}

export function createLyricController(deps: LyricControllerDeps): LyricControllerHandle {
  return new LyricControllerImpl(deps);
}

type Guard = (screen: LyricScreen | null) => boolean;

/**
 * How a step's sound plays:
 * - tts: the step's SpeakCue through the voice (pausing the track first);
 * - move: a learner moved to a line (next, a tapped line, the next command): the track plays to
 *   the cliff when the line is timed, else the voice reads the cue;
 * - replay: "again": like move, but the track always starts the run-up again;
 * - echo: the sing-back: the track plays the line once when timed, else the voice reads it;
 * - none: nothing (settings, register, timing taps, restore).
 */
type CueMode = 'tts' | 'move' | 'replay' | 'echo' | 'none';

const anyScreen: Guard = (screen) => screen !== null;
const lineScreens = new Set<LyricScreen['kind']>(['line', 'result', 'noSe', 'nativeReply', 'echo']);

/** A run-up before a line whose previous line has no time: this much of the track. */
const RUN_UP_MS = 6000;
/** "Hear this word slowly" on an echo tile. */
const SLOW_WORD_RATE = 0.7;

class LyricControllerImpl implements LyricControllerHandle {
  readonly actions: Required<LyricActions>;

  private vm: LyricViewModel;
  private source: LyricSourceState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private readonly storageClock: StorageClock;
  private readonly queue: SerialQueue;
  private readonly hold: HoldToSpeak;
  private readonly speaker: Speaker;
  private readonly unsubModel: Unsubscribe;
  private session: LyricSession | null = null;
  private loaded: LoadedSource | null = null;
  private track: Track | null = null;
  private starting: Promise<void> | null = null;
  private settings: AppSettings;
  private disposed = false;
  /** The last cue spoken (its rate survives "más despacio" for a replay). */
  private lastCue: SpeakCue | null = null;
  /** Each line's play info as last shown on a cliff or line screen (the echo replays it). */
  private readonly plays = new Map<number, LinePlay>();
  /** The "voice could not play" notice is shown once. */
  private speechOutNoticed = false;
  private surpriseRegister: string | null = null;

  constructor(private readonly deps: LyricControllerDeps) {
    this.settings = deps.settings;
    this.storageClock = storageClockOf(deps.clock);
    this.vm = initialLyricViewModel(deps.settings, this.modelMode());
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
      canHold: () => this.vm.screen !== null && !this.disposed,
      // Never record while the track plays, never over the voice.
      beforeListen: async () => {
        this.speaker.stop();
        await this.track?.pauseIfPlaying();
      },
      listenOptions: () =>
        listenOptionsFor(deps.packs.lang, this.settings.regions, deps.deviceLocales ?? [], lyricHintWords(deps.packs.lang, this.vm.screen), {
          allowNetwork: this.settings.allowNetworkRecognition,
        }),
      onFinal: (t) => this.submit(t),
      onError: (e) => this.report(e),
    });
    this.unsubModel = deps.model.onStatusChange(() => {
      this.set({ modelMode: this.modelMode() });
      void this.queue.enqueue(async () => {
        this.session?.setModel(this.liveModel());
        await this.scoreSurprise();
      });
    });
    this.actions = {
      start: () => void this.start(),
      next: () => void this.step((s) => s !== null && s.kind !== 'done', (session, at) => session.next(at), { busy: true, quiet: true, cue: 'move' }),
      openLine: (index) =>
        void this.step(
          (s) => s !== null && Number.isInteger(index) && index >= 0 && index < s.meta.total,
          (session, at) => session.openLine(index, at),
          { busy: true, quiet: true, cue: 'move' },
        ),
      startEcho: () => this.startEcho(),
      setRegister: (register) => this.setRegister(register),
      showSong: () => void this.step((s) => s !== null && s.kind !== 'read', (session) => session.showSong(), { quiet: true, cue: 'none' }),
      markLine: (index, positionMs) =>
        void this.step(
          (s) => s !== null && Number.isInteger(index) && index >= 0 && index < s.meta.total && Number.isFinite(positionMs) && positionMs >= 0,
          (session) => session.markLine(index, positionMs),
          { cue: 'none' },
        ),
      play: () => this.play(),
      pause: () => {
        if (this.track?.available) void this.track.pause();
      },
      setShowExplicit: (show) => this.setShowExplicit(show),
      hearWord: (index) => this.hearWord(index),
      holdBegin: () => this.hold.begin(),
      holdStart: () => this.hold.start(),
      holdEnd: () => this.hold.end(),
      holdCancel: () => this.hold.cancel(),
      typeAnswer: (text) => this.typeAnswer(text),
      command: (cmd, argument) => this.command(cmd, argument),
      pickOption: (index) =>
        void this.step(
          (s) => s?.kind === 'cliff' && s.rung === 'options' && (s.options ?? []).some((o) => o.index === index),
          (session, at) => session.pickOption(index, at),
          { busy: true, quiet: true, cue: 'tts' },
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
  // LyricController
  // ---------------------------------------------------------------------------

  get target(): LyricTarget {
    return this.deps.target;
  }

  get learner(): LearnerModel {
    return this.deps.learner;
  }

  getSnapshot = (): LyricViewModel => this.vm;

  getSource = (): LyricSourceState => this.source;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async suspend(): Promise<void> {
    if (this.disposed) return;
    this.hold.cancel();
    this.speaker.stop();
    await this.queue.enqueue(async () => {
      const session = this.session;
      const loaded = this.loaded;
      if (!session || !loaded) return;
      const at = this.deps.clock.now();
      try {
        await this.deps.storage.sessions.save(this.sessionRow(session, loaded, at));
        // A checkpoint of the learner (it keeps the stored prior).
        await this.deps.storage.learner.saveSnapshot(this.deps.learner, at);
      } catch (e) {
        this.report(e);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.hold.dispose();
    this.speaker.stop();
    this.track?.dispose();
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
    const patch: Partial<LyricViewModel> = {};
    if (this.vm.showExplicit !== settings.showExplicit) patch.showExplicit = settings.showExplicit;
    if ((this.vm.regions ?? []).join() !== settings.regions.join()) patch.regions = settings.regions;
    if (Object.keys(patch).length > 0) this.set(patch);
    void this.queue.enqueue(async () => {
      const session = this.session;
      if (!session) return;
      const want = sessionSettingsFor(settings);
      if (sameSessionSettings(session.settings, want)) return;
      const at = this.deps.clock.now();
      await this.apply(session.setSettings(want, at), { at, credited: 0, cue: 'none' });
      await this.scoreSurprise();
    });
  }

  reload(): void {
    if (this.disposed) return;
    this.speaker.stop();
    void this.queue.enqueue(async () => {
      this.track?.dispose();
      this.track = null;
      this.session = null;
      this.loaded = null;
      this.plays.clear();
      this.set({ screen: null, surprise: null, playback: NO_PLAYBACK, meaning: null });
      this.surpriseRegister = null;
      await this.open();
    }, true);
  }

  timingLines(): TimingLine[] {
    const session = this.session;
    if (!session) return [];
    const state = session.snapshot().state;
    const screen = this.vm.screen;
    const lines = screen?.kind === 'read' ? screen.lines : null;
    const src = state.source;
    if (src.kind !== 'lyrics') return (lines ?? []).map((l) => ({ index: l.index, text: l.text, startMs: null }));
    return src.lyrics.lines.map((l) => ({
      index: l.index,
      text: l.text,
      startMs: state.taps[l.id] ?? l.startMs ?? null,
    }));
  }

  positionMs(): number {
    return this.track?.positionMs() ?? 0;
  }

  playFrom(ms: number): void {
    const track = this.track;
    if (!track?.available || this.disposed) return;
    this.speaker.stop();
    void this.queue.enqueue(async () => {
      void track.segment(Math.max(0, ms), null, true);
    });
  }

  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ---------------------------------------------------------------------------
  // The view model and the queue
  // ---------------------------------------------------------------------------

  private set(patch: Partial<LyricViewModel>): void {
    if (this.disposed) return;
    this.vm = { ...this.vm, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private setSource(source: LyricSourceState): void {
    if (this.disposed) return;
    this.source = source;
    for (const listener of [...this.listeners]) listener();
  }

  private report(error: unknown): void {
    if (this.deps.onError) this.deps.onError(error);
    else console.warn('[lyric] controller error', error);
  }

  /**
   * One call into the session, if `guard` passes now and again when its turn comes. `quiet`
   * stops speech first (the learner moved on).
   */
  private step(
    guard: Guard,
    call: (session: LyricSession, at: number) => Promise<LyricStep> | LyricStep,
    opts: { busy?: boolean; quiet?: boolean; credited?: number; at?: number; cue?: CueMode } = {},
  ): Promise<void> {
    if (this.disposed || !this.session || !guard(this.vm.screen)) return Promise.resolve();
    if (opts.quiet) this.speaker.stop();
    return this.queue
      .enqueue(async () => {
        const session = this.session;
        if (!session || !guard(this.vm.screen)) return;
        const at = opts.at ?? this.deps.clock.now();
        let step: LyricStep;
        try {
          step = await call(session, at);
        } catch (e) {
          // Nothing of a failed step is written; show the screen the session is on now.
          this.report(e);
          this.set({ screen: session.screen, notice: { key: tKey('music.notice.stepFailed') } });
          return;
        }
        await this.apply(step, { at, credited: opts.credited ?? 0, cue: opts.cue ?? 'tts' });
      }, opts.busy ?? false)
      .then(() => undefined);
  }

  private modelMode(): LyricViewModel['modelMode'] {
    return this.deps.model.status === 'ready' ? 'model' : 'canned';
  }

  private liveModel(): LanguageModel | null {
    return this.deps.model.status === 'ready' ? this.deps.model : null;
  }

  private sessionDeps() {
    return { model: this.liveModel(), pack: this.deps.packs.lang, pair: this.deps.packs.pair, learner: this.deps.learner };
  }

  private sessionRow(session: LyricSession, loaded: LoadedSource, at: number) {
    return {
      id: loaded.sessionId,
      kind: 'lyric' as const,
      version: LYRIC_SESSION_FORMAT,
      snapshot: session.snapshot(),
      // Every song resumes its own session: none is "the" active lyric session.
      active: false,
      updatedAt: at,
    };
  }

  // ---------------------------------------------------------------------------
  // Opening and applying steps
  // ---------------------------------------------------------------------------

  private start(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.starting ??= this.queue.enqueue(() => this.open(), true).then(() => undefined);
    return this.starting;
  }

  private async open(): Promise<void> {
    if (this.session || this.disposed) return;
    const { storage, clock, packs, target } = this.deps;
    await this.refreshSpokenToday(clock.now());
    const load = await loadLyricSource(storage, packs.lang, target);
    if (this.disposed) return;
    if (!('loaded' in load)) {
      this.setSource(load.state);
      return;
    }
    const loaded = load.loaded;
    const options = { applyEvents: false, ...(this.deps.sessionOptions ? { options: this.deps.sessionOptions } : {}) };
    let session: LyricSession | null = null;
    const record = await storage.sessions.get<LyricSessionSnapshot>(loaded.sessionId);
    if (record && record.version === LYRIC_SESSION_FORMAT && sameSource(record.snapshot, loaded.source)) {
      try {
        session = LyricSession.restore(record.snapshot, this.sessionDeps(), options);
      } catch (e) {
        // A snapshot this build cannot read: start the song afresh (the row is overwritten).
        this.report(e);
      }
    }
    const at = clock.now();
    const created = session === null;
    session ??= LyricSession.create({
      ...this.sessionDeps(),
      now: at,
      seed: this.deps.seed?.() ?? at >>> 0,
      source: loaded.source,
      song: { title: loaded.title, artist: loaded.artist },
      settings: sessionSettingsFor(this.settings),
      ...options,
    });
    this.session = session;
    this.loaded = loaded;
    try {
      if (target.kind === 'song') await storage.songs.markOpened(target.songId, at);
      else await storage.texts.markOpened(target.textId, at);
    } catch (e) {
      this.report(e);
    }
    if (loaded.trackId) {
      const track = new Track({
        music: this.deps.music,
        trackId: loaded.trackId,
        onChange: () => this.refreshPlayback(),
        onError: (e) => this.report(e),
        ...(this.deps.ticker !== undefined ? { ticker: this.deps.ticker } : {}),
      });
      await track.init();
      if (this.disposed) {
        track.dispose();
        return;
      }
      this.track = track;
    }
    this.setSource(load.state);
    if ((this.vm.genre ?? null) !== loaded.genre) this.set({ genre: loaded.genre });
    this.refreshPlayback();
    const want = sessionSettingsFor(this.settings);
    if (!sameSessionSettings(session.settings, want)) {
      // Settings changed while the song was away (library pills, profile).
      await this.apply(session.setSettings(want, at), { at, credited: 0, cue: 'none' });
    } else if (created) {
      await this.apply({ screen: session.screen, events: [] }, { at, credited: 0, cue: 'none' });
    } else {
      this.publish(session.screen, null);
    }
    await this.scoreSurprise();
  }

  private publish(screen: LyricScreen, meaning: LyricViewModel['meaning']): void {
    if (screen.kind === 'cliff' || screen.kind === 'line') this.plays.set(screen.lineIndex, screen.play);
    this.set({ screen, meaning, register: screen.meta.register });
  }

  /** Publish a step: persist it, then the screen, the meaning, the sound. */
  private async apply(step: LyricStep, ctx: { at: number; credited: number; cue: CueMode }): Promise<void> {
    const session = this.session;
    const loaded = this.loaded;
    // A controller disposed while a step ran (unmounted) writes nothing more.
    if (!session || !loaded || this.disposed) return;
    let spokenTodayMs = this.vm.spokenTodayMs;
    try {
      await persistStep(this.deps.storage, this.storageClock, {
        learner: this.deps.learner,
        events: step.events,
        session: this.sessionRow(session, loaded, ctx.at),
        creditedMs: ctx.credited,
        at: ctx.at,
      });
      if (ctx.credited > 0) spokenTodayMs = await this.readSpokenToday(this.deps.clock.now());
    } catch (e) {
      this.report(e);
      if (ctx.credited > 0) spokenTodayMs += ctx.credited;
      this.set({ notice: { key: tKey('music.notice.notSaved') } });
    }
    const screen = step.screen;
    const before = this.vm.screen;
    const meaning = step.meaning ?? (before?.kind === screen.kind ? this.vm.meaning : null);
    this.publish(screen, meaning);
    if (spokenTodayMs !== this.vm.spokenTodayMs) this.set({ spokenTodayMs });
    // A spoken command acts like its chip.
    let cue = ctx.cue;
    if (step.command === 'next') cue = 'move';
    else if (step.command === 'again') cue = 'replay';
    await this.sound(step, cue);
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

  private refreshPlayback(): void {
    const next: PlaybackState = this.track?.view() ?? NO_PLAYBACK;
    const now = this.vm.playback;
    if (next.available !== now.available || next.playing !== now.playing || next.positionMs !== now.positionMs || next.durationMs !== now.durationMs) {
      this.set({ playback: next });
    }
  }

  /** Brought text with the model loaded: the reader's surprise shading, scored once per register. */
  private async scoreSurprise(): Promise<void> {
    const session = this.session;
    const model = this.liveModel();
    if (!session || !model || this.loaded?.source.kind !== 'text') return;
    const settings = session.settings;
    if (this.surpriseRegister === settings.register && this.vm.surprise) return;
    try {
      const units = await surpriseMap(model, this.deps.packs.lang, this.loaded.source.text, settings.register, { regions: settings.regions });
      if (this.disposed || this.session !== session) return;
      this.surpriseRegister = settings.register;
      this.set({ surprise: units });
    } catch (e) {
      this.report(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private startEcho(): void {
    const canEcho: Guard = (s) => s !== null && lineScreens.has(s.kind);
    void this.step(
      canEcho,
      async (session, at) => {
        // Never record while the track plays: it stops before the sing-back starts.
        await this.track?.pauseIfPlaying();
        return session.startEcho(at);
      },
      { quiet: true, cue: 'echo' },
    );
  }

  private setRegister(register: 'neutral' | 'street'): void {
    if (this.disposed || !this.vm.screen) return;
    if (this.settings.register !== register) {
      this.settings = { ...this.settings, register };
      this.deps.updateSettings?.({ register }).catch((e: unknown) => this.report(e));
    }
    void this.step(anyScreen, (session, at) => session.setRegister(register, at), { quiet: true, cue: 'none' }).then(() =>
      this.queue.enqueue(() => this.scoreSurprise()),
    );
  }

  private setShowExplicit(show: boolean): void {
    if (this.disposed) return;
    if (this.settings.showExplicit !== show) {
      this.settings = { ...this.settings, showExplicit: show };
      this.deps.updateSettings?.({ showExplicit: show }).catch((e: unknown) => this.report(e));
    }
    if (this.vm.showExplicit !== show) this.set({ showExplicit: show });
    void this.step(anyScreen, (session, at) => session.setSettings({ showExplicit: show }, at), { cue: 'none' });
  }

  /** An echo tile: hear that word of the line slowly (tap_rehear on its word). */
  private hearWord(index: number): void {
    const screen = this.vm.screen;
    if (this.disposed || screen?.kind !== 'echo' || !screen.tiles) return;
    const tile = screen.tiles[index];
    if (!tile) return;
    const pack = this.deps.packs.lang;
    const seg = pack.segment(tile.text).find((s) => s.kind === 'word');
    void this.queue.enqueue(async () => {
      if (seg) {
        const norm = seg.norm || pack.normalize(seg.text);
        const lemma = pack.analyze(norm)[0]?.lemma ?? norm;
        const at = this.deps.clock.now();
        const event: LearnerEvent = { type: 'tap_rehear', key: lexemeKey(pack.code, lemma), at };
        try {
          await this.deps.storage.learner.record(this.deps.learner, [event]);
        } catch (e) {
          this.report(e);
        }
      }
      await this.track?.pauseIfPlaying();
      void this.speaker.say(tile.text, { rate: SLOW_WORD_RATE }).then((o) => this.afterSaid(null, o));
    });
  }

  private play(): void {
    const track = this.track;
    if (this.disposed || !track?.available) return;
    this.speaker.stop();
    void this.queue.enqueue(async () => {
      const screen = this.vm.screen;
      if ((screen?.kind === 'cliff' || screen?.kind === 'line') && this.timed(screen)) {
        void this.playLine(screen, screen.kind === 'cliff' ? (lyricCueForScreen(screen) ?? null) : null, false);
        return;
      }
      await track.resume();
    });
  }

  private command(cmd: SpokenCommand, argument?: string): void {
    if (this.disposed || !this.vm.screen) return;
    this.hold.cancel();
    const cue: CueMode = cmd === 'again' ? 'replay' : cmd === 'next' ? 'move' : 'tts';
    void this.step(anyScreen, (session, at) => session.command(cmd, at, argument), { busy: true, quiet: true, cue });
  }

  private typeAnswer(text: string): void {
    const trimmed = text.trim();
    if (this.disposed || !trimmed || !this.vm.screen) return;
    this.hold.cancel();
    void this.submit(typedTranscript(trimmed));
  }

  /** A final transcript (spoken or typed) to the session; typed answers earn no speaking time. */
  private submit(t: FinalTranscript): Promise<void> {
    const u = utteranceOf(t);
    const at = this.deps.clock.now();
    this.speaker.stop();
    return this.step(anyScreen, (session) => session.handleUtterance(u.text, at, u.info), { busy: true, at, credited: u.credited, cue: 'tts' });
  }

  // ---------------------------------------------------------------------------
  // Sound: the track and the voice
  // ---------------------------------------------------------------------------

  /** The line has times and the track can play: the song itself carries the line. */
  private timed(screen: Extract<LyricScreen, { kind: 'cliff' | 'line' }>): boolean {
    return this.track?.available === true && screen.play.mode !== 'manual' && screen.play.startMs !== null;
  }

  private async sound(step: LyricStep, cue: CueMode): Promise<void> {
    if (cue === 'none' || this.disposed) return;
    const screen = step.screen;
    if ((cue === 'move' || cue === 'replay') && (screen.kind === 'cliff' || screen.kind === 'line') && this.timed(screen)) {
      void this.playLine(screen, step.speak ?? null, cue === 'replay');
      return;
    }
    if (cue === 'echo' && screen.kind === 'echo') {
      const play = this.plays.get(screen.lineIndex);
      if (play && this.track?.available && play.mode !== 'manual' && play.startMs !== null && play.endMs !== null) {
        void this.track.segment(play.startMs, play.endMs, true);
        return;
      }
    }
    if (step.speak) await this.say(step.speak);
  }

  /**
   * The track runs up to the cliff (or plays the line) and pauses. When it paused at the line
   * start (no word marks), the voice reads the line up to the gap.
   */
  private async playLine(screen: Extract<LyricScreen, { kind: 'cliff' | 'line' }>, speak: SpeakCue | null, replay: boolean): Promise<void> {
    const track = this.track;
    if (!track) return;
    const play = screen.play;
    const target = screen.kind === 'cliff' ? play.pauseAtMs : play.endMs;
    const from = screen.kind === 'cliff' && play.precise ? (play.startMs ?? 0) : this.runUpStart(screen.lineIndex, play);
    const outcome = await track.segment(from, target, replay);
    if (outcome !== 'paused' || this.disposed || this.vm.screen !== screen) return;
    if (screen.kind !== 'cliff') return;
    if (!play.precise && speak) await this.say(speak);
    else if (screen.rung === 'options' && screen.options?.length) void this.readOptions(screen);
  }

  /** Where the run-up to a line starts: the previous line's start when it has a time, else RUN_UP_MS before. */
  private runUpStart(lineIndex: number, play: LinePlay): number {
    const start = play.startMs ?? 0;
    if (play.mode === 'manual') return start;
    let previous: number | undefined;
    for (let i = lineIndex - 1; i >= 0 && previous === undefined; i--) previous = this.plays.get(i)?.startMs ?? undefined;
    if (previous === undefined) previous = this.timingLines().find((l) => l.index === lineIndex - 1)?.startMs ?? undefined;
    return previous !== undefined && previous < start ? previous : Math.max(0, start - RUN_UP_MS);
  }

  /** Say a cue through the voice (not awaited to the end); the track pauses first. */
  private async say(cue: SpeakCue): Promise<void> {
    if (this.disposed) return;
    this.lastCue = cue;
    if (this.hold.holding) {
      // The learner is about to speak or speaking: do not talk over them; a no-sé answer still moves on.
      this.afterSaid(cue, 'completed');
      return;
    }
    await this.track?.pauseIfPlaying();
    void this.speaker.say(cue.text, { rate: cue.rate }).then((outcome) => this.afterSaid(cue, outcome));
  }

  private afterSaid(cue: SpeakCue | null, outcome: SayOutcome): void {
    if (this.disposed) return;
    if (outcome === 'failed' && !this.speechOutNoticed) {
      this.speechOutNoticed = true;
      this.set({ notice: { key: tKey('music.notice.speechOut') } });
    }
    if (outcome === 'stopped' || !cue) return;
    const screen = this.vm.screen;
    if (cue.what === 'answer' && screen?.kind === 'noSe' && screen.step === 'play_answer') {
      // The learner can read the answer when the voice failed: the no-sé flow still moves on.
      void this.step((s) => s?.kind === 'noSe' && s.step === 'play_answer', (session, at) => session.played(at), { cue: 'none' });
      return;
    }
    if (outcome === 'completed' && cue.what === 'line' && screen?.kind === 'cliff' && screen.rung === 'options' && screen.options?.length) {
      void this.readOptions(screen);
    }
  }

  /** The options rung: each option read in turn after the line. */
  private async readOptions(screen: Extract<LyricScreen, { kind: 'cliff' }>): Promise<void> {
    const rate = this.lastCue?.rate ?? 1;
    for (const option of screen.options ?? []) {
      if (this.disposed || this.vm.screen !== screen || this.hold.holding) return;
      const outcome = await this.speaker.say(option.text, { rate });
      if (outcome !== 'completed') return;
    }
  }
}
