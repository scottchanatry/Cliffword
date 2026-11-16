/**
 * SpeechIn over expo-speech-recognition (iOS SFSpeechRecognizer, Android SpeechRecognizer).
 * The module is passed in (createNativeSpeechIn.ts loads the real one; tests pass a fake), so
 * this file only imports the package's types and never reaches the web bundle.
 *
 * Sessions
 * - start(): permission (asks once when undetermined, so the first hold brings up the system
 *   prompt), then the locale and on-device plan (planRecognition: on-device whenever available;
 *   without it, 'on-device-unavailable' unless the options allow the server), then the native
 *   start with interimResults, continuous (hold), addsPunctuation off, contextual strings from
 *   ListenOptions.hints, maxAlternatives 3 and volume events every 50 ms.
 * - Native events -> SpeechIn: result (partial) -> onPartial with every final piece so far plus
 *   the current partial; final results are collected (continuous mode sends one per pause on
 *   Android 13+ and iOS 18+) and onFinal is emitted once, at the native end, with word timings
 *   and the spoken time; error -> onError (mapped by mapNativeError) and no final; end -> onEnd.
 * - stop() before the recognizer has started listening (a hold that ends early) cancels: native
 *   abort, onEnd only. abort() always ends at once with onEnd only; the native "aborted" error
 *   and the late native end are ignored, and the next start() waits for that end (up to 1 s) so
 *   a stale end cannot close the new session.
 * - "No speech" and "no match" after words were heard, and any error after the learner let go,
 *   keep what was heard: the final carries it (the last partial if no final arrived).
 * - Watchdogs: a native start with no "start" event in 5 s fails with 'unknown'; a stop with no
 *   end in 3 s finishes with what was heard; an error with no end in 1.5 s ends the session.
 *
 * Word timings and spoken time (timings.ts): iOS segments give word start and end (ms from the
 * audio start, moved to the session clock); Android 14+ with the on-device Google recognizer
 * gives starts only, so ends are estimated; otherwise words are spread over the voiced parts of
 * the input level (FinalTranscript.wordTiming says which). spokenMs is the voiced time.
 *
 * iOS audio session (iosCategory, applied by the module before each session):
 * playAndRecord, mode default, options defaultToSpeaker + allowBluetoothA2DP. Why:
 * - playAndRecord: recognition needs input; expo-speech's AVSpeechSynthesizer uses the app's
 *   session, so text to speech right after a hold plays in the same session without a category
 *   change, and playAndRecord is not silenced by the Ring/Silent switch.
 * - mode default, not the module's default 'measurement' (it lowers playback level, and the
 *   session stays in it after recognition, so speech afterwards would be quiet) and not
 *   voiceChat (voice processing ducks playback).
 * - defaultToSpeaker: without it playAndRecord routes playback to the earpiece receiver, which
 *   sounds like silence when held at arm's length.
 * - allowBluetoothA2DP, not allowBluetooth (HFP): headphones keep high-quality output for speech
 *   and music; input then comes from the phone's microphone.
 * - not mixWithOthers: activating the session interrupts other audio while listening. Apple
 *   Music is paused by the music feature before the microphone opens.
 * Before the first hold the category is IOS_STARTUP_AUDIO_SESSION (playback), set once at start
 * by createNativeSpeechIn, so text to speech is not muted by the Ring/Silent switch.
 * The session is left active after a session ends (no setActive(false)): deactivating while
 * text to speech starts fails or cuts it, and notifyOthersOnDeactivation would resume other
 * apps' audio mid-lesson. Whoever resumes Apple Music switches the category back to playback.
 * Override with ExpoSpeechInOptions.iosAudioSession.
 */
import type {
  ExpoSpeechRecognitionNativeEventMap,
  ExpoSpeechRecognitionOptions,
  SetCategoryOptions,
} from 'expo-speech-recognition';
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { moduleLevelToDb } from './levels';
import { ANDROID_ON_DEVICE_API, baseLanguage, planRecognition, type RecognitionPlan, type RecognizerFacts } from './locales';
import { SpeechInBase, statusForPermission } from './SpeechInBase';
import {
  estimateHeardTimings,
  fillWordEnds,
  isStartsOnly,
  segmentsToWords,
  splitWords,
  timingsLookValid,
  totalMs,
  voicedRuns,
  wordsSpanMs,
  type LevelSample,
  type RecognizerSegment,
  type TimeSpan,
} from './timings';
import type {
  AvailabilityQuery,
  FinalTranscript,
  LanguageDownload,
  ListenOptions,
  SpeechAvailability,
  SpeechInCapabilities,
  SpeechInError,
  SpeechInErrorCode,
  SpeechPermission,
  TranscriptWord,
  WordTimingSource,
} from './types';

