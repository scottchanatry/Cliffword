/**
 * Shared plumbing for SpeechIn implementations: the listener sets, isListening, the session end
 * and "Type instead". Subclasses implement permission and the recognizer session.
 */
import { Listeners, type Unsubscribe } from '../listeners';
import type {
  FinalTranscript,
  ListenOptions,
  SpeechIn,
  SpeechInCapabilities,
  SpeechInError,
  SpeechInKind,
  SpeechPermission,
} from './types';

export abstract class SpeechInBase implements SpeechIn {
  abstract readonly kind: SpeechInKind;
  abstract readonly capabilities: SpeechInCapabilities;

  protected listening = false;
  protected readonly partials = new Listeners<string>();
  protected readonly finals = new Listeners<FinalTranscript>();
  protected readonly levels = new Listeners<number>();
  protected readonly errors = new Listeners<SpeechInError>();
  protected readonly ends = new Listeners<void>();

  get isListening(): boolean {
    return this.listening;
  }

  abstract permissionStatus(): Promise<SpeechPermission>;
  abstract requestPermission(): Promise<SpeechPermission>;
  abstract start(opts: ListenOptions): Promise<void>;
  abstract stop(): Promise<void>;
  abstract abort(): void;

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

  onError(listener: (error: SpeechInError) => void): Unsubscribe {
    return this.errors.add(listener);
  }

  onEnd(listener: () => void): Unsubscribe {
    return this.ends.add(listener);
  }

  /** Reports a start() that could not begin: onError then onEnd. */
  protected failStart(error: SpeechInError): void {
    this.errors.emit(error);
    this.ends.emit();
  }

  /** Ends the running session (no-op when none): isListening false, then onEnd. */
  protected endSession(): void {
    if (!this.listening) return;
    this.listening = false;
    this.ends.emit();
  }
}
