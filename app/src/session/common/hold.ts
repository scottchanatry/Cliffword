/**
 * Hold to speak, shared by the session controllers: one gesture from touch-down to the
 * session's answer, over the SpeechIn contract (src/adapters/speechIn/types.ts).
 *
 * - begin() (touch-down) checks the permission, asking once when undecided ("warming").
 * - start() (the hold passed the long-press threshold) runs `beforeListen` (stop speech, pause
 *   the music: never record while the track plays), then listens with `listenOptions()`,
 *   publishing level and partial.
 * - end() (release) stops the recognizer; the final transcript goes to `onFinal`, and the hold
 *   stays 'finishing' until that resolves (the session's answer is in).
 * - cancel() (scroll, interruption, a command chip) drops the utterance unless the final already
 *   arrived.
 * - Errors publish { phase: 'error', messageKey: speechInErrorKey(code) }; a recognizer that ends
 *   with nothing is 'no-speech'.
 *
 * Used by both session controllers (src/session/story, src/session/lyric) and onboarding's
 * hold practice.
 */
import type { Haptics } from '../../adapters/haptics/types';
import type { Unsubscribe } from '../../adapters/listeners';
import { speechInErrorKey } from '../../adapters/speechIn/messages';
import type { FinalTranscript, ListenOptions, SpeechIn, SpeechInErrorCode } from '../../adapters/speechIn/types';
import type { ListenState } from '../contract';

export const LISTEN_IDLE: ListenState = { phase: 'idle' };

export interface HoldToSpeakDeps {
  speechIn: SpeechIn;
  haptics: Haptics;
  /** The listen state changed: publish it (vm.listen). */
  publish: (state: ListenState) => void;
  /** The current listen state as published (partials and levels patch it). */
  current: () => ListenState;
  /** A final transcript: send it to the session. The hold ends (listen idle) when this settles. */
  onFinal: (transcript: FinalTranscript) => Promise<void>;
  /** Right before the recognizer starts: stop speech, pause the music. Awaited. */
  beforeListen?: () => Promise<void> | void;
  /** Locale, hints and the rest of the listen options, read when listening starts. */
  listenOptions: () => ListenOptions;
  /** A hold may begin now (there is a screen to answer). Default: always. */
  canHold?: () => boolean;
  onError?: (error: unknown) => void;
}

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

export class HoldToSpeak {
  private hold: Hold | null = null;
  private disposed = false;

  constructor(private readonly deps: HoldToSpeakDeps) {}

  /** A hold is warming or listening (not yet finishing): do not talk over the learner. */
  get holding(): boolean {
    return this.hold !== null && this.hold.phase !== 'finishing';
  }

  /** Any hold is in progress, finishing included. */
  get active(): boolean {
    return this.hold !== null;
  }

  begin(): void {
    if (this.disposed || this.hold) return;
    if (this.deps.canHold && !this.deps.canHold()) return;
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
    this.deps.publish({ phase: 'warming' });
  }

  start(): void {
    if (!this.hold) this.begin();
    const hold = this.hold;
    if (!hold || hold.phase !== 'warming' || hold.starting) return;
    hold.starting = true;
    void this.listen(hold);
  }

  end(): void {
    const hold = this.hold;
    if (!hold) return;
    if (hold.phase === 'warming' && !hold.starting) {
      this.finish(hold, LISTEN_IDLE);
      return;
    }
    hold.released = true;
    if (hold.phase === 'listening') void this.release(hold);
  }

  /** Drop the current hold (and its utterance, unless the final already arrived). */
  cancel(): void {
    const hold = this.hold;
    if (!hold || hold.gotFinal) return;
    hold.cancelled = true;
    if ((hold.phase !== 'warming' || hold.starting) && this.deps.speechIn.isListening) this.deps.speechIn.abort();
    this.finish(hold, LISTEN_IDLE);
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
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

  private async listen(hold: Hold): Promise<void> {
    const { speechIn, haptics } = this.deps;
    const error = await hold.warm;
    if (this.hold !== hold || hold.cancelled || this.disposed) return;
    if (error) {
      this.fail(hold, error);
      return;
    }
    if (hold.released) {
      // Let go before listening began: a tap, not a hold.
      this.finish(hold, LISTEN_IDLE);
      return;
    }
    try {
      await this.deps.beforeListen?.();
    } catch (e) {
      this.deps.onError?.(e);
    }
    if (this.hold !== hold || hold.cancelled || this.disposed) return;
    haptics.play('tap');
    const listening = () => this.hold === hold && hold.phase === 'listening' && this.deps.current().phase === 'listening';
    hold.unsubs.push(
      speechIn.onPartial((text) => {
        const now = this.deps.current();
        if (listening() && now.phase === 'listening') this.deps.publish({ ...now, partial: text });
      }),
      speechIn.onMeter((level) => {
        const now = this.deps.current();
        if (listening() && now.phase === 'listening') this.deps.publish({ ...now, level });
      }),
      speechIn.onFinal((transcript) => {
        if (this.hold !== hold || hold.gotFinal || hold.cancelled) return;
        hold.gotFinal = true;
        if (hold.phase === 'listening') haptics.play('selection');
        hold.phase = 'finishing';
        this.deps.publish({ phase: 'finishing' });
        void this.deps
          .onFinal(transcript)
          .catch((e: unknown) => this.deps.onError?.(e))
          .finally(() => {
            if (this.hold === hold) this.finish(hold, LISTEN_IDLE);
          });
      }),
      speechIn.onError((e) => {
        if (this.hold !== hold || hold.cancelled) return;
        hold.gotError = true;
        this.fail(hold, e.code);
      }),
      speechIn.onEnd(() => {
        for (const unsub of hold.unsubs.splice(0)) unsub();
        if (this.hold !== hold || hold.gotFinal || hold.gotError || hold.cancelled) return;
        // Ended with nothing recognized.
        this.fail(hold, 'no-speech');
      }),
    );
    hold.phase = 'listening';
    this.deps.publish({ phase: 'listening', level: 0, partial: '' });
    await speechIn.start(this.deps.listenOptions());
    if (this.hold === hold && hold.released && hold.phase === 'listening' && speechIn.isListening) await this.release(hold);
  }

  private async release(hold: Hold): Promise<void> {
    hold.phase = 'finishing';
    this.deps.haptics.play('selection');
    this.deps.publish({ phase: 'finishing' });
    try {
      await this.deps.speechIn.stop();
    } catch (e) {
      this.deps.onError?.(e);
      this.fail(hold, 'unknown');
    }
  }

  private fail(hold: Hold, code: SpeechInErrorCode): void {
    if (this.hold !== hold) return;
    this.deps.haptics.play('error');
    this.finish(hold, { phase: 'error', messageKey: speechInErrorKey(code) });
  }

  private finish(hold: Hold, listen: ListenState): void {
    if (this.hold === hold) this.hold = null;
    if (!this.deps.speechIn.isListening) for (const unsub of hold.unsubs.splice(0)) unsub();
    this.deps.publish(listen);
  }
}