export type RecognitionEventMap = ExpoSpeechRecognitionNativeEventMap;
export type RecognitionEventName = keyof RecognitionEventMap;

/** A permission response (expo-modules-core PermissionResponse, plus iOS `restricted`). */
export interface RecognitionPermission {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  restricted?: boolean;
}

/** The part of ExpoSpeechRecognitionModule this adapter uses. */
export interface SpeechRecognitionModuleLike {
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
  getPermissionsAsync(): Promise<RecognitionPermission>;
  requestPermissionsAsync(): Promise<RecognitionPermission>;
  getSupportedLocales(options: { androidRecognitionServicePackage?: string }): Promise<{
    locales: string[];
    installedLocales: string[];
  }>;
  /**
   * Without an argument: iOS, the device-locale recognizer runs on device; Android, an on-device
   * recognizer exists. With a locale (iOS, patches/expo-speech-recognition+58.0.1.patch): that
   * locale's recognizer runs on device. The unpatched iOS module throws for the argument.
   */
  supportsOnDeviceRecognition(locale?: string): boolean;
  isRecognitionAvailable(): boolean;
  /** iOS: AVAudioSession.setCategory on the app's shared session (no activation). */
  setCategoryIOS?(options: SetCategoryOptions): void;
  androidTriggerOfflineModelDownload(options: { locale: string }): Promise<{ status: string; message: string }>;
  addListener<E extends RecognitionEventName>(
    eventName: E,
    listener: (event: RecognitionEventMap[E]) => void,
  ): { remove(): void };
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ExpoSpeechInOptions {
  platform: 'ios' | 'android';
  /** Android API level (Platform.Version). */
  androidApiLevel?: number;
  clock?: Clock;
  timers?: Timers;
  /** iOS audio session during recognition. Default IOS_RECOGNITION_AUDIO_SESSION (see the header). */
  iosAudioSession?: SetCategoryOptions;
  /** Volume event interval asked of the module, and the least gap between onLevel events (ms). */
  levelIntervalMs?: number;
  /** How long the supported-locale list is reused (ms). */
  localesTtlMs?: number;
}

/** The iOS audio session for recognition (the reasons are in the file header). */
export const IOS_RECOGNITION_AUDIO_SESSION: SetCategoryOptions = {
  category: 'playAndRecord',
  categoryOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'],
  mode: 'default',
};

/**
 * The iOS audio session from app start until the first hold (createNativeSpeechIn sets it once):
 * playback, mode default. iOS starts an app in soloAmbient, which the Ring/Silent switch mutes,
 * so the story's text to speech (AVSpeechSynthesizer, on the app's session) would be silent on a
 * phone set to silent until the first hold switched the category. playback is not muted by the
 * switch, plays from the speaker, and, unlike playAndRecord, cannot bring up the microphone
 * prompt before the learner holds to speak. Setting the category does not activate the session,
 * so other apps' audio keeps playing until the app first speaks.
 */
export const IOS_STARTUP_AUDIO_SESSION: SetCategoryOptions = {
  category: 'playback',
  categoryOptions: [],
  mode: 'default',
};

export const LEVEL_INTERVAL_MS = 50;
/** iOS documents contextualStrings as best kept to about a hundred phrases. */
export const MAX_HINTS = 100;
export const START_TIMEOUT_MS = 5000;
export const STOP_TIMEOUT_MS = 3000;
export const ERROR_END_TIMEOUT_MS = 1500;
export const PREVIOUS_RUN_TIMEOUT_MS = 1000;
export const LOCALES_TIMEOUT_MS = 2500;
const LOCALES_TTL_MS = 60000;
/** About five minutes of levels at 20 a second. */
const MAX_LEVEL_SAMPLES = 6000;
/** Android SpeechRecognizer error codes the mapping reads (SpeechRecognizerErrorAndroid). */
const ANDROID_ERROR_NO_MATCH = 7;
const ANDROID_ERROR_LANGUAGE_UNAVAILABLE = 13;
/** Languages written without spaces between words. */
const NO_SPACE_LANGUAGES = new Set(['ja', 'zh', 'yue', 'th', 'lo', 'km', 'my', 'bo']);

/** What mapNativeError needs to know about the session. */
export interface NativeErrorContext {
  platform: 'ios' | 'android';
  /** The session asked for on-device recognition. */
  onDevice: boolean;
  /** The learner had let go (stop() was called). */
  stopRequested: boolean;
  /** A nomatch event came first. */
  noMatch: boolean;
}

/**
 * Maps an expo-speech-recognition error event to a SpeechInError:
 * - aborted (not ours) / busy -> interrupted; interrupted -> interrupted;
 * - Android client (ERROR_CLIENT, typically a stop before the recognizer was ready) -> no-speech
 *   after the learner let go, else interrupted;
 * - no-speech after a nomatch, or with Android ERROR_NO_MATCH -> no-match; speech-timeout -> no-speech;
 * - language-not-supported -> on-device-unavailable when on-device was asked for or Android says
 *   the language is not downloaded (ERROR_LANGUAGE_UNAVAILABLE), else language-not-supported;
 * - service-not-allowed -> Android: not-allowed (insufficient permissions); iOS: on-device-unavailable
 *   (assets not installed) when on-device, else unavailable (Siri and Dictation off);
 * - network -> interrupted when on-device (iOS reports a lost local speech process as network),
 *   else network; too-many-requests -> network;
 * - audio-capture, not-allowed as they are; anything else -> unknown.
 */
export function mapNativeError(
  event: { error: string; message?: string; code?: number },
  ctx: NativeErrorContext,
): SpeechInError {
  const code = mapCode(event, ctx);
  const detail = [event.error, event.code !== undefined && event.code >= 0 ? `code ${event.code}` : '', event.message ?? '']
    .filter(Boolean)
    .join(': ');
  return { code, message: detail || undefined };
}

function mapCode(event: { error: string; code?: number }, ctx: NativeErrorContext): SpeechInErrorCode {
  switch (event.error) {
    case 'aborted':
    case 'busy':
    case 'interrupted':
      return 'interrupted';
    case 'audio-capture':
      return 'audio-capture';
    case 'not-allowed':
      return 'not-allowed';
    case 'client':
      if (!ctx.stopRequested) return 'interrupted';
      return ctx.noMatch ? 'no-match' : 'no-speech';
    case 'no-speech':
      return ctx.noMatch || event.code === ANDROID_ERROR_NO_MATCH ? 'no-match' : 'no-speech';
    case 'speech-timeout':
      return ctx.noMatch ? 'no-match' : 'no-speech';
    case 'language-not-supported':
      return ctx.onDevice || event.code === ANDROID_ERROR_LANGUAGE_UNAVAILABLE ? 'on-device-unavailable' : 'language-not-supported';
    case 'service-not-allowed':
      if (ctx.platform === 'android') return 'not-allowed';
      return ctx.onDevice ? 'on-device-unavailable' : 'unavailable';
    case 'network':
      return ctx.onDevice ? 'interrupted' : 'network';
    case 'too-many-requests':
      return 'network';
    default:
      return 'unknown';
  }
}

/** Codes that do not cancel what was already heard. */
const KEEPS_TRANSCRIPT: ReadonlySet<SpeechInErrorCode> = new Set(['no-speech', 'no-match']);

/** Joins recognized pieces with the language's word separator, whitespace collapsed. */
export function joinTranscripts(parts: readonly string[], separator = ' '): string {
  return parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(separator);
}

/** ' ' for languages written with spaces, '' for those without (Japanese, Chinese, Thai, ...). */
export function wordSeparatorFor(locale: string): string {
  return NO_SPACE_LANGUAGES.has(baseLanguage(locale)) ? '' : ' ';
}

/** Hints as contextual strings: trimmed, de-duplicated (case-insensitive), at most MAX_HINTS. */
export function contextualStringsFor(hints: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const hint of hints ?? []) {
    const text = typeof hint === 'string' ? hint.replace(/\s+/g, ' ').trim() : '';
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_HINTS) break;
  }
  return out;
}

