/**
 * LyricSession: the Music tab (and any text the learner brings) as a pure, deterministic
 * state machine: the song page with slang notes, line play info, lyric cliffs, sing-back
 * echo and the register toggle (neutral and street side by side).
 *
 * Lyric cliffs come from lyricCliffs / broughtTextCliffs and answers from
 * scoreLyricAnswer, which take slang answers from the lyrics and the register pack, not
 * from next-word lists (proof test: top-10 mass 0.12 after slang). Without a model
 * (canned mode) a cliff is the line's first slang span or its last word, and answers are
 * matched against the lyric and its neutral paraphrase by string and form.
 *
 * Playback: with LRC timestamps a line has a start and the track pauses before the
 * cliff (at the first hidden word's mark with enhanced LRC, else at the line start);
 * with lines the learner tapped while listening, those times; otherwise the learner
 * advances line by line (manual). Playback never resumes by itself: the app resumes on a
 * user action (next, again).
 *
 * One step at a time (as StorySession): while an async step (next, openLine,
 * handleUtterance, command, pickOption) waits for the model, every other step call,
 * synchronous ones included (startEcho, played, setRegister, setSettings, markLine,
 * showSong), is refused with refused: 'busy', the screen from before the running step
 * and no events, and changes nothing. snapshot(), screen and settings read the state
 * from before the running step; setModel() is deferred until it ends; a step that throws
 * leaves the session as it was.
 */
import type { Segment, SpokenCommand } from '../lang/types';
import type { CliffRung, LearnerEvent } from '../learner/types';
import { lexemeKey } from '../learner/types';
import type { LearnerModel } from '../learner/model';
import { cliffRungFor, deriveParams, estimateVocabulary } from '../learner/difficulty';
import { alternativesReusable } from '../scoring/cliff';
import type { CliffResult, NextWord } from '../scoring/types';
import { chooseAnalysesInText } from '../lang/choose';
import { sentenceStartFlags, wholeAtLeast } from '../story/text';
import { matchCommand, type CommandOptions } from '../speaking/commands';
import { alignTranscript } from '../speaking/align';
import { nativeReply } from '../speaking/native';
import { advanceNoSe, startNoSe, type NoSeOptions, type NoSeState } from '../speaking/noSe';
import { creditedMs } from '../speaking/spokenTime';
import { broughtTextCliffs, lyricCliffs, scoreLyricAnswer, type LyricCliffOptions, type LyricEquivalence, type TextCliff } from '../lyrics/cliffs';
import { echoLine } from '../lyrics/echo';
import type { LyricLine } from '../lyrics/parse';
import { findSlangMatches, noteFor, registerPairs, slangNotes, songSlangNotes } from '../lyrics/slang';
import { lyricUnits, splitTextUnits, type TextUnit } from '../lyrics/units';
import { DEFAULT_LANDING_OPTIONS, arrangeOptions, buildOutcome, cannedResult, chooseDistractors, cliffUi, optionResult, type LandingOptions, type OptionChoiceOptions } from './cliff';
import {
  alignmentView,
  cleanEvents,
  effectiveRate,
  finitePositive,
  hintFor,
  looseText,
  plain,
  resolveSessionSettings,
  rng,
  sameWords,
  seedFor,
} from './common';
import {
  LYRIC_SESSION_FORMAT,
  type AlignmentView,
  type CliffOutcome,
  type LinePlay,
  type LyricLineView,
  type LyricMeta,
  type LyricScreen,
  type LyricSource,
  type LyricStep,
  type MeaningView,
  type SessionDeps,
  type SessionSettings,
  type SpeakCue,
  type UiText,
  type UtteranceInfo,
} from './types';

/** Tunable numbers of a lyric session. */
export interface LyricSessionOptions {
  /** Leave ad-lib lines (whole line in parentheses) out of cliffs. */
  skipAdlibs: boolean;
  /** Parts of speech of option distractors taken from the song's other lines (words the pack does not know, such as slang, always qualify). */
  distractorPos: readonly string[];
  /** "Más despacio" multiplies the reading rate (manual mode) by this; floor minRate. */
  slowerFactor: number;
  minRate: number;
  /** Options passed to lyricCliffs / broughtTextCliffs (register, learner, lines are set here). */
  cliff: Partial<Omit<LyricCliffOptions, 'register' | 'lines'>>;
  options: Partial<OptionChoiceOptions>;
  landing: Partial<LandingOptions>;
  noSe: Partial<NoSeOptions>;
  command: Partial<CommandOptions>;
}

/**
 * Defaults: ad-libs skipped (backing vocals are not the line the learner sings);
 * distractors are content words of the song (the learner has heard them, and a
 * determiner or preposition is either obviously wrong or accidentally right); the
 * story's slow-down (0.8, floor 0.5) for reading a line aloud in manual mode.
 */
export const DEFAULT_LYRIC_SESSION_OPTIONS: Readonly<LyricSessionOptions> = {
  skipAdlibs: true,
  distractorPos: ['NOUN', 'VERB', 'ADJ', 'ADV'],
  slowerFactor: 0.8,
  minRate: 0.5,
  cliff: {},
  options: {},
  landing: {},
  noSe: {},
  command: {},
};

