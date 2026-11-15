/**
 * SpeechIn over the browser's SpeechRecognition (Chrome, Edge, Safari). Web is a preview of
 * the app: the browser may send audio to a server, so capabilities.onDevice is false and
 * ListenOptions.onDevice is not enforced. No levels or word timings.
 *
 * One recognizer object per session. Its result list holds every result of the session, so
 * each event rebuilds the transcript from it; the final transcript (all final results joined)
 * is emitted once, when the recognizer ends. Events from an aborted session are ignored.
 */
import type { Clock } from '../clock/types';
import { systemClock } from '../clock/systemClock';
import { SpeechInBase } from './SpeechInBase';
import type {
  BrowserRecognition,
  BrowserRecognitionConstructor,
  BrowserRecognitionEvent,
  BrowserSpeechEnv,
} from './browserTypes';
import type { ListenOptions, SpeechInCapabilities, SpeechInError, SpeechPermission } from './types';

interface Session {
  rec: BrowserRecognition;
  interim: boolean;
  finals: string[];
  confidences: number[];
  startedAt: number;
  failed: boolean;
}

/** Joins result segments as the recognizer wrote them (it puts spaces where the language has them). */
export function joinSegments(parts: readonly string[]): string {
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Maps a SpeechRecognition error name to SpeechInError. */
export function mapBrowserError(error: string, message?: string): SpeechInError {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { code: 'not-allowed', message };
    case 'no-speech':
    case 'audio-capture':
    case 'network':
    case 'language-not-supported':
      return { code: error, message };
    case 'aborted':
      return { code: 'interrupted', message };
    default:
      return { code: 'unknown', message: message || error };
  }
}

export class BrowserSpeechIn extends SpeechInBase {
  readonly kind = 'browser' as const;
  readonly capabilities: SpeechInCapabilities = {
    speech: true,
    onDevice: false,
    partials: true,
    levels: false,
    wordTimings: false,
  };

  private session: Session | null = null;

  constructor(
    private readonly Recognition: BrowserRecognitionConstructor,
    private readonly env: BrowserSpeechEnv = globalThis as unknown as BrowserSpeechEnv,
    private readonly clock: Clock = systemClock,
  ) {
    super();
  }

  async permissionStatus(): Promise<SpeechPermission> {
    const permissions = this.env.navigator?.permissions;
    if (!permissions) return 'undetermined';
    try {
      const { state } = await permissions.query({ name: 'microphone' });
      if (state === 'granted') return 'granted';
      if (state === 'denied') return 'denied';
      return 'undetermined';
    } catch {
      return 'undetermined';
    }
  }

  async requestPermission(): Promise<SpeechPermission> {
    const media = this.env.navigator?.mediaDevices;
    if (!media) return this.permissionStatus();
    try {
      const stream = await media.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return 'granted';
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'undetermined';
    }
  }

  async start(opts: ListenOptions): Promise<void> {
    if (this.listening) {
      this.errors.emit({ code: 'busy' });
      return;
    }
    let rec: BrowserRecognition;
    try {
      rec = new this.Recognition();
    } catch (error) {
      this.failStart({ code: 'unavailable', message: String(error) });
      return;
    }
    rec.lang = opts.lang;
    rec.interimResults = opts.interim;
    rec.continuous = opts.continuous ?? false;
    rec.maxAlternatives = 1;

    const session: Session = {
      rec,
      interim: opts.interim,
      finals: [],
      confidences: [],
      startedAt: this.clock.now(),
      failed: false,
    };
    const own = (fn: () => void) => () => {
      if (this.session === session) fn();
    };
    rec.onstart = own(() => {
      session.startedAt = this.clock.now();
    });
    rec.onresult = (event) => {
      if (this.session === session) this.handleResult(session, event);
    };
    rec.onerror = (event) => {
      if (this.session !== session) return;
      session.failed = true;
      this.errors.emit(mapBrowserError(event.error, event.message));
    };
    rec.onend = own(() => this.handleEnd(session));

    this.session = session;
    this.listening = true;
    try {
      rec.start();
    } catch (error) {
      this.session = null;
      this.listening = false;
      this.failStart({ code: 'unknown', message: String(error) });
    }
  }

  async stop(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      session.rec.stop();
    } catch {
      this.handleEnd(session);
    }
  }

  abort(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    try {
      session.rec.abort();
    } catch {
      // Already stopped.
    }
    this.endSession();
  }

  private handleResult(session: Session, event: BrowserRecognitionEvent): void {
    const finals: string[] = [];
    const confidences: number[] = [];
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const best = result?.[0];
      if (!result || !best) continue;
      if (result.isFinal) {
        finals.push(best.transcript);
        if (best.confidence > 0) confidences.push(best.confidence);
      } else {
        interim += best.transcript;
      }
    }
    session.finals = finals;
    session.confidences = confidences;
    if (!session.interim) return;
    const partial = joinSegments([...finals, interim]);
    if (partial) this.partials.emit(partial);
  }

  private handleEnd(session: Session): void {
    if (this.session !== session) return;
    this.session = null;
    const text = joinSegments(session.finals);
    if (!session.failed && text) {
      const c = session.confidences;
      this.finals.emit({
        text,
        durationMs: Math.max(0, this.clock.now() - session.startedAt),
        source: 'speech',
        confidence: c.length ? c.reduce((a, b) => a + b, 0) / c.length : undefined,
      });
    }
    this.endSession();
  }
}