interface Piece {
  text: string;
  confidence?: number;
  segments: RecognizerSegment[];
  alternatives: string[];
}

interface Run {
  /** The session the native run belongs to; null once it was cancelled or finished. */
  session: Session | null;
  ended: boolean;
  done: Promise<void>;
  resolve: () => void;
}

type SessionState = 'preparing' | 'starting' | 'listening' | 'stopping';

interface Session {
  readonly opts: ListenOptions;
  /** Clock time of start(); word timings and levels are relative to it. */
  readonly startedAt: number;
  state: SessionState;
  plan: { locale: string; onDevice: boolean } | null;
  run: Run | null;
  /** Clock time when the native audio started. */
  audioStartAt: number | null;
  /** Native epoch timestamps of the audio start and end. */
  audioStartTs: number | null;
  audioEndTs: number | null;
  pieces: Piece[];
  interim: string;
  lastPartial: string;
  levels: LevelSample[];
  lastLevelAt: number;
  noMatch: boolean;
  failed: boolean;
  stopRequested: boolean;
  timer: unknown;
}

interface SupportedLocales {
  locales: string[];
  installedLocales: string[];
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class ExpoSpeechIn extends SpeechInBase {
  readonly kind = 'native' as const;
  readonly capabilities: SpeechInCapabilities = {
    speech: true,
    onDevice: true,
    partials: true,
    levels: true,
    wordTimings: true,
  };

  private readonly platform: 'ios' | 'android';
  private readonly androidApiLevel: number;
  private readonly clock: Clock;
  private readonly timers: Timers;
  private readonly iosAudioSession: SetCategoryOptions;
  private readonly levelIntervalMs: number;
  private readonly localesTtlMs: number;

  private session: Session | null = null;
  private run: Run | null = null;
  private subscribed = false;
  private permissionGranted = false;
  private canAskAgain = true;
  private localeArgumentRejected = false;
  private localesCache: { at: number; value: Promise<SupportedLocales | null> } | null = null;

  constructor(
    private readonly mod: SpeechRecognitionModuleLike,
    opts: ExpoSpeechInOptions,
  ) {
    super();
    this.platform = opts.platform;
    this.androidApiLevel = opts.androidApiLevel ?? 0;
    this.clock = opts.clock ?? systemClock;
    this.timers = opts.timers ?? defaultTimers;
    this.iosAudioSession = opts.iosAudioSession ?? IOS_RECOGNITION_AUDIO_SESSION;
    this.levelIntervalMs = opts.levelIntervalMs ?? LEVEL_INTERVAL_MS;
    this.localesTtlMs = opts.localesTtlMs ?? LOCALES_TTL_MS;
  }

  // Permission and availability

  async permissionStatus(): Promise<SpeechPermission> {
    try {
      return this.readPermission(await this.mod.getPermissionsAsync());
    } catch {
      return 'undetermined';
    }
  }

  async requestPermission(): Promise<SpeechPermission> {
    try {
      const permission = this.readPermission(await this.mod.requestPermissionsAsync());
      if (permission === 'granted') this.permissionGranted = true;
      return permission;
    } catch {
      return this.permissionStatus();
    }
  }

  override async availability(query: AvailabilityQuery): Promise<SpeechAvailability> {
    try {
      const permission = await this.permissionStatus();
      if (this.platform === 'android' && !this.call(() => this.mod.isRecognitionAvailable(), true)) {
        return { status: 'unavailable', permission, locale: null, onDevice: false, canDownload: false };
      }
      const plan = await this.planFor(query);
      if (!plan.ok) {
        return { status: plan.code, permission, locale: plan.locale, onDevice: false, canDownload: plan.canDownload };
      }
      return {
        status: statusForPermission(permission, this.canAskAgain),
        permission,
        locale: plan.locale,
        onDevice: plan.onDevice,
        canDownload: false,
      };
    } catch {
      return { status: 'unavailable', permission: 'undetermined', locale: null, onDevice: false, canDownload: false };
    }
  }

  override async downloadLanguage(lang: string): Promise<LanguageDownload> {
    if (this.platform !== 'android' || this.androidApiLevel < ANDROID_ON_DEVICE_API) return 'unsupported';
    try {
      const plan = await this.planFor({ lang, onDevice: true });
      if (plan.ok && plan.onDevice) return 'done';
      if (!plan.ok && plan.code === 'language-not-supported') return 'unsupported';
      const locale = plan.locale ?? lang;
      const result = await this.mod.androidTriggerOfflineModelDownload({ locale });
      this.localesCache = null;
      return result?.status === 'download_success' ? 'done' : 'started';
    } catch {
      this.localesCache = null;
      return 'failed';
    }
  }

  // Sessions

  async start(opts: ListenOptions): Promise<void> {
    if (this.listening) {
      this.errors.emit({ code: 'busy' });
      return;
    }
    const session: Session = {
      opts,
      startedAt: this.clock.now(),
      state: 'preparing',
      plan: null,
      run: null,
      audioStartAt: null,
      audioStartTs: null,
      audioEndTs: null,
      pieces: [],
      interim: '',
      lastPartial: '',
      levels: [],
      lastLevelAt: -Infinity,
      noMatch: false,
      failed: false,
      stopRequested: false,
      timer: null,
    };
    this.session = session;
    this.listening = true;
    try {
      this.subscribe();
      const permission = await this.ensurePermission();
      if (this.session !== session) return;
      if (permission !== 'granted') {
        this.failSession(session, { code: 'not-allowed', message: `permission ${permission}` });
        return;
      }
      const plan = await this.planFor(opts);
      if (this.session !== session) return;
      if (!plan.ok) {
        this.failSession(session, { code: plan.code, message: `${[opts.lang, ...(opts.langFallbacks ?? [])].join(', ')}` });
        return;
      }
      session.plan = { locale: plan.locale, onDevice: plan.onDevice };
      await this.previousRunEnded();
      if (this.session !== session) return;

      let resolve: () => void = () => undefined;
      const done = new Promise<void>((r) => {
        resolve = r;
      });
      const run: Run = { session, ended: false, done, resolve };
      this.run = run;
      session.run = run;
      session.state = 'starting';
      this.arm(session, START_TIMEOUT_MS, () => {
        if (session.state === 'starting') this.failSession(session, { code: 'unknown', message: 'the recognizer did not start' });
      });
      try {
        this.mod.start(this.nativeOptions(opts, session.plan));
      } catch (error) {
        run.ended = true;
        run.resolve();
        throw error;
      }
    } catch (error) {
      if (this.session === session) this.failSession(session, { code: 'unknown', message: messageOf(error) });
    }
  }

  async stop(): Promise<void> {
    const s = this.session;
    if (!s || s.state === 'stopping') return;
    if (s.state === 'preparing' || (s.state === 'starting' && s.audioStartAt === null)) {
      this.cancel(s);
      return;
    }
    s.state = 'stopping';
    s.stopRequested = true;
    this.arm(s, STOP_TIMEOUT_MS, () => this.forceFinish(s));
    try {
      this.mod.stop();
    } catch {
      this.forceFinish(s);
    }
  }

  abort(): void {
    const s = this.session;
    if (s) this.cancel(s);
  }

  /** The native start options for a session. */
  private nativeOptions(opts: ListenOptions, plan: { locale: string; onDevice: boolean }): ExpoSpeechRecognitionOptions {
    const options: ExpoSpeechRecognitionOptions = {
      lang: plan.locale,
      interimResults: opts.interim,
      continuous: opts.continuous ?? false,
      requiresOnDeviceRecognition: plan.onDevice,
      addsPunctuation: false,
      maxAlternatives: 3,
      volumeChangeEventOptions: { enabled: true, intervalMillis: this.levelIntervalMs },
    };
    const hints = contextualStringsFor(opts.hints);
    if (hints.length > 0) options.contextualStrings = hints;
    if (this.platform === 'ios') {
      options.iosCategory = this.iosAudioSession;
      options.iosTaskHint = 'dictation';
      options.iosVoiceProcessingEnabled = false;
    } else if (this.androidApiLevel >= 33) {
      // Lyrics and street register: never mask words. The module sets intent extras by reflection,
      // and this one only exists from API 33 (passing it earlier fails every session).
      options.androidIntentOptions = { EXTRA_MASK_OFFENSIVE_WORDS: false };
    }
    return options;
  }

  // Native events

  private subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    const on = <E extends RecognitionEventName>(name: E, handler: (event: RecognitionEventMap[E]) => void) => {
      this.mod.addListener(name, (event) => {
        try {
          handler(event);
        } catch (error) {
          // A throwing app listener must not take the native event loop down with it.
          console.error(`ExpoSpeechIn: ${name} listener failed`, error);
        }
      });
    };
    on('start', () => this.onNativeStart());
    on('audiostart', (e) => this.onAudioStart(e));
    on('audioend', (e) => this.onAudioEnd(e));
    on('volumechange', (e) => this.onVolume(e));
    on('result', (e) => this.onResult(e));
    on('nomatch', () => this.onNoMatch());
    on('error', (e) => this.onNativeError(e));
    on('end', () => this.onNativeEnd());
  }

