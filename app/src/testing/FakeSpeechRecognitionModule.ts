/**
 * Test stand-in for expo-speech-recognition's native module (ExpoSpeechRecognitionModule): it
 * records calls and lets the test play the platform, firing the native events in the order iOS
 * and Android do. The jest manual mock (__mocks__/expo-speech-recognition.ts) exports one of
 * these, and ExpoSpeechIn tests pass their own.
 *
 *   const mod = new FakeSpeechRecognitionModule();
 *   const speechIn = new ExpoSpeechIn(mod, { platform: 'ios', clock });
 *   await speechIn.start({ lang: 'es-US', onDevice: true, interim: true, continuous: true });
 *   mod.begin();                         // start + audiostart
 *   mod.partial('Marta lle');
 *   mod.final('Marta llegó', { segments: [...] });
 *   mod.end();                           // audioend + end
 *
 * abort() answers like both platforms: an 'aborted' error and then 'end', after a microtask
 * (abortEnds: 'microtask'), at once ('sync') or never ('never', the test sends them).
 */
import type {
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultSegment,
} from 'expo-speech-recognition';
import type {
  RecognitionEventMap,
  RecognitionEventName,
  RecognitionPermission,
  SpeechRecognitionModuleLike,
} from '../adapters/speechIn/ExpoSpeechIn';

type AnyListener = (event: unknown) => void;

export const GRANTED: RecognitionPermission = { status: 'granted', granted: true, canAskAgain: true };
export const UNDETERMINED: RecognitionPermission = { status: 'undetermined', granted: false, canAskAgain: true };
export const DENIED: RecognitionPermission = { status: 'denied', granted: false, canAskAgain: false };

export interface FakeResultOptions {
  segments?: ExpoSpeechRecognitionResultSegment[];
  confidence?: number;
  alternatives?: string[];
}

export class FakeSpeechRecognitionModule implements SpeechRecognitionModuleLike {
  readonly startCalls: ExpoSpeechRecognitionOptions[] = [];
  stopCalls = 0;
  abortCalls = 0;
  requestCalls = 0;
  supportedLocalesCalls = 0;
  readonly downloadCalls: string[] = [];

  permission: RecognitionPermission = GRANTED;
  /** What requestPermissionsAsync() turns the permission into. */
  requestResult: RecognitionPermission = GRANTED;
  /** getSupportedLocales() result, or an Error to reject with. */
  supportedLocales: { locales: string[]; installedLocales: string[] } | Error = {
    locales: ['en-US', 'es-ES', 'es-MX', 'es-US'],
    installedLocales: ['en-US', 'es-ES', 'es-MX', 'es-US'],
  };
  /** supportsOnDeviceRecognition() without an argument. */
  onDevice = true;
  /** Per-locale answers for supportsOnDeviceRecognition(locale) (the patched iOS module); null:
   * the argument is rejected, as by the unpatched module. */
  onDeviceByLocale: Record<string, boolean> | null = null;
  recognitionAvailable = true;
  downloadResult: { status: string; message: string } | Error = { status: 'download_scheduled', message: '' };
  abortEnds: 'microtask' | 'sync' | 'never' = 'microtask';
  /** start() throws this, once. */
  throwOnStart: Error | null = null;

  private readonly listeners = new Map<string, Set<AnyListener>>();

  // The module API

  start(options: ExpoSpeechRecognitionOptions): void {
    if (this.throwOnStart) {
      const error = this.throwOnStart;
      this.throwOnStart = null;
      throw error;
    }
    this.startCalls.push(options);
  }

  stop(): void {
    this.stopCalls += 1;
  }

  abort(): void {
    this.abortCalls += 1;
    const answer = () => {
      this.emit('error', { error: 'aborted', message: 'Speech recognition aborted.' });
      this.emit('end', null);
    };
    if (this.abortEnds === 'sync') answer();
    else if (this.abortEnds === 'microtask') queueMicrotask(answer);
  }