type Phase = 'read' | 'line' | 'cliff' | 'result' | 'noSe' | 'native' | 'echo' | 'registers' | 'done';

interface LyricCliffState {
  unit: number;
  /** First hidden word among the unit's word and number segments, and the count. */
  wordIndex: number;
  length: number;
  start: number;
  end: number;
  answer: string;
  accepted: string[];
  key: string;
  context: string;
  before: string;
  slang: boolean;
  rung: CliffRung;
  options: { text: string; natural: boolean; prob: number | null }[] | null;
  hint: string | null;
  prob: number | null;
  alternatives: NextWord[];
  /** The model rated this cliff (alternatives and prob come from lyricCliffs); absent in older snapshots. */
  rated?: boolean;
  resolved: boolean;
  outcome: CliffOutcome | null;
}

/** Everything a lyric session holds, as plain data. */
export interface LyricState {
  seed: number;
  steps: number;
  settings: SessionSettings;
  source: LyricSource;
  song: { title: string; artist: string };
  phase: Phase;
  unit: number;
  /** Line start times the learner tapped while listening (ms), by unit id. */
  taps: Record<string, number>;
  cliff: LyricCliffState | null;
  noSe: NoSeState | null;
  native: { heard: string; target: string | null; keys: string[]; landed: boolean; repeat: AlignmentView | null } | null;
  answered: number;
  full: number;
  slow: number;
  spokenMs: number;
  screen: LyricScreen;
}

export interface LyricSessionSnapshot {
  format: typeof LYRIC_SESSION_FORMAT;
  kind: 'lyric';
  state: LyricState;
}

export interface LyricSessionCreate extends SessionDeps {
  now: number;
  seed: number;
  source: LyricSource;
  song?: { title?: string; artist?: string };
  settings?: Partial<SessionSettings>;
  applyEvents?: boolean;
  options?: Partial<LyricSessionOptions>;
}

export class LyricSession {
  private deps: SessionDeps;
  private readonly state: LyricState;
  private readonly o: LyricSessionOptions;
  private readonly applyEvents: boolean;
  private busy = false;
  /** The state as it was when the running step began (reads while busy, and the rollback of a failed step). */
  private stable: LyricState | null = null;
  /** A model set while a step ran, applied when it ends. */
  private pendingModel: { model: SessionDeps['model'] } | null = null;

  private constructor(deps: SessionDeps, state: LyricState, opts: { applyEvents?: boolean; options?: Partial<LyricSessionOptions> }) {
    this.deps = { ...deps };
    this.state = state;
    this.o = { ...DEFAULT_LYRIC_SESSION_OPTIONS, ...opts.options };
    this.applyEvents = opts.applyEvents !== false;
  }

  /** A session over parsed lyrics or a brought text. Opens on the song page (read). */
  static create(c: LyricSessionCreate): LyricSession {
    const tags = c.source.kind === 'lyrics' ? c.source.lyrics.tags : {};
    const state: LyricState = {
      seed: c.seed >>> 0,
      steps: 0,
      settings: resolveSessionSettings(c.settings),
      source: plain(c.source),
      song: { title: c.song?.title ?? tags.ti ?? '', artist: c.song?.artist ?? tags.ar ?? '' },
      phase: 'read',
      unit: -1,
      taps: {},
      cliff: null,
      noSe: null,
      native: null,
      answered: 0,
      full: 0,
      slow: 1,
      spokenMs: 0,
      screen: { kind: 'done', meta: { title: '', artist: '', total: 0, spokenMs: 0, register: 'neutral', canned: true, source: 'lyrics' }, answered: 0, full: 0 },
    };
    const s = new LyricSession(c, state, { applyEvents: c.applyEvents, options: c.options });
    state.screen = s.readScreen();
    return s;
  }

  static restore(snapshot: LyricSessionSnapshot, deps: SessionDeps, opts: { applyEvents?: boolean; options?: Partial<LyricSessionOptions> } = {}): LyricSession {
    if (!snapshot || snapshot.format !== LYRIC_SESSION_FORMAT || snapshot.kind !== 'lyric' || !snapshot.state) {
      throw new Error('LyricSession.restore: unsupported snapshot');
    }
    return new LyricSession(deps, plain(snapshot.state), opts);
  }

  /** JSON-serializable snapshot (not the learner). While a step runs it is the session as it was before that step. */
  snapshot(): LyricSessionSnapshot {
    return { format: LYRIC_SESSION_FORMAT, kind: 'lyric', state: plain(this.readState()) };
  }

  /** The current screen (while a step runs: the screen before it). */
  get screen(): LyricScreen {
    return plain(this.readState().screen);
  }

  get learner(): LearnerModel {
    return this.deps.learner;
  }

  get settings(): SessionSettings {
    return plain(this.readState().settings);
  }

  /** True while a step runs; other step calls are then refused. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** Switch between canned mode (null) and a model; called while a step runs, it takes effect when that step ends. */
  setModel(model: SessionDeps['model']): void {
    if (this.busy) {
      this.pendingModel = { model };
      return;
    }
    this.deps = { ...this.deps, model };
  }

  // -------------------------------------------------------------------------
  // Step functions
  // -------------------------------------------------------------------------