  /** The session the running native run belongs to, if it is still the current one. */
  private current(): Session | null {
    const s = this.run?.session ?? null;
    return s !== null && s === this.session ? s : null;
  }

  private onNativeStart(): void {
    const s = this.current();
    if (!s || s.state !== 'starting') return;
    s.state = 'listening';
    this.clearTimer(s);
  }

  private onAudioStart(event: RecognitionEventMap['audiostart']): void {
    const s = this.current();
    if (!s) return;
    s.audioStartAt = this.clock.now();
    s.audioStartTs = finite(event?.timestamp);
  }

  private onAudioEnd(event: RecognitionEventMap['audioend']): void {
    const s = this.current();
    if (!s) return;
    s.audioEndTs = finite(event?.timestamp);
  }

  private onVolume(event: RecognitionEventMap['volumechange']): void {
    const s = this.current();
    const value = finite(event?.value);
    if (!s || value === null) return;
    const t = this.clock.now() - s.startedAt;
    const db = moduleLevelToDb(value);
    if (s.levels.length < MAX_LEVEL_SAMPLES) s.levels.push({ t, db });
    // 0.8: volume events arrive with jitter around the interval; a strict gap would drop every other one.
    if (t - s.lastLevelAt < this.levelIntervalMs * 0.8) return;
    s.lastLevelAt = t;
    this.emitLevel(db);
  }