  async getPermissionsAsync(): Promise<RecognitionPermission> {
    return this.permission;
  }

  async requestPermissionsAsync(): Promise<RecognitionPermission> {
    this.requestCalls += 1;
    if (this.permission.status === 'undetermined') this.permission = this.requestResult;
    return this.permission;
  }

  async getSupportedLocales(): Promise<{ locales: string[]; installedLocales: string[] }> {
    this.supportedLocalesCalls += 1;
    if (this.supportedLocales instanceof Error) throw this.supportedLocales;
    return this.supportedLocales;
  }

  supportsOnDeviceRecognition(...args: [] | [string]): boolean {
    if (args.length === 0) return this.onDevice;
    if (!this.onDeviceByLocale) throw new Error('Received 1 arguments, but 0 was expected');
    return this.onDeviceByLocale[args[0]] ?? false;
  }

  isRecognitionAvailable(): boolean {
    return this.recognitionAvailable;
  }

  async androidTriggerOfflineModelDownload(options: { locale: string }): Promise<{ status: string; message: string }> {
    this.downloadCalls.push(options.locale);
    if (this.downloadResult instanceof Error) throw this.downloadResult;
    return this.downloadResult;
  }

  addListener<E extends RecognitionEventName>(
    eventName: E,
    listener: (event: RecognitionEventMap[E]) => void,
  ): { remove(): void } {
    const set = this.listeners.get(eventName) ?? new Set<AnyListener>();
    const entry: AnyListener = (event) => listener(event as RecognitionEventMap[E]);
    set.add(entry);
    this.listeners.set(eventName, set);
    return { remove: () => set.delete(entry) };
  }

  // Playing the platform

  /** Fires a native event to every listener. */
  emit<E extends RecognitionEventName>(eventName: E, event: RecognitionEventMap[E]): void {
    for (const listener of [...(this.listeners.get(eventName) ?? [])]) listener(event);
  }

  listenerCount(eventName: RecognitionEventName): number {
    return this.listeners.get(eventName)?.size ?? 0;
  }

  /** Options of the latest start(). */
  get lastStart(): ExpoSpeechRecognitionOptions {
    const options = this.startCalls[this.startCalls.length - 1];
    if (!options) throw new Error('FakeSpeechRecognitionModule: start() was not called');
    return options;
  }

  /** The recognizer is listening: 'start', then 'audiostart' at `timestamp` (epoch ms), as on iOS. */
  begin(timestamp = 1_000_000): void {
    this.emit('start', null);
    this.emit('audiostart', { uri: null, timestamp });
  }

  partial(transcript: string, opts: FakeResultOptions = {}): void {
    this.result(false, transcript, opts);
  }

  final(transcript: string, opts: FakeResultOptions = {}): void {
    this.result(true, transcript, opts);
  }

  /** A result event with the best transcript first, then the alternatives. */
  result(isFinal: boolean, transcript: string, opts: FakeResultOptions = {}): void {
    this.emit('result', {
      isFinal,
      results: [
        { transcript, confidence: opts.confidence ?? (isFinal ? 0.9 : 0), segments: opts.segments ?? [] },
        ...(opts.alternatives ?? []).map((alt) => ({ transcript: alt, confidence: 0, segments: [] })),
      ],
    });
  }

  /** A volumechange event (module scale, -2 to 10). */
  volume(value: number): void {
    this.emit('volumechange', { value });
  }

  noMatch(): void {
    this.emit('nomatch', null);
  }

  /** An error event (no end; call end() after it, as the platforms do). */
  fail(error: string, message = '', code?: number): void {
    this.emit('error', code === undefined ? { error: error as never, message } : { error: error as never, message, code });
  }

  /** 'audioend' at `audioEndTimestamp` (when given), then 'end'. */
  end(audioEndTimestamp?: number): void {
    if (audioEndTimestamp !== undefined) this.emit('audioend', { uri: null, timestamp: audioEndTimestamp });
    this.emit('end', null);
  }
}
