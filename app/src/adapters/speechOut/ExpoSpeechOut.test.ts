/**
 * ExpoSpeechOut against a scripted stand-in for expo-speech: the stand-in keeps the options of
 * each speak() so the test can fire the platform callbacks (onStart, onBoundary, onDone, ...).
 */
import type { SpeechOptions, Voice as ExpoVoice } from 'expo-speech';
import { VoiceQuality } from 'expo-speech';
import { FakeClock } from '../clock/FakeClock';
import { ExpoSpeechOut, type ExpoSpeechModule } from './ExpoSpeechOut';
import { SpeechOutError, type WordBoundary } from './types';
import { VOICE_LIST_TIMEOUT_MS } from './voices';

class ScriptedSpeech implements ExpoSpeechModule {
  readonly spoken: { text: string; options: SpeechOptions }[] = [];
  stops = 0;
  voices: ExpoVoice[] = [];
  throwOnSpeak: Error | null = null;

  speak(text: string, options: SpeechOptions = {}): void {
    if (this.throwOnSpeak) throw this.throwOnSpeak;
    this.spoken.push({ text, options });
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  async getAvailableVoicesAsync(): Promise<ExpoVoice[]> {
    return this.voices;
  }

  get last(): SpeechOptions {
    const entry = this.spoken[this.spoken.length - 1];
    if (!entry) throw new Error('nothing spoken');
    return entry.options;
  }

  boundary(charIndex: number): void {
    (this.last.onBoundary as ((ev: { charIndex: number; charLength: number }) => void) | null | undefined)?.({
      charIndex,
      charLength: 1,
    });
  }
}

describe('ExpoSpeechOut', () => {
  it('passes language, rate, pitch and voice to expo-speech and resolves on done', async () => {
    const module = new ScriptedSpeech();
    const speech = new ExpoSpeechOut(module);
    const done = speech.speak('Hola', { lang: 'es-ES', rate: 0.75, pitch: 1.1, voice: 'v1' });
    expect(speech.isSpeaking).toBe(true);
    expect(module.spoken[0]?.text).toBe('Hola');
    expect(module.last).toMatchObject({ language: 'es-ES', rate: 0.75, pitch: 1.1, voice: 'v1' });
    module.last.onDone?.();
    await expect(done).resolves.toEqual({ completed: true });
    expect(speech.isSpeaking).toBe(false);
  });

  it('maps character boundaries to words once each, timed from onStart', async () => {
    const module = new ScriptedSpeech();
    const clock = new FakeClock();
    const speech = new ExpoSpeechOut(module, clock);
    const seen: WordBoundary[] = [];
    const done = speech.speak('Marta llegó tarde', { onWordBoundary: (b) => seen.push(b) });

    clock.advance(100);
    module.last.onStart?.();
    module.boundary(0);
    clock.advance(400);
    module.boundary(5); // the space before "llegó"
    module.boundary(6); // the same word again: ignored
    clock.advance(300);
    module.boundary(12);
    module.last.onDone?.();
    await done;

    expect(seen.map((b) => [b.index, b.text, b.elapsedMs])).toEqual([
      [0, 'Marta', 0],
      [1, 'llegó', 400],
      [2, 'tarde', 700],
    ]);
  });

  it('stop() resolves the utterance as not completed and ignores late platform callbacks', async () => {
    const module = new ScriptedSpeech();
    const speech = new ExpoSpeechOut(module);
    const pending = speech.speak('una frase larga');
    const options = module.last;
    await speech.stop();
    await expect(pending).resolves.toEqual({ completed: false });
    expect(module.stops).toBe(1);
    // Web reports a cancel as an error; it must not reject the stopped utterance or touch the next one.
    options.onError?.(new Error('interrupted'));
    options.onDone?.();
    expect(speech.isSpeaking).toBe(false);
  });

  it('a new speak() stops the current one first', async () => {
    const module = new ScriptedSpeech();
    const speech = new ExpoSpeechOut(module);
    const first = speech.speak('uno');
    const firstOptions = module.last;
    const second = speech.speak('dos');
    await expect(first).resolves.toEqual({ completed: false });
    await Promise.resolve();
    expect(module.spoken.map((s) => s.text)).toEqual(['uno', 'dos']);
    firstOptions.onDone?.();
    expect(speech.isSpeaking).toBe(true);
    module.last.onStopped?.();
    await expect(second).resolves.toEqual({ completed: false });
  });

  it('rejects with SpeechOutError when the voice fails or is missing', async () => {
    const module = new ScriptedSpeech();
    const speech = new ExpoSpeechOut(module);
    const failing = speech.speak('hola');
    module.last.onError?.(new Error('engine down'));
    await expect(failing).rejects.toMatchObject({ name: 'SpeechOutError', code: 'failed', message: 'engine down' });

    module.throwOnSpeak = new Error('no speechSynthesis');
    const missing = speech.speak('hola');
    await expect(missing).rejects.toBeInstanceOf(SpeechOutError);
    await expect(missing).rejects.toMatchObject({ code: 'unavailable' });
    expect(speech.isSpeaking).toBe(false);
  });

  it('lists voices for a language, enhanced first, and survives a failing voice list', async () => {
    const module = new ScriptedSpeech();
    module.voices = [
      { identifier: 'es-mx-1', name: 'Paulina', language: 'es-MX', quality: VoiceQuality.Default },
      { identifier: 'es-es-1', name: 'Mónica', language: 'es-ES', quality: VoiceQuality.Enhanced },
      { identifier: 'en-1', name: 'Samantha', language: 'en-US', quality: VoiceQuality.Default },
    ];
    const speech = new ExpoSpeechOut(module);
    expect(await speech.voices('es')).toEqual([
      { id: 'es-es-1', name: 'Mónica', lang: 'es-ES', quality: 'enhanced' },
      { id: 'es-mx-1', name: 'Paulina', lang: 'es-MX', quality: 'default' },
    ]);

    module.getAvailableVoicesAsync = () => Promise.reject(new Error('unavailable'));
    expect(await speech.voices()).toEqual([]);
  });

  describe('a platform that never reports its voices', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('answers with no voices after VOICE_LIST_TIMEOUT_MS instead of hanging, and clears its timer', async () => {
      const module = new ScriptedSpeech();
      module.getAvailableVoicesAsync = () => new Promise<ExpoVoice[]>(() => undefined);
      const speech = new ExpoSpeechOut(module);
      let settled: unknown = 'pending';
      void speech.voices('es').then((v) => (settled = v));
      await jest.advanceTimersByTimeAsync(VOICE_LIST_TIMEOUT_MS - 1);
      expect(settled).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      expect(settled).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('takes a list that comes in time, and leaves no timer behind', async () => {
      const module = new ScriptedSpeech();
      const voice: ExpoVoice = { identifier: 'es-mx-1', name: 'Paulina', language: 'es-MX', quality: VoiceQuality.Default };
      module.getAvailableVoicesAsync = () => new Promise<ExpoVoice[]>((resolve) => setTimeout(() => resolve([voice]), 200));
      const speech = new ExpoSpeechOut(module, undefined, 500);
      const pending = speech.voices();
      await jest.advanceTimersByTimeAsync(200);
      await expect(pending).resolves.toEqual([{ id: 'es-mx-1', name: 'Paulina', lang: 'es-MX', quality: 'default' }]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('uses expo-speech itself by default (mocked natively in Jest)', async () => {
    const speech = new ExpoSpeechOut();
    await expect(speech.stop()).resolves.toBeUndefined();
    expect(Array.isArray(await speech.voices())).toBe(true);
  });
});