  private onResult(event: RecognitionEventMap['result']): void {
    const s = this.current();
    if (!s || s.failed) return;
    const results = Array.isArray(event?.results) ? event.results : [];
    const best = results[0];
    if (event?.isFinal) {
      const text = typeof best?.transcript === 'string' ? best.transcript : '';
      if (best && text.trim()) {
        const piece: Piece = {
          text,
          confidence: finite(best.confidence) !== null && best.confidence > 0 ? best.confidence : undefined,
          segments: Array.isArray(best.segments) ? best.segments : [],
          alternatives: results
            .slice(1)
            .map((r) => (typeof r?.transcript === 'string' ? r.transcript : ''))
            .filter((t) => t.trim() !== ''),
        };
        if (!this.repeatsLastPiece(s, piece)) s.pieces.push(piece);
      }
      s.interim = '';
    } else {
      s.interim = typeof best?.transcript === 'string' ? best.transcript : '';
    }
    if (!s.opts.interim) return;
    const partial = this.joined(s, true);
    if (partial && partial !== s.lastPartial) {
      s.lastPartial = partial;
      this.partials.emit(partial);
    }
  }

  private onNoMatch(): void {
    const s = this.current();
    if (s) s.noMatch = true;
  }

  private onNativeError(event: RecognitionEventMap['error']): void {
    const s = this.current();
    if (!s || s.failed) return;
    const error = mapNativeError(event ?? { error: 'unknown' }, {
      platform: this.platform,
      onDevice: s.plan?.onDevice ?? false,
      stopRequested: s.stopRequested,
      noMatch: s.noMatch,
    });
    if (error.code === 'not-allowed') this.permissionGranted = false;
    if (error.code === 'language-not-supported' || error.code === 'on-device-unavailable') this.localesCache = null;
    const heard = s.pieces.length > 0 || s.interim.trim() !== '';
    if (heard && (KEEPS_TRANSCRIPT.has(error.code) || s.stopRequested)) return;
    if (error.code === 'no-match') s.noMatch = true;
    s.failed = true;
    this.arm(s, ERROR_END_TIMEOUT_MS, () => this.forceFinish(s));
    this.errors.emit(error);
  }