  /** The next line (its cliff when it has one), or the end of the song. */
  async next(at: number): Promise<LyricStep> {
    return this.run(async () => this.advance(at));
  }

  /** Jump to line `index` (a tap on the song page). */
  async openLine(index: number, at: number): Promise<LyricStep> {
    return this.run(async () => this.prepareUnit(index, at, []));
  }

  async handleUtterance(transcript: string, at: number, info: UtteranceInfo = {}): Promise<LyricStep> {
    return this.run(async () => {
      this.state.spokenMs += creditedMs(finitePositive(info.durationMs));
      return this.route(transcript, at);
    });
  }

  async command(cmd: SpokenCommand, at: number, argument?: string): Promise<LyricStep> {
    return this.run(async () => this.doCommand(cmd, at, argument));
  }

  async pickOption(index: number, at: number): Promise<LyricStep> {
    return this.run(async () => this.chooseOption(index, at));
  }

  /** Sing the current line back (B4): the track stays stopped and the next utterance is the echo. */
  startEcho(at: number): LyricStep {
    if (this.busy) return this.refused();
    const unit = this.unitAt(this.state.unit);
    if (!unit) return this.step([]);
    this.state.phase = 'echo';
    this.state.screen = this.echoScreen(unit, null);
    return this.step([], { speak: { text: unit.text, rate: this.rate(), what: 'line' } });
  }

  /** The no-sé answer finished playing. */
  played(at: number): LyricStep {
    if (this.busy) return this.refused();
    if (this.state.phase === 'noSe' && this.state.noSe) {
      this.state.noSe = advanceNoSe(this.state.noSe, { type: 'played' }, this.deps.pack, this.noSeOpts());
      this.state.screen = this.noSeScreen();
    }
    return this.step([]);
  }

  /** Neutral or street: the song page and the side-by-side lines in that register. */
  setRegister(register: SessionSettings['register'], at: number): LyricStep {
    if (this.busy) return this.refused();
    this.state.settings = resolveSessionSettings({ register }, this.state.settings);
    this.state.phase = 'registers';
    this.state.screen = this.registersScreen();
    return this.step([]);
  }

  setSettings(change: Partial<SessionSettings>, at: number): LyricStep {
    if (this.busy) return this.refused();
    this.state.settings = resolveSessionSettings(change, this.state.settings);
    if (this.state.phase === 'read') this.state.screen = this.readScreen();
    else if (this.state.phase === 'registers') this.state.screen = this.registersScreen();
    return this.step([]);
  }

  /** The learner tapped line `index` while the track played at `positionMs`: its start time from now on. */
  markLine(index: number, positionMs: number): LyricStep {
    if (this.busy) return this.refused();
    const unit = this.unitAt(index);
    if (unit && Number.isFinite(positionMs) && positionMs >= 0) this.state.taps[unit.id] = positionMs;
    if (this.state.phase === 'read') this.state.screen = this.readScreen();
    return this.step([]);
  }

