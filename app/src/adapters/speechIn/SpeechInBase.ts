/**
 * Shared plumbing for SpeechIn implementations: the listener sets, isListening, the session end,
 * the level meter and "Type instead". Subclasses implement permission and the recognizer session,
 * and report levels through emitLevel() so onLevel and onMeter stay in step.
 */
import { Listeners, type Unsubscribe } from '../listeners';
import { LevelMeter } from './levels';
import type {
  AvailabilityQuery,
  FinalTranscript,
  LanguageDownload,
  ListenOptions,
  SpeechAvailability,
  SpeechIn,
  SpeechInCapabilities,
  SpeechInError,
  SpeechInKind,
  SpeechPermission,
} from './types';

/** The status for a permission, when nothing else stands in the way. */
export function statusForPermission(permission: SpeechPermission, canAskAgain = true): SpeechAvailability['status'] {
  switch (permission) {
    case 'granted':
      return 'ready';
    case 'undetermined':
      return 'needs-permission';
    case 'denied':
      return canAskAgain ? 'needs-permission' : 'permission-denied';
    case 'unsupported':
      return 'unavailable';
  }
}

export abstract class SpeechInBase implements SpeechIn {
  abstract readonly kind: SpeechInKind;
  abstract readonly capabilities: SpeechInCapabilities;

  protected listening = false;
  protected readonly partials = new Listeners<string>();
  protected readonly finals = new Listeners<FinalTranscript>();
  protected readonly levels = new Listeners<number>();
  protected readonly meters = new Listeners<number>();
  protected readonly errors = new Listeners<SpeechInError>();
  protected readonly ends = new Listeners<void>();
  private readonly meter = new LevelMeter();

  get isListening(): boolean {
    return this.listening;
  }

  abstract permissionStatus(): Promise<SpeechPermission>;
  abstract requestPermission(): Promise<SpeechPermission>;
  abstract start(opts: ListenOptions): Promise<void>;
  abstract stop(): Promise<void>;
  abstract abort(): void;

  /**
   * Default: no recognizer means 'unavailable'; otherwise the permission decides. Recognizers
   * that know their languages (ExpoSpeechIn) override this.
   */
  async availability(query: AvailabilityQuery): Promise<SpeechAvailability> {
    let permission: SpeechPermission;
    try {
      permission = this.capabilities.speech ? await this.permissionStatus() : 'unsupported';
    } catch {
      permission = 'undetermined';
    }
    const status = this.capabilities.speech ? statusForPermission(permission) : 'unavailable';
    return {
      status,
      permission,
      locale: this.capabilities.speech ? query.lang : null,
      onDevice: this.capabilities.onDevice,
      canDownload: false,
    };
  }

  async downloadLanguage(_lang: string): Promise<LanguageDownload> {
    return 'unsupported';
  }

  submitTyped(text: string): void {
    if (this.listening) this.abort();
    const trimmed = text.trim();
    if (!trimmed) return;
    this.finals.emit({ text: trimmed, durationMs: 0, source: 'typed' });
  }

  onPartial(listener: (text: string) => void): Unsubscribe {
    return this.partials.add(listener);
  }

  onFinal(listener: (transcript: FinalTranscript) => void): Unsubscribe {
    return this.finals.add(listener);
  }

  onLevel(listener: (db: number) => void): Unsubscribe {
    return this.levels.add(listener);
  }

  onMeter(listener: (level: number) => void): Unsubscribe {
    return this.meters.add(listener);
  }

  onError(listener: (error: SpeechInError) => void): Unsubscribe {
    return this.errors.add(listener);
  }

  onEnd(listener: () => void): Unsubscribe {
    return this.ends.add(listener);
  }

  /** Reports an input level (dBFS): onLevel with the raw value, then onMeter with the smoothed 0..1. */
  protected emitLevel(db: number): void {
    try {
      this.levels.emit(db);
    } finally {
      this.meters.emit(this.meter.push(db));
    }
  }

  /** Reports a start() that could not begin: onError then onEnd. */
  protected failStart(error: SpeechInError): void {
    this.errors.emit(error);
    this.ends.emit();
  }

  /** Ends the running session (no-op when none): isListening false, the meter back to 0, then onEnd. */
  protected endSession(): void {
    if (!this.listening) return;
    this.listening = false;
    try {
      this.resetMeter();
    } finally {
      this.ends.emit();
    }
  }

  private resetMeter(): void {
    if (this.meter.current === 0) return;
    this.meter.reset();
    this.meters.emit(0);
  }
}