  private onNativeEnd(): void {
    const run = this.run;
    if (!run) return;
    run.ended = true;
    run.resolve();
    const s = run.session;
    run.session = null;
    if (s && s === this.session) this.finish(s);
  }

  // Session endings

  /** The native run ended: the final (or a no-speech / no-match error), then onEnd. */
  private finish(s: Session): void {
    this.clearTimer(s);
    if (this.session === s) this.session = null;
    try {
      if (!s.failed) {
        const final = this.buildFinal(s);
        if (final) this.finals.emit(final);
        else this.errors.emit({ code: s.noMatch ? 'no-match' : 'no-speech' });
      }
    } finally {
      this.endSession();
    }
  }

  /** Ends now with what was heard, without waiting for the native end. */
  private forceFinish(s: Session): void {
    if (this.session !== s) return;
    this.detach(s);
    this.finish(s);
  }

  /** Ends at once with onEnd only (abort, a hold that ended early). */
  private cancel(s: Session): void {
    this.clearTimer(s);
    if (this.session === s) this.session = null;
    this.detach(s);
    this.endSession();
  }

  /** A session that could not run: onError, then onEnd. */
  private failSession(s: Session, error: SpeechInError): void {
    this.clearTimer(s);
    if (this.session === s) this.session = null;
    s.failed = true;
    this.detach(s);
    try {
      this.errors.emit(error);
    } finally {
      this.endSession();
    }
  }