  /** Back to the song page. */
  showSong(): LyricStep {
    if (this.busy) return this.refused();
    this.state.phase = 'read';
    this.state.screen = this.readScreen();
    return this.step([]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Run one async step: refused while another runs; the state before it serves reads and is restored if the step throws. */
  private async run(fn: () => Promise<LyricStep>): Promise<LyricStep> {
    if (this.busy) return this.refused();
    this.busy = true;
    const before = plain(this.state);
    this.stable = before;
    try {
      return await fn();
    } catch (e) {
      for (const k of Object.keys(this.state)) delete (this.state as unknown as Record<string, unknown>)[k];
      Object.assign(this.state, before);
      throw e;
    } finally {
      this.busy = false;
      this.stable = null;
      const pending = this.pendingModel;
      this.pendingModel = null;
      if (pending) this.deps = { ...this.deps, model: pending.model };
    }
  }

  /** The state reads see: the state before the running step while busy. */
  private readState(): LyricState {
    return this.busy && this.stable ? this.stable : this.state;
  }

  /** A refused call (StepRefusal): nothing changes. */
  private refused(): LyricStep {
    return { screen: plain(this.readState().screen), events: [], refused: 'busy' };
  }

  private step(events: readonly LearnerEvent[], extra: Partial<Omit<LyricStep, 'screen' | 'events'>> = {}): LyricStep {
    const clean = cleanEvents(events);
    if (this.applyEvents && clean.length) this.deps.learner.applyAll(clean);
    return { screen: plain(this.state.screen), events: clean, ...extra };
  }

  private units(): TextUnit[] {
    const src = this.state.source;
    return src.kind === 'lyrics' ? lyricUnits(src.lyrics, this.o.skipAdlibs) : splitTextUnits(this.deps.pack, src.text);
  }

  private unitAt(i: number): TextUnit | undefined {
    return i >= 0 ? this.units()[i] : undefined;
  }

  private lyricLine(i: number): LyricLine | undefined {
    const src = this.state.source;
    return src.kind === 'lyrics' ? src.lyrics.lines[i] : undefined;
  }

  private meta(): LyricMeta {
    return {
      title: this.state.song.title,
      artist: this.state.song.artist,
      total: this.units().length,
      spokenMs: this.state.spokenMs,
      register: this.state.settings.register,
      canned: this.deps.model === null,
      source: this.state.source.kind,
    };
  }

  private rate(): number {
    return effectiveRate(1, this.state.settings.speechRateBias, this.state.slow, this.o.minRate);
  }

  private noSeOpts(): Partial<NoSeOptions> {
    return { register: this.state.settings.register, regions: this.state.settings.regions, ...this.o.noSe };
  }

  private regOpts(): { register: SessionSettings['register']; regions: readonly string[] } {
    return { register: this.state.settings.register, regions: this.state.settings.regions };
  }

  private nextSeed(): number {
    return seedFor(this.state.seed, this.state.steps++);
  }

  private playback(): 'timed' | 'tapped' | 'manual' {
    const src = this.state.source;
    if (src.kind === 'lyrics' && src.lyrics.timed) return 'timed';
    return Object.keys(this.state.taps).length > 0 ? 'tapped' : 'manual';
  }

  private lineView(unit: TextUnit): LyricLineView {
    const matches = findSlangMatches(this.deps.pack, unit.text, { regions: this.state.settings.regions });
    const show = this.state.settings.showExplicit;
    return {
      index: unit.index,
      text: unit.text,
      slang: matches.map((m) => ({ start: m.start, end: m.end, explicit: m.entry.explicit })),
      masked: show ? [] : matches.filter((m) => m.entry.explicit).map((m) => ({ start: m.start, end: m.end })),
      repeat: unit.repeat,
    };
  }

  private readScreen(): LyricScreen {
    const { pack, pair } = this.deps;
    const { regions, showExplicit } = this.state.settings;
    const src = this.state.source;
    const notes =
      src.kind === 'lyrics'
        ? songSlangNotes(src.lyrics, pack, pair, { regions, showExplicit }).map((n) => n.note)
        : slangNotes(src.text, pack, pair, { regions, showExplicit });
    return { kind: 'read', meta: this.meta(), lines: this.units().map((u) => this.lineView(u)), notes, playback: this.playback() };
  }

  private registersScreen(): LyricScreen {
    const street = this.state.settings.register === 'street';
    const pairs: Extract<LyricScreen, { kind: 'registers' }>['pairs'] = [];
    for (const u of this.units()) {
      const p = registerPairs(u.text, this.deps.pack, this.state.settings.regions, { alsoStandard: street });
      if (p.substitutions.length === 0) continue;
      pairs.push({ lineIndex: u.index, street: p.street, neutral: p.neutral, swaps: p.substitutions.map((x) => ({ from: x.neutral, to: x.street })) });
    }
    return { kind: 'registers', meta: this.meta(), pairs };
  }

  /** Where line `i` starts and where the track stops for a cliff starting at character `cliffStart`. */
  private linePlay(i: number, cliffStart: number | null): LinePlay {
    const unit = this.unitAt(i);
    const line = this.lyricLine(i);
    if (line && line.startMs !== undefined) {
      const next = this.lyricLine(i + 1);
      const endMs = line.endMs ?? next?.startMs ?? null;
      const mark = cliffStart === null ? undefined : (line.wordMarks ?? []).find((m) => m.at === cliffStart);
      return { mode: 'timed', startMs: line.startMs, endMs, pauseAtMs: mark ? mark.ms : line.startMs, precise: mark !== undefined };
    }
    const tap = unit ? this.state.taps[unit.id] : undefined;
    if (tap !== undefined) {
      const nextUnit = this.unitAt(i + 1);
      const nextTap = nextUnit ? this.state.taps[nextUnit.id] : undefined;
      return { mode: 'tapped', startMs: tap, endMs: nextTap ?? null, pauseAtMs: tap, precise: false };
    }
    return { mode: 'manual', startMs: null, endMs: null, pauseAtMs: null, precise: false };
  }

  private async advance(at: number): Promise<LyricStep> {
    const s = this.state;
    const events: LearnerEvent[] = [];
    if (s.phase === 'done') return this.step([]);
    if (s.phase === 'cliff' && s.cliff && !s.cliff.resolved) {
      events.push({ type: 'cliff_skip', key: s.cliff.key, at });
      s.cliff.resolved = true;
    }
    const from = s.phase === 'read' && s.unit < 0 ? 0 : s.unit + 1;
    return this.prepareUnit(from, at, events);
  }

  /** Line `from` or the next one that is not skipped; done past the end. */
  private async prepareUnit(from: number, at: number, events: LearnerEvent[]): Promise<LyricStep> {
    const s = this.state;
    const units = this.units();
    let i = Math.max(0, Math.floor(from));
    while (i < units.length && (units[i] as TextUnit).skip) i++;
    s.noSe = null;
    s.native = null;
    s.slow = 1;
    const unit = units[i];
    if (!unit) {
      s.phase = 'done';
      s.unit = units.length;
      s.cliff = null;
      s.screen = { kind: 'done', meta: this.meta(), answered: s.answered, full: s.full };
      return this.step(events);
    }
    s.unit = i;
    const cliff = await this.chooseCliff(unit, at);
    s.cliff = cliff;
    if (!cliff) {
      s.phase = 'line';
      s.screen = { kind: 'line', meta: this.meta(), lineIndex: i, line: this.lineView(unit), play: this.linePlay(i, null) };
      return this.step(events, { speak: { text: unit.text, rate: this.rate(), what: 'line' } });
    }
    s.phase = 'cliff';
    s.screen = this.cliffScreen(unit, cliff);
    return this.step(events, { speak: { text: unit.text.slice(0, cliff.start).trimEnd(), rate: this.rate(), what: 'line' } });
  }

  private cliffScreen(unit: TextUnit, c: LyricCliffState): LyricScreen {
    const prev = this.units()
      .slice(0, unit.index)
      .reverse()
      .find((u) => !u.skip);
    const screen: LyricScreen = {
      kind: 'cliff',
      meta: this.meta(),
      lineIndex: unit.index,
      previous: prev?.text ?? '',
      before: unit.text.slice(0, c.start),
      gapLength: c.length,
      rung: c.rung,
      ui: cliffUi(c.rung, c.hint ?? undefined),
      play: this.linePlay(unit.index, c.start),
      slang: c.slang,
    };
    if (c.rung === 'options' && c.options) screen.options = c.options.map((x, index) => ({ index, text: x.text }));
    if (c.rung === 'hint' && c.hint) screen.hint = c.hint;
    return screen;
  }

  /** Content segments of a unit with the index the cliff modules use for word segments. */
  private contentOf(text: string): Segment[] {
    return this.deps.pack.segment(text).filter((x) => x.kind === 'word' || x.kind === 'number');
  }

  /** The cliff of a line: from the model's ranking, or (canned) its first slang span or last word. */
  private async chooseCliff(unit: TextUnit, at: number): Promise<LyricCliffState | null> {
    const { pack, learner, model } = this.deps;
    const { register, regions, showExplicit } = this.state.settings;
    const freq = (pack.frequencyList ?? []).map((l) => lexemeKey(pack.code, l));
    const params = deriveParams({ vocab: estimateVocabulary(learner, at, freq) });
    const cliffWords = wholeAtLeast(params.cliffWords);
    let c: LyricCliffState | null = null;
    if (model) {
      const src = this.state.source;
      const common = { ...this.o.cliff, register, regions: [...regions], learner, now: at, cliffWords, showExplicit };
      const res =
        src.kind === 'lyrics'
          ? await lyricCliffs(model, pack, src.lyrics, { ...common, lines: [unit.index], skipAdlibs: this.o.skipAdlibs })
          : await broughtTextCliffs(model, pack, src.text, { ...common, sentences: [unit.index] });
      const best: TextCliff | undefined = res[0]?.cliffs[0];
      if (best) {
        const content = this.contentOf(unit.text);
        const first = content.findIndex((x) => x.start === best.start);
        c = {
          unit: unit.index,
          wordIndex: first < 0 ? best.wordIndex : first,
          length: best.wordCount,
          start: best.start,
          end: best.end,
          answer: best.answer,
          accepted: [...best.accepted],
          key: best.key,
          context: best.context,
          before: best.before,
          slang: best.slang.length > 0,
          rung: 'free',
          options: null,
          hint: null,
          prob: best.wordCount === 1 && Number.isFinite(best.prob) ? best.prob : null,
          alternatives: best.position.alternatives,
          rated: true,
          resolved: false,
          outcome: null,
        };
      }
    }
    if (!c) c = this.cannedCliff(unit);
    if (!c) return null;
    c.rung = cliffRungFor(learner, c.key, at);
    const firstWord = this.contentOf(unit.text)[c.wordIndex]?.text ?? c.answer;
    c.hint = hintFor(firstWord);
    if (c.rung === 'options') {
      const pool = this.distractorPool(unit);
      const distractors = await chooseDistractors(c.slang ? null : model, pack, {
        context: c.context,
        actual: firstWord,
        alternatives: c.alternatives,
        pool,
        random: rng(this.nextSeed()),
        options: this.o.options,
      });
      if (distractors.length === 0) c.rung = 'hint';
      else {
        const rest = unit.text.slice(c.start + firstWord.length, c.end);
        const ds = distractors.map((d) => ({ text: d.text + rest, prob: d.prob }));
        const { options, naturalIndex } = arrangeOptions(c.answer, ds.map((d) => d.text), rng(this.nextSeed()));
        c.options = options.map((opt, i) => ({ text: opt.text, natural: i === naturalIndex, prob: i === naturalIndex ? c?.prob ?? null : ds.find((d) => d.text === opt.text)?.prob ?? null }));
      }
    }
    return c;
  }

  /** Words of the other lines (song order), for options the learner has heard. */
  private distractorPool(unit: TextUnit): string[] {
    const out: string[] = [];
    const seen = new Set(this.contentOf(unit.text).map((x) => looseText(this.deps.pack, x.text)));
    for (const u of this.units()) {
      if (u.index === unit.index || u.skip) continue;
      for (const x of this.contentOf(u.text)) {
        if (x.kind !== 'word') continue;
        // Function words make poor options (they fit anywhere or nowhere); slang and words the pack does not know stay.
        const pos = this.deps.pack.analyze(x.norm || this.deps.pack.normalize(x.text))[0]?.pos;
        if (pos !== undefined && !this.o.distractorPos.includes(pos)) continue;
        const k = looseText(this.deps.pack, x.text);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(x.text.toLowerCase() === x.text ? x.text : this.deps.pack.normalize(x.text));
      }
    }
    return shuffledStable(out, rng(this.nextSeed()));
  }

  /**
   * A cliff without a model: the first slang span of the line (street register), else
   * the line's last word; never the first word, a name (a capitalized word the pack does
   * not know away from the line start), a number, or explicit slang that is hidden.
   */
  private cannedCliff(unit: TextUnit): LyricCliffState | null {
    const pack = this.deps.pack;
    const { register, regions, showExplicit } = this.state.settings;
    const segs = pack.segment(unit.text);
    const content = segs.filter((x) => x.kind === 'word' || x.kind === 'number');
    if (content.length < 2) return null;
    const matches = findSlangMatches(pack, unit.text, { regions }).filter((m) => showExplicit || !m.entry.explicit);
    const chosen = new Map(chooseAnalysesInText(pack, segs, sentenceStartFlags(segs, pack.abbreviations ?? [])).map((c) => [c.segIndex, c]));
    const segIndex = (x: Segment) => segs.indexOf(x);
    let span: { first: number; length: number; key: string; slang: boolean } | null = null;
    if (register === 'street') {
      for (const m of matches) {
        const first = content.findIndex((x) => x.start === m.start);
        if (first > 0) {
          const length = content.filter((x) => x.start >= m.start && x.end <= m.end).length;
          span = { first, length, key: lexemeKey(pack.code, m.entry.lemma), slang: true };
          break;
        }
      }
    }
    if (!span) {
      for (let i = content.length - 1; i >= 1; i--) {
        const x = content[i] as Segment;
        if (x.kind !== 'word') continue;
        const c = chosen.get(segIndex(x));
        if (!c || (!c.chosen && c.capitalizedMidSentence) || c.chosen?.pos === 'PROPN' || c.chosen?.pos === 'NUM') continue;
        const m = matches.find((mm) => mm.start <= x.start && x.end <= mm.end);
        if (!showExplicit && findSlangMatches(pack, x.text, { regions }).some((mm) => mm.entry.explicit)) continue;
        span = { first: i, length: 1, key: m ? lexemeKey(pack.code, m.entry.lemma) : lexemeKey(pack.code, c.chosen?.lemma ?? c.norm), slang: m !== undefined };
        break;
      }
    }
    if (!span) return null;
    const first = content[span.first] as Segment;
    const last = content[span.first + span.length - 1] as Segment;
    const answer = unit.text.slice(first.start, last.end);
    const neutral = registerPairs(answer, pack, regions, { alsoStandard: register === 'street' }).neutral;
    const accepted = [answer];
    if (!sameWords(pack, neutral, answer)) accepted.push(neutral);
    return {
      unit: unit.index,
      wordIndex: span.first,
      length: span.length,
      start: first.start,
      end: last.end,
      answer,
      accepted,
      key: span.key,
      context: unit.text.slice(0, first.start),
      before: unit.text.slice(0, first.start),
      slang: span.slang,
      rung: 'free',
      options: null,
      hint: null,
      prob: null,
      alternatives: [],
      resolved: false,
      outcome: null,
    };
  }

  // -------------------------------------------------------------------------
  // Utterances and commands
  // -------------------------------------------------------------------------

  private async route(transcript: string, at: number): Promise<LyricStep> {
    const s = this.state;
    const pack = this.deps.pack;
    if (looseText(pack, transcript) === '') return this.step([]);
    const unit = this.unitAt(s.unit);
    const expected = s.phase === 'cliff' || s.phase === 'noSe' ? s.cliff?.answer : s.phase === 'native' ? s.native?.target ?? undefined : s.phase === 'echo' ? unit?.text : undefined;
    const cmd = matchCommand(transcript, pack, { ...this.o.command, ...(expected ? { answer: expected } : {}) });
    if (cmd) return this.doCommand(cmd.command, at, cmd.argument);
    switch (s.phase) {
      case 'cliff':
        return this.answer(transcript, at);
      case 'noSe': {
        const st = s.noSe as NoSeState;
        const before = st.events.length;
        s.noSe = advanceNoSe(st, { type: 'repeat', transcript, at }, pack, this.noSeOpts());
        s.screen = this.noSeScreen();
        return this.step(s.noSe.events.slice(before));
      }
      case 'native':
        return this.nativeRepeat(transcript, at);
      case 'echo':
        return unit ? this.echo(unit, transcript, at) : this.step([]);
      default:
        return this.step([]);
    }
  }

  private async doCommand(cmd: SpokenCommand, at: number, argument?: string): Promise<LyricStep> {
    const s = this.state;
    const tag = { command: cmd };
    const unit = this.unitAt(s.unit);
    switch (cmd) {
      case 'again':
      case 'slower': {
        if (cmd === 'slower') s.slow *= this.o.slowerFactor;
        let speak: SpeakCue | undefined;
        if (s.phase === 'cliff' && s.cliff && unit) speak = { text: unit.text.slice(0, s.cliff.start).trimEnd(), rate: this.rate(), what: 'line' };
        else if (s.phase === 'noSe' && s.noSe) {
          s.noSe = advanceNoSe(s.noSe, { type: 'replay', slower: cmd === 'slower' }, this.deps.pack, this.noSeOpts());
          s.screen = this.noSeScreen();
          speak = { text: s.noSe.answer, rate: this.rate(), what: 'answer' };
        } else if (s.phase === 'native' && s.native?.target) speak = { text: s.native.target, rate: this.rate(), what: 'answer' };
        else if (unit) speak = { text: unit.text, rate: this.rate(), what: 'line' };
        return { ...this.step([], speak ? { speak } : {}), ...tag };
      }
      case 'dont_know': {
        if (s.phase === 'cliff' && s.cliff && !s.cliff.resolved) {
          s.noSe = startNoSe({ answer: s.cliff.answer, key: s.cliff.key, at });
          s.cliff.resolved = true;
          s.answered += 1;
          s.phase = 'noSe';
          s.screen = this.noSeScreen();
          return { ...this.step(s.noSe.events, { speak: { text: s.cliff.answer, rate: this.rate(), what: 'answer' } }), ...tag };
        }
        if (s.phase === 'noSe' && s.noSe) {
          s.noSe = advanceNoSe(s.noSe, { type: 'skip' }, this.deps.pack, this.noSeOpts());
          s.screen = this.noSeScreen();
        }
        return { ...this.step([]), ...tag };
      }
      case 'next':
        return { ...(await this.advance(at)), ...tag };
      case 'done': {
        const events: LearnerEvent[] = [];
        s.phase = 'done';
        s.screen = { kind: 'done', meta: this.meta(), answered: s.answered, full: s.full };
        return { ...this.step(events), ...tag };
      }
      case 'meaning':
        return { ...this.meaning(at, argument), ...tag };
    }
  }

  /** "What does it mean": slang first (its note's gloss), else the pair's gloss of the word. */
  private meaning(at: number, argument: string | undefined): LyricStep {
    const { pack, pair } = this.deps;
    const unit = this.unitAt(this.state.unit);
    const text = argument && looseText(pack, argument) !== '' ? argument : undefined;
    let m: MeaningView | null = null;
    const regions = this.state.settings.regions;
    const lookIn = text ?? unit?.text ?? '';
    const match = findSlangMatches(pack, lookIn, { regions }).find((x) => this.state.settings.showExplicit || !x.entry.explicit);
    if (match && (text !== undefined || !this.hiddenSpan(match.start, match.end))) {
      const note = noteFor(match, pack, pair);
      m = { word: match.text, key: note.key, gloss: note.gloss ?? null };
    } else if (text) {
      const seg = pack.segment(text).find((x) => x.kind === 'word');
      if (seg) {
        const norm = seg.norm || pack.normalize(seg.text);
        const lemma = pack.analyze(norm)[0]?.lemma ?? norm;
        m = { word: seg.text, key: lexemeKey(pack.code, lemma), gloss: pair.gloss(lemma) ?? null };
        const ff = pair.falseFriends?.[lemma];
        if (ff !== undefined) m.falseFriend = ff;
      }
    }
    if (!m) return this.step([]);
    return this.step([{ type: 'gloss_lookup', key: m.key, at }], { meaning: m });
  }

  /** True when [start, end) of the current line is hidden by an unanswered cliff. */
  private hiddenSpan(start: number, end: number): boolean {
    const c = this.state.cliff;
    return this.state.phase === 'cliff' && c !== null && !c.resolved && start < c.end && c.start < end;
  }

  private async answer(transcript: string, at: number): Promise<LyricStep> {
    const s = this.state;
    const c = s.cliff as LyricCliffState;
    const { pack, pair, model } = this.deps;
    if (c.options) {
      const idx = c.options.findIndex((o) => sameWords(pack, transcript, o.text));
      if (idx >= 0) return this.chooseOption(idx, at);
    }
    if (s.settings.nativeAnswersAllowed) {
      const nr = nativeReply(transcript, pack, pair, { at, expected: c.answer });
      if (nr.hasNative && nr.targetPhrase !== null) {
        const keys = [...new Set(nr.phrases.filter((p) => p.lemma !== null).map((p) => lexemeKey(pack.code, p.lemma as string)))];
        s.native = { heard: transcript, target: nr.targetPhrase, keys, landed: false, repeat: null };
        c.resolved = true;
        s.answered += 1;
        s.phase = 'native';
        s.screen = this.nativeScreen(nr.ui);
        return this.step(nr.events, { speak: { text: nr.targetPhrase, rate: this.rate(), what: 'answer' } });
      }
    }
    let result: CliffResult;
    let equivalence: LyricEquivalence | undefined;
    let scoredBy: CliffOutcome['scoredBy'] = 'canned';
    if (model) {
      const r = await scoreLyricAnswer(model, pack, { context: c.context, answer: c.answer, before: c.before, ...this.precomputed(c) }, transcript, this.regOpts());
      result = r;
      equivalence = r.equivalence;
      scoredBy = 'model';
      if (result.credit !== 'full' && c.accepted.some((a) => sameWords(pack, transcript, a))) result = { ...result, credit: 'full', reason: 'likely' };
    } else {
      result = cannedResult(pack, transcript, c.answer, c.accepted.slice(1));
    }
    return this.land(result, scoredBy, at, equivalence);
  }

  /**
   * What lyricCliffs already found at a cliff the model rated (its alternatives and, for a
   * single-word cliff, P(actual)), when the session's cliff options search like the credit
   * options; canned cliffs search as usual.
   */
  private precomputed(c: LyricCliffState): { alternatives?: NextWord[]; actualLogprob?: number } {
    if (!c.rated || !alternativesReusable(this.o.cliff.cliff ?? {}, {})) return {};
    const out: { alternatives?: NextWord[]; actualLogprob?: number } = { alternatives: c.alternatives };
    if (c.prob !== null && c.prob > 0) out.actualLogprob = Math.log(c.prob);
    return out;
  }

  private async chooseOption(index: number, at: number): Promise<LyricStep> {
    const c = this.state.cliff;
    if (this.state.phase !== 'cliff' || !c || !c.options || c.resolved) return this.step([]);
    const opt = c.options[index];
    if (!opt) return this.step([]);
    return this.land(optionResult(opt.text, opt.natural, opt.prob, c.alternatives), 'options', at);
  }

  private land(result: CliffResult, scoredBy: CliffOutcome['scoredBy'], at: number, equivalence?: LyricEquivalence): LyricStep {
    const s = this.state;
    const c = s.cliff as LyricCliffState;
    const unit = this.unitAt(s.unit) as TextUnit;
    const outcome = buildOutcome(result, {
      pack: this.deps.pack,
      expected: c.answer,
      rung: c.rung,
      scoredBy: scoredBy === 'options' && c.prob === null ? 'canned' : scoredBy,
      actualProb: c.prob,
      ...(equivalence ? { equivalence } : {}),
      options: { ...DEFAULT_LANDING_OPTIONS, ...this.o.landing },
    });
    if (scoredBy === 'options') outcome.scoredBy = 'options';
    c.outcome = outcome;
    c.resolved = true;
    s.answered += 1;
    if (result.credit === 'full') s.full += 1;
    s.phase = 'result';
    s.screen = { kind: 'result', meta: this.meta(), lineIndex: unit.index, outcome, line: unit.text };
    return this.step([{ type: 'cliff_answer', key: c.key, at, credit: result.credit, rung: c.rung }]);
  }

  private noSeScreen(): LyricScreen {
    const st = this.state.noSe as NoSeState;
    const screen: LyricScreen = { kind: 'noSe', meta: this.meta(), lineIndex: this.state.unit, step: st.step, answer: st.answer, ui: st.ui };
    if (st.last) screen.repeat = alignmentView(st.last);
    return screen;
  }

  private nativeScreen(ui: UiText | null): LyricScreen {
    const n = this.state.native as NonNullable<LyricState['native']>;
    const screen: LyricScreen = { kind: 'nativeReply', meta: this.meta(), lineIndex: this.state.unit, heard: n.heard, target: n.target, ui };
    if (n.repeat) screen.repeat = n.repeat;
    return screen;
  }

  private nativeRepeat(transcript: string, at: number): LyricStep {
    const n = this.state.native;
    if (!n || !n.target) return this.step([]);
    const a = alignTranscript(n.target, transcript, this.deps.pack, this.regOpts());
    n.repeat = alignmentView(a);
    const landed = a.total > 0 && a.understood === a.total;
    const events: LearnerEvent[] = landed && !n.landed ? n.keys.map((key) => ({ type: 'spoke_correct' as const, key, at })) : [];
    if (landed) n.landed = true;
    this.state.screen = this.nativeScreen(landed ? null : { key: 'cliff.repeatAloud' });
    return this.step(events);
  }

  private echoScreen(unit: TextUnit, result: ReturnType<typeof echoLine> | null): LyricScreen {
    return {
      kind: 'echo',
      meta: this.meta(),
      lineIndex: unit.index,
      line: unit.text,
      tiles: result ? result.words.map((w) => ({ text: w.text, slang: w.slang, status: w.status })) : null,
      landed: result ? result.landed : null,
      total: result ? result.total : this.contentOf(unit.text).length,
      ui: result ? result.label : { key: 'music.singBack' },
    };
  }

  /**
   * Score a sing-back (echoLine): every slang lexeme of the line whose words all landed
   * gets spoke_correct (the learner said it, in time with the song), keyed like the
   * register packs' slang lexemes.
   */
  private echo(unit: TextUnit, transcript: string, at: number): LyricStep {
    const pack = this.deps.pack;
    const result = echoLine(unit.text, transcript, pack, this.regOpts());
    const events: LearnerEvent[] = [];
    const seen = new Set<string>();
    const content = this.contentOf(unit.text);
    for (const m of findSlangMatches(pack, unit.text, { regions: this.state.settings.regions })) {
      const key = lexemeKey(pack.code, m.entry.lemma);
      if (seen.has(key)) continue;
      const idx = content.map((x, i) => ({ x, i })).filter(({ x }) => x.start >= m.start && x.end <= m.end).map(({ i }) => i);
      if (idx.length > 0 && idx.every((i) => result.words[i]?.status === 'landed')) {
        seen.add(key);
        events.push({ type: 'spoke_correct', key, at });
      }
    }
    this.state.screen = this.echoScreen(unit, result);
    return this.step(events);
  }
}

/** A seeded shuffle that keeps a stable order for equal draws (copy). */
function shuffledStable<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item, i) => ({ item, i, r: random() }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