  /** Stops routing native events to the session and aborts the native run if it is still going. */
  private detach(s: Session): void {
    const run = s.run;
    if (!run || run.session !== s) return;
    run.session = null;
    if (!run.ended) this.call(() => this.mod.abort(), undefined);
  }

  // Building the final transcript

  private joined(s: Session, withInterim: boolean): string {
    const parts = s.pieces.map((p) => p.text);
    if (withInterim && s.interim.trim()) parts.push(s.interim);
    return joinTranscripts(parts, wordSeparatorFor(s.plan?.locale ?? s.opts.lang));
  }

  private buildFinal(s: Session): FinalTranscript | null {
    const text = this.joined(s, true);
    if (!text) return null;
    const interimUsed = s.interim.trim() !== '';
    const durationMs = Math.max(0, this.clock.now() - s.startedAt);
    const audioOffset = s.audioStartAt !== null ? Math.min(durationMs, Math.max(0, s.audioStartAt - s.startedAt)) : 0;
    const audioEnd =
      s.audioStartTs !== null && s.audioEndTs !== null && s.audioEndTs >= s.audioStartTs
        ? Math.min(durationMs, audioOffset + (s.audioEndTs - s.audioStartTs))
        : durationMs;
    const span: TimeSpan = { startMs: audioOffset, endMs: Math.max(audioOffset, audioEnd) };
    const runs = voicedRuns(s.levels);
    const { words, wordTiming } = this.timeWords(s, interimUsed, span, runs, durationMs);
    const voiced = Math.min(durationMs, totalMs(runs));
    const spokenMs = voiced > 0 ? voiced : Math.min(durationMs, wordsSpanMs(words)) || durationMs;
    const confidences = s.pieces.map((p) => p.confidence).filter((c): c is number => c !== undefined);
    const alternatives = interimUsed ? [] : this.alternatives(s).filter((a) => a !== text);
    const final: FinalTranscript = {
      text,
      words,
      wordTiming,
      durationMs,
      spokenMs,
      source: 'speech',
      locale: s.plan?.locale,
      onDevice: s.plan?.onDevice,
    };
    if (confidences.length > 0) final.confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    if (alternatives.length > 0) final.alternatives = alternatives;
    return final;
  }

  private timeWords(
    s: Session,
    interimUsed: boolean,
    span: TimeSpan,
    runs: readonly TimeSpan[],
    durationMs: number,
  ): { words: TranscriptWord[]; wordTiming: WordTimingSource } {
    const segmented = !interimUsed && s.pieces.length > 0 && s.pieces.every((p) => p.segments.length > 0);
    if (segmented) {
      const startsOnly = s.pieces.some((p) => isStartsOnly(p.segments));
      let words = s.pieces.flatMap((p) => segmentsToWords(p.segments, span.startMs));
      if (startsOnly) words = fillWordEnds(words, span.endMs);
      if (words.length > 0 && timingsLookValid(words, durationMs)) {
        return { words, wordTiming: startsOnly ? 'starts' : 'measured' };
      }
    }
    const pieces = s.pieces.map((p) => splitWords(p.text));
    if (interimUsed) pieces.push(splitWords(s.interim));
    return { words: estimateHeardTimings(pieces, span, runs), wordTiming: 'estimated' };
  }

  /** Other readings: the earlier pieces as heard, with each alternative of the last piece. */
  private alternatives(s: Session): string[] {
    const last = s.pieces[s.pieces.length - 1];
    if (!last) return [];
    const before = s.pieces.slice(0, -1).map((p) => p.text);
    const separator = wordSeparatorFor(s.plan?.locale ?? s.opts.lang);
    return [...new Set(last.alternatives.map((a) => joinTranscripts([...before, a], separator)))].filter(Boolean);
  }

  /** iOS 18 can report the last continuous piece twice (once at the pause, again at stop). */
  private repeatsLastPiece(s: Session, piece: Piece): boolean {
    const last = s.pieces[s.pieces.length - 1];
    if (!last || this.platform !== 'ios') return false;
    if (joinTranscripts([last.text]) !== joinTranscripts([piece.text])) return false;
    const a = last.segments[0];
    const b = piece.segments[0];
    return (!a && !b) || (a !== undefined && b !== undefined && a.startTimeMillis === b.startTimeMillis);
  }

  // Permission, locales, plumbing

  private readPermission(response: RecognitionPermission | null | undefined): SpeechPermission {
    if (!response) return 'undetermined';
    this.canAskAgain = response.canAskAgain !== false && !response.restricted;
    if (response.granted || response.status === 'granted') return 'granted';
    if (response.restricted || response.status === 'denied') return 'denied';
    return 'undetermined';
  }

  /** Granted (remembered once seen), asking when undetermined. */
  private async ensurePermission(): Promise<SpeechPermission> {
    if (this.permissionGranted) return 'granted';
    let permission = await this.permissionStatus();
    if (permission === 'undetermined') permission = await this.requestPermission();
    if (permission === 'granted') this.permissionGranted = true;
    return permission;
  }

  private async planFor(query: AvailabilityQuery): Promise<RecognitionPlan> {
    const wanted = [query.lang, ...(query.langFallbacks ?? [])].filter((l) => typeof l === 'string' && l.trim() !== '');
    const supported = await this.supportedLocales();
    const facts: RecognizerFacts = {
      platform: this.platform,
      androidApiLevel: this.androidApiLevel,
      locales: supported?.locales ?? null,
      installedLocales: supported?.installedLocales ?? null,
      onDeviceRecognizer: this.call(() => Boolean(this.mod.supportsOnDeviceRecognition()), false),
      onDeviceFor: this.platform === 'ios' ? (locale) => this.iosOnDeviceFor(locale) : undefined,
    };
    return planRecognition(wanted, query.onDevice, facts);
  }

  private iosOnDeviceFor(locale: string): boolean | undefined {
    if (this.localeArgumentRejected) return undefined;
    try {
      return Boolean(this.mod.supportsOnDeviceRecognition(locale));
    } catch {
      // The module without the Cliffword patch takes no argument.
      this.localeArgumentRejected = true;
      return undefined;
    }
  }

  /** getSupportedLocales, reused for localesTtlMs; null when the call fails or hangs. */
  private supportedLocales(): Promise<SupportedLocales | null> {
    const now = this.clock.now();
    if (this.localesCache && now - this.localesCache.at < this.localesTtlMs) return this.localesCache.value;
    const value = new Promise<SupportedLocales | null>((resolve) => {
      const timer = this.timers.setTimeout(() => resolve(null), LOCALES_TIMEOUT_MS);
      const settle = (result: SupportedLocales | null) => {
        this.timers.clearTimeout(timer);
        resolve(result);
      };
      try {
        this.mod.getSupportedLocales({}).then(
          (r) => settle({ locales: strings(r?.locales), installedLocales: strings(r?.installedLocales) }),
          () => settle(null),
        );
      } catch {
        settle(null);
      }
    });
    this.localesCache = { at: now, value };
    return value;
  }

  /** Waits (up to PREVIOUS_RUN_TIMEOUT_MS) for the previous native run's end event. */
  private async previousRunEnded(): Promise<void> {
    const previous = this.run;
    if (!previous || previous.ended) return;
    let timer: unknown = null;
    await Promise.race([
      previous.done,
      new Promise<void>((resolve) => {
        timer = this.timers.setTimeout(resolve, PREVIOUS_RUN_TIMEOUT_MS);
      }),
    ]);
    this.timers.clearTimeout(timer);
  }

  private arm(s: Session, ms: number, fn: () => void): void {
    this.clearTimer(s);
    s.timer = this.timers.setTimeout(() => {
      s.timer = null;
      fn();
    }, ms);
  }

  private clearTimer(s: Session): void {
    if (s.timer === null) return;
    this.timers.clearTimeout(s.timer);
    s.timer = null;
  }

  /** Runs a module call that may throw (a missing or older native method); `fallback` on error. */
  private call<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }
}
