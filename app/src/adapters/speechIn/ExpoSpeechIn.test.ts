/**
 * ExpoSpeechIn against FakeSpeechRecognitionModule (the native module's stand-in): the test plays
 * iOS or Android, firing start / audiostart / result / volumechange / nomatch / error / end.
 * Timers are manual, so watchdogs and waits run only when the test advances them.
 */
import type { ExpoSpeechRecognitionResultSegment } from 'expo-speech-recognition';
import { FakeClock } from '../clock/FakeClock';
import { recordEvents } from '../../testing/recordSpeechInEvents';
import { DENIED, FakeSpeechRecognitionModule, UNDETERMINED } from '../../testing/FakeSpeechRecognitionModule';
import { retellMetrics } from '../../../../engine/src/speaking/retell';
import {
  ERROR_END_TIMEOUT_MS,
  ExpoSpeechIn,
  IOS_RECOGNITION_AUDIO_SESSION,
  PREVIOUS_RUN_TIMEOUT_MS,
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  contextualStringsFor,
  joinTranscripts,
  mapNativeError,
  wordSeparatorFor,
  type ExpoSpeechInOptions,
  type NativeErrorContext,
  type Timers,
} from './ExpoSpeechIn';
import type { FinalTranscript, ListenOptions } from './types';

const HOLD: ListenOptions = { lang: 'es-US', onDevice: true, interim: true, continuous: true };

class ManualTimers implements Timers {
  private now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  }

  get size(): number {
    return this.pending.size;
  }
}

/** Lets queued promise callbacks and microtasks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function setup(opts: Partial<ExpoSpeechInOptions> = {}, mod = new FakeSpeechRecognitionModule()) {
  const clock = new FakeClock();
  const timers = new ManualTimers();
  const speechIn = new ExpoSpeechIn(mod, { platform: 'ios', clock, timers, ...opts });
  const rec = recordEvents(speechIn);
  const final = (): FinalTranscript => {
    const event = rec.events.find((e) => e.type === 'final');
    if (!event || event.type !== 'final') throw new Error(`no final in ${rec.types().join(', ')}`);
    return event.transcript;
  };
  return { clock, timers, mod, speechIn, rec, final };
}

const seg = (segment: string, startTimeMillis: number, endTimeMillis: number, confidence = 0.9): ExpoSpeechRecognitionResultSegment => ({
  segment,
  startTimeMillis,
  endTimeMillis,
  confidence,
});

describe('ExpoSpeechIn: a hold to speak on iOS', () => {
  it('starts on-device with the hold options and maps partials, one final and one end', async () => {
    const { clock, mod, speechIn, rec, final } = setup();
    await speechIn.start({ ...HOLD, hints: ['mercado', ' Mercado ', 'otra vez', '', 'no  sé'] });
    expect(speechIn.isListening).toBe(true);
    expect(mod.startCalls).toHaveLength(1);
    expect(mod.lastStart).toEqual({
      lang: 'es-US',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
      maxAlternatives: 3,
      contextualStrings: ['mercado', 'otra vez', 'no sé'],
      volumeChangeEventOptions: { enabled: true, intervalMillis: 50 },
      iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'], mode: 'default' },
      iosTaskHint: 'dictation',
      iosVoiceProcessingEnabled: false,
    });
    expect(mod.lastStart.iosCategory).toBe(IOS_RECOGNITION_AUDIO_SESSION);

    clock.advance(100);
    mod.begin(1_000_000);
    mod.partial('Marta');
    mod.partial('Marta llegó');
    mod.partial('Marta llegó');
    clock.advance(1500);
    await speechIn.stop();
    expect(mod.stopCalls).toBe(1);
    expect(speechIn.isListening).toBe(true);
    mod.final('Marta llegó tarde', {
      segments: [seg('Marta', 200, 450), seg('llegó', 500, 800), seg('tarde', 900, 1200)],
      confidence: 0.8,
    });
    mod.end(1_001_500);

    expect(rec.types()).toEqual(['partial', 'partial', 'partial', 'final', 'end']);
    expect(rec.events.slice(0, 3)).toEqual([
      { type: 'partial', text: 'Marta' },
      { type: 'partial', text: 'Marta llegó' },
      { type: 'partial', text: 'Marta llegó tarde' },
    ]);
    // Segment times are ms from the audio start, which came 100 ms after start().
    expect(final()).toEqual({
      text: 'Marta llegó tarde',
      words: [
        { text: 'Marta', startMs: 300, endMs: 550, confidence: 0.9 },
        { text: 'llegó', startMs: 600, endMs: 900, confidence: 0.9 },
        { text: 'tarde', startMs: 1000, endMs: 1300, confidence: 0.9 },
      ],
      wordTiming: 'measured',
      durationMs: 1600,
      spokenMs: 1000,
      source: 'speech',
      confidence: 0.8,
      locale: 'es-US',
      onDevice: true,
    });
    expect(speechIn.isListening).toBe(false);
  });

  it('emits no partials when interim is off, and keeps alternatives that differ', async () => {
    const { mod, speechIn, rec, final } = setup();
    await speechIn.start({ ...HOLD, interim: false });
    mod.begin();
    mod.partial('otra');
    await speechIn.stop();
    mod.final('otra vez', { alternatives: ['otra ves', 'otra vez', 'hora vez'] });
    mod.end();
    expect(rec.types()).toEqual(['final', 'end']);
    expect(final().alternatives).toEqual(['otra ves', 'hora vez']);
  });

  it('does not repeat the last continuous piece that iOS 18 reports twice', async () => {
    const { mod, speechIn, final } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    mod.final('hola', { segments: [seg('hola', 0, 300)] });
    mod.partial(' qué tal');
    mod.final(' qué tal', { segments: [seg('qué', 900, 1100), seg('tal', 1150, 1400)] });
    await speechIn.stop();
    mod.final(' qué tal', { segments: [seg('qué', 900, 1100), seg('tal', 1150, 1400)] });
    mod.end();
    expect(final().text).toBe('hola qué tal');
    expect(final().words?.map((w) => w.text)).toEqual(['hola', 'qué', 'tal']);
  });
});

describe('ExpoSpeechIn: word timings for the speaking module', () => {
  /** Level samples every 50 ms: [module value, how many samples]. */
  function playLevels(clock: FakeClock, mod: FakeSpeechRecognitionModule, plan: [number, number][]): void {
    for (const [value, count] of plan) {
      for (let i = 0; i < count; i++) {
        clock.advance(50);
        mod.volume(value);
      }
    }
  }

  it('estimates timings without segments (Android) over the voiced runs, so pauses show', async () => {
    const { clock, mod, speechIn, final } = setup({ platform: 'android', androidApiLevel: 33 });
    await speechIn.start(HOLD);
    expect(mod.lastStart.androidIntentOptions).toEqual({ EXTRA_MASK_OFFENSIVE_WORDS: false });
    expect(mod.lastStart.iosCategory).toBeUndefined();
    // Android order: audiostart, then start (onReadyForSpeech).
    mod.emit('audiostart', { uri: null, timestamp: 5000 });
    mod.emit('start', null);
    // 200 ms silence, 600 ms speech, 1 s pause, 400 ms speech, 200 ms silence.
    playLevels(clock, mod, [[-2, 4], [6, 12]]);
    mod.partial('hola qué');
    mod.final('hola qué tal');
    playLevels(clock, mod, [[-1.5, 20], [7, 8]]);
    mod.partial('bien');
    playLevels(clock, mod, [[-2, 4]]);
    await speechIn.stop();
    mod.final('bien');
    mod.end(5000 + 2400);

    const t = final();
    expect(t.text).toBe('hola qué tal bien');
    expect(t.wordTiming).toBe('estimated');
    expect(t.durationMs).toBe(2400);
    const words = t.words ?? [];
    expect(words.map((w) => w.text)).toEqual(['hola', 'qué', 'tal', 'bien']);
    // The first piece fills the first voiced run (200..800 ms) by word length, the second piece
    // the second run (1800..2200 ms).
    expect(words).toEqual([
      { text: 'hola', startMs: 200, endMs: 440 },
      { text: 'qué', startMs: 440, endMs: 620 },
      { text: 'tal', startMs: 620, endMs: 800 },
      { text: 'bien', startMs: 1800, endMs: 2200 },
    ]);
    // Spoken time is the voiced time, not the hold.
    expect(t.spokenMs).toBe(600 + 400);
    // What the engine's retell metrics make of it: one pause, between "tal" and "bien".
    const metrics = retellMetrics(words, { laneMs: 60000 });
    expect(metrics.pauseCount).toBe(1);
    expect(metrics.pauses[0]).toMatchObject({ afterIndex: 2, durationMs: 1000 });
    expect(metrics.spokenMs).toBe(2000);
  });

  it('spreads words over the recording when there are no levels', async () => {
    const { clock, mod, speechIn, final } = setup({ platform: 'android', androidApiLevel: 33 });
    await speechIn.start(HOLD);
    clock.advance(200);
    mod.emit('audiostart', { uri: null, timestamp: 10_000 });
    mod.emit('start', null);
    clock.advance(1000);
    await speechIn.stop();
    mod.final('sí claro');
    mod.end(11_000);
    expect(final().words).toEqual([
      { text: 'sí', startMs: 200, endMs: 486 },
      { text: 'claro', startMs: 486, endMs: 1200 },
    ]);
    expect(final().spokenMs).toBe(1000);
  });

  it('fills ends for start-only segments (Android 14 on-device recognizer)', async () => {
    const { clock, mod, speechIn, final } = setup({ platform: 'android', androidApiLevel: 34 });
    await speechIn.start(HOLD);
    mod.emit('audiostart', { uri: null, timestamp: 0 });
    mod.emit('start', null);
    clock.advance(3000);
    await speechIn.stop();
    mod.final('el mercado cerró', {
      segments: [seg('el', 100, 1399, -1), seg('mercado', 1400, 1599, -1), seg('cerró', 1600, 1600, -1)],
    });
    mod.end(3000);
    expect(final().wordTiming).toBe('starts');
    expect(final().words).toEqual([
      { text: 'el', startMs: 100, endMs: 320 },
      { text: 'mercado', startMs: 1400, endMs: 1600 },
      { text: 'cerró', startMs: 1600, endMs: 2000 },
    ]);
  });

  it('estimates instead when measured timings make no sense', async () => {
    const { clock, mod, speechIn, final } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    clock.advance(1000);
    await speechIn.stop();
    mod.final('hola amigo', { segments: [seg('hola', 1.7e12, 1.7e12 + 300), seg('amigo', 1.7e12 + 400, 1.7e12 + 800)] });
    mod.end();
    expect(final().wordTiming).toBe('estimated');
    expect(final().words?.every((w) => w.endMs <= 1000)).toBe(true);
  });
});

describe('ExpoSpeechIn: errors', () => {
  it('reports an error then end, with no final', async () => {
    const { mod, speechIn, rec } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    mod.fail('audio-capture', 'Failure occurred during speech recognition.');
    mod.final('ignored');
    mod.end();
    expect(rec.events).toEqual([
      { type: 'error', error: { code: 'audio-capture', message: 'audio-capture: Failure occurred during speech recognition.' } },
      { type: 'end' },
    ]);
    expect(speechIn.isListening).toBe(false);
  });

  it('reports no-match after nomatch, and no-speech when nothing came back', async () => {
    const { mod, speechIn, rec } = setup({ platform: 'android', androidApiLevel: 34 });
    await speechIn.start(HOLD);
    mod.begin();
    await speechIn.stop();
    mod.noMatch();
    mod.fail('no-speech', 'No speech was detected.', 7);
    mod.end();
    expect(rec.events[0]).toMatchObject({ type: 'error', error: { code: 'no-match' } });

    await speechIn.start(HOLD);
    mod.begin();
    await speechIn.stop();
    mod.noMatch();
    mod.end();
    await speechIn.start(HOLD);
    mod.begin();
    await speechIn.stop();
    mod.end();
    expect(rec.events.filter((e) => e.type === 'error').map((e) => (e.type === 'error' ? e.error.code : ''))).toEqual([
      'no-match',
      'no-match',
      'no-speech',
    ]);
    expect(rec.types().filter((t) => t === 'end')).toHaveLength(3);
  });

  it('keeps what was heard when an Android client error follows the release', async () => {
    const { mod, speechIn, rec, final } = setup({ platform: 'android', androidApiLevel: 34 });
    await speechIn.start(HOLD);
    mod.begin();
    mod.partial('el mercado');
    await speechIn.stop();
    mod.fail('client', 'Other client side errors.', 5);
    mod.end();
    expect(rec.types()).toEqual(['partial', 'final', 'end']);
    expect(final()).toMatchObject({ text: 'el mercado', wordTiming: 'estimated' });
  });

  it('maps a client error while still holding to interrupted, and a missing language pack to on-device-unavailable', async () => {
    const { mod, speechIn, rec } = setup({ platform: 'android', androidApiLevel: 34 });
    await speechIn.start(HOLD);
    mod.begin();
    mod.fail('client', '', 5);
    mod.end();
    await speechIn.start(HOLD);
    mod.begin();
    mod.fail('language-not-supported', 'Requested language is supported, but not yet downloaded.', 13);
    mod.end();
    expect(rec.events.filter((e) => e.type === 'error').map((e) => (e.type === 'error' ? e.error.code : ''))).toEqual([
      'interrupted',
      'on-device-unavailable',
    ]);
  });

  it('ends the session when an error is not followed by a native end', async () => {
    const { timers, mod, speechIn, rec } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    mod.fail('interrupted', 'The audio session was interrupted.');
    expect(speechIn.isListening).toBe(true);
    timers.advance(ERROR_END_TIMEOUT_MS);
    expect(rec.types()).toEqual(['error', 'end']);
    expect(speechIn.isListening).toBe(false);
    expect(mod.abortCalls).toBe(1);
  });

  it('maps native error codes', () => {
    const ios: NativeErrorContext = { platform: 'ios', onDevice: true, stopRequested: false, noMatch: false };
    const android: NativeErrorContext = { ...ios, platform: 'android' };
    const code = (error: string, ctx: NativeErrorContext = ios, nativeCode?: number) =>
      mapNativeError({ error, code: nativeCode }, ctx).code;
    expect(code('aborted')).toBe('interrupted');
    expect(code('busy')).toBe('interrupted');
    expect(code('interrupted')).toBe('interrupted');
    expect(code('audio-capture')).toBe('audio-capture');
    expect(code('not-allowed')).toBe('not-allowed');
    expect(code('no-speech')).toBe('no-speech');
    expect(code('no-speech', android, 7)).toBe('no-match');
    expect(code('no-speech', { ...ios, noMatch: true })).toBe('no-match');
    expect(code('speech-timeout', android, 6)).toBe('no-speech');
    expect(code('client', android, 5)).toBe('interrupted');
    expect(code('client', { ...android, stopRequested: true }, 5)).toBe('no-speech');
    expect(code('client', { ...android, stopRequested: true, noMatch: true }, 5)).toBe('no-match');
    expect(code('language-not-supported', { ...ios, onDevice: false })).toBe('language-not-supported');
    expect(code('language-not-supported', ios)).toBe('on-device-unavailable');
    expect(code('language-not-supported', { ...android, onDevice: false }, 13)).toBe('on-device-unavailable');
    expect(code('service-not-allowed', android, 9)).toBe('not-allowed');
    expect(code('service-not-allowed', ios)).toBe('on-device-unavailable');
    expect(code('service-not-allowed', { ...ios, onDevice: false })).toBe('unavailable');
    expect(code('network', ios)).toBe('interrupted');
    expect(code('network', { ...ios, onDevice: false })).toBe('network');
    expect(code('too-many-requests', android)).toBe('network');
    expect(code('bad-grammar')).toBe('unknown');
    expect(code('something-new')).toBe('unknown');
    expect(mapNativeError({ error: 'client', message: 'Other client side errors.', code: 5 }, android).message).toBe(
      'client: code 5: Other client side errors.',
    );
  });
});

describe('ExpoSpeechIn: levels', () => {
  it('gives dBFS levels at most every 50 ms and a smoothed 0..1 meter that ends at 0', async () => {
    const { clock, mod, speechIn, rec } = setup();
    const meters: number[] = [];
    speechIn.onMeter((m) => meters.push(m));
    await speechIn.start(HOLD);
    mod.begin();
    mod.volume(10);
    clock.advance(10);
    mod.volume(10);
    clock.advance(40);
    mod.volume(-2);
    clock.advance(50);
    mod.volume(4);
    mod.volume(Number.NaN);
    speechIn.abort();
    expect(rec.events.filter((e) => e.type === 'level').map((e) => (e.type === 'level' ? e.db : NaN))).toEqual([0, -60, -30]);
    expect(meters).toEqual([0.6, 0.42, 0.468, 0]);
    expect(rec.types().slice(-1)).toEqual(['end']);
  });
});

describe('ExpoSpeechIn: permission', () => {
  it('reports not-allowed without starting the recognizer when permission is denied; typing still works', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.permission = DENIED;
    const { speechIn, rec } = setup({}, mod);
    expect(await speechIn.permissionStatus()).toBe('denied');
    await speechIn.start(HOLD);
    expect(mod.startCalls).toHaveLength(0);
    expect(mod.requestCalls).toBe(0);
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'not-allowed', message: 'permission denied' } }, { type: 'end' }]);
    expect(speechIn.isListening).toBe(false);
    expect((await speechIn.availability(HOLD)).status).toBe('permission-denied');
    speechIn.submitTyped(' el mercado ');
    expect(rec.events[2]).toEqual({ type: 'final', transcript: { text: 'el mercado', durationMs: 0, source: 'typed' } });
  });

  it('asks on the first hold when undetermined; a refusal reports not-allowed', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.permission = UNDETERMINED;
    mod.requestResult = DENIED;
    const { speechIn, rec } = setup({}, mod);
    expect((await speechIn.availability(HOLD)).status).toBe('needs-permission');
    await speechIn.start(HOLD);
    expect(mod.requestCalls).toBe(1);
    expect(rec.types()).toEqual(['error', 'end']);
    expect(mod.startCalls).toHaveLength(0);
  });

  it('asks and listens when the learner allows it', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.permission = UNDETERMINED;
    const { speechIn } = setup({}, mod);
    await speechIn.start(HOLD);
    expect(mod.requestCalls).toBe(1);
    expect(mod.startCalls).toHaveLength(1);
    expect(await speechIn.requestPermission()).toBe('granted');
  });

  it('reads iOS restricted (Screen Time) as denied with no asking again, and survives a failing module', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.permission = { status: 'denied', granted: false, canAskAgain: true, restricted: true };
    const { speechIn } = setup({}, mod);
    expect(await speechIn.permissionStatus()).toBe('denied');
    expect((await speechIn.availability(HOLD)).status).toBe('permission-denied');

    mod.getPermissionsAsync = () => Promise.reject(new Error('module gone'));
    mod.requestPermissionsAsync = () => Promise.reject(new Error('module gone'));
    expect(await speechIn.permissionStatus()).toBe('undetermined');
    expect(await speechIn.requestPermission()).toBe('undetermined');
  });
});

describe('ExpoSpeechIn: ending early, aborting and never throwing', () => {
  it('cancels a hold that ends while start() is still preparing: onEnd only, no recognizer', async () => {
    const { mod, speechIn, rec } = setup();
    const starting = speechIn.start(HOLD);
    await speechIn.stop();
    await starting;
    expect(rec.events).toEqual([{ type: 'end' }]);
    expect(mod.startCalls).toHaveLength(0);
    expect(speechIn.isListening).toBe(false);
  });

  it('cancels a hold that ends before the recognizer listens, and ignores its late events', async () => {
    const { mod, speechIn, rec } = setup();
    await speechIn.start(HOLD);
    await speechIn.stop();
    expect(mod.abortCalls).toBe(1);
    expect(mod.stopCalls).toBe(0);
    expect(rec.events).toEqual([{ type: 'end' }]);
    await flush(); // the module answers abort with 'aborted' and 'end'
    mod.begin();
    mod.final('tarde');
    mod.end();
    expect(rec.events).toEqual([{ type: 'end' }]);
  });

  it('abort ends at once; the next start waits for the aborted run to end natively', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.abortEnds = 'never';
    const { mod: m, speechIn, rec } = setup({}, mod);
    await speechIn.start(HOLD);
    m.begin();
    m.partial('hola');
    speechIn.abort();
    expect(rec.types()).toEqual(['partial', 'end']);
    expect(speechIn.isListening).toBe(false);

    const second = speechIn.start(HOLD);
    await flush();
    expect(m.startCalls).toHaveLength(1);
    m.fail('aborted', 'Speech recognition aborted.');
    m.end(); // the first run's end: must not end the second session
    await second;
    expect(m.startCalls).toHaveLength(2);
    expect(speechIn.isListening).toBe(true);
    expect(rec.types()).toEqual(['partial', 'end']);
  });

  it('starts anyway when the aborted run never ends natively', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.abortEnds = 'never';
    const { timers, speechIn } = setup({}, mod);
    await speechIn.start(HOLD);
    mod.begin();
    speechIn.abort();
    const second = speechIn.start(HOLD);
    await flush();
    expect(mod.startCalls).toHaveLength(1);
    timers.advance(PREVIOUS_RUN_TIMEOUT_MS);
    await second;
    expect(mod.startCalls).toHaveLength(2);
  });

  it('reports busy for a second start and keeps the running session', async () => {
    const { mod, speechIn, rec } = setup();
    await speechIn.start(HOLD);
    await speechIn.start({ ...HOLD, lang: 'en-US' });
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'busy' } }]);
    expect(mod.startCalls).toHaveLength(1);
    expect(speechIn.isListening).toBe(true);
  });

  it('never throws: a module whose start throws reports unknown, and the next start works', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.throwOnStart = new Error('invalid options');
    const { speechIn, rec } = setup({}, mod);
    await expect(speechIn.start(HOLD)).resolves.toBeUndefined();
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'unknown', message: 'invalid options' } }, { type: 'end' }]);
    await speechIn.start(HOLD);
    expect(mod.startCalls).toHaveLength(1);
    expect(speechIn.isListening).toBe(true);
  });

  it('never throws: a failing locale list still starts, a recognizer that never starts times out', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.supportedLocales = new Error('error_5');
    const { timers, speechIn, rec } = setup({}, mod);
    await speechIn.start(HOLD);
    expect(mod.lastStart.lang).toBe('es-US');
    timers.advance(START_TIMEOUT_MS);
    expect(rec.events).toEqual([
      { type: 'error', error: { code: 'unknown', message: 'the recognizer did not start' } },
      { type: 'end' },
    ]);
    expect(mod.abortCalls).toBe(1);
  });

  it('finishes with what was heard when the native end never comes after stop', async () => {
    const { timers, mod, speechIn, rec, final } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    mod.partial('siguiente');
    await speechIn.stop();
    timers.advance(STOP_TIMEOUT_MS);
    expect(rec.types()).toEqual(['partial', 'final', 'end']);
    expect(final().text).toBe('siguiente');
    expect(mod.abortCalls).toBe(1);
  });

  it('typing instead aborts a running session first', async () => {
    const { mod, speechIn, rec } = setup();
    await speechIn.start(HOLD);
    mod.begin();
    speechIn.submitTyped('listo');
    expect(mod.abortCalls).toBe(1);
    expect(rec.events).toEqual([{ type: 'end' }, { type: 'final', transcript: { text: 'listo', durationMs: 0, source: 'typed' } }]);
  });
});

describe('ExpoSpeechIn: locale, on-device policy and availability', () => {
  it('is ready on device for a supported locale, using the first supported fallback', async () => {
    const { mod, speechIn } = setup();
    expect(await speechIn.availability(HOLD)).toEqual({
      status: 'ready',
      permission: 'granted',
      locale: 'es-US',
      onDevice: true,
      canDownload: false,
    });
    await speechIn.start({ ...HOLD, lang: 'es-PR', langFallbacks: ['es-US', 'es-ES'] });
    expect(mod.lastStart.lang).toBe('es-US');
    expect(mod.supportedLocalesCalls).toBe(1); // reused within the TTL
  });

  it('iOS (patched module): no on-device support for the locale stops the session unless network is allowed', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.onDeviceByLocale = { 'es-US': false, 'es-ES': true };
    const { speechIn, rec } = setup({}, mod);
    expect((await speechIn.availability(HOLD)).status).toBe('on-device-unavailable');
    await speechIn.start(HOLD);
    expect(mod.startCalls).toHaveLength(0);
    expect(rec.events[0]).toMatchObject({ type: 'error', error: { code: 'on-device-unavailable' } });

    await speechIn.start({ ...HOLD, onDevice: false });
    expect(mod.lastStart.requiresOnDeviceRecognition).toBe(false);
    expect((await speechIn.availability({ ...HOLD, onDevice: false })).onDevice).toBe(false);
    await speechIn.stop();
    await flush();

    await speechIn.start({ ...HOLD, lang: 'es-ES' });
    expect(mod.lastStart).toMatchObject({ lang: 'es-ES', requiresOnDeviceRecognition: true });
  });

  it('Android: a supported language without its pack can be downloaded; until then the session fails', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.supportedLocales = { locales: ['en-US', 'es-ES', 'es-US'], installedLocales: ['en-US'] };
    const { speechIn, rec } = setup({ platform: 'android', androidApiLevel: 34 }, mod);
    expect(await speechIn.availability(HOLD)).toEqual({
      status: 'on-device-unavailable',
      permission: 'granted',
      locale: 'es-US',
      onDevice: false,
      canDownload: true,
    });
    await speechIn.start(HOLD);
    expect(mod.startCalls).toHaveLength(0);
    expect(rec.events[0]).toMatchObject({ type: 'error', error: { code: 'on-device-unavailable' } });

    expect(await speechIn.downloadLanguage('es-US')).toBe('started');
    expect(mod.downloadCalls).toEqual(['es-US']);
    mod.supportedLocales = { locales: ['en-US', 'es-ES', 'es-US'], installedLocales: ['en-US', 'es-US'] };
    expect(await speechIn.downloadLanguage('es-US')).toBe('done');
    expect((await speechIn.availability(HOLD)).status).toBe('ready');

  });

  it('Android: a download that fails reports failed', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.supportedLocales = { locales: ['es-MX'], installedLocales: [] };
    mod.downloadResult = new Error('error_15');
    const { speechIn } = setup({ platform: 'android', androidApiLevel: 33 }, mod);
    expect(await speechIn.downloadLanguage('es-MX')).toBe('failed');
    expect(mod.downloadCalls).toEqual(['es-MX']);
  });

  it('Android before 13 cannot force on-device: unavailable unless network is allowed, and no API 33 extras', async () => {
    const { mod, speechIn, rec } = setup({ platform: 'android', androidApiLevel: 31 });
    expect((await speechIn.availability(HOLD)).status).toBe('on-device-unavailable');
    expect(await speechIn.downloadLanguage('es-US')).toBe('unsupported');
    await speechIn.start(HOLD);
    expect(rec.events[0]).toMatchObject({ type: 'error', error: { code: 'on-device-unavailable' } });
    await speechIn.start({ ...HOLD, onDevice: false });
    expect(mod.lastStart.requiresOnDeviceRecognition).toBe(false);
    expect(mod.lastStart.androidIntentOptions).toBeUndefined();
  });

  it('reports a language the recognizer lacks, and no recognizer at all on Android', async () => {
    const mod = new FakeSpeechRecognitionModule();
    mod.supportedLocales = { locales: ['en-US', 'fr-FR'], installedLocales: ['en-US', 'fr-FR'] };
    const { speechIn } = setup({}, mod);
    expect((await speechIn.availability(HOLD)).status).toBe('language-not-supported');
    expect(await speechIn.downloadLanguage('es-US')).toBe('unsupported');

    const android = new FakeSpeechRecognitionModule();
    android.recognitionAvailable = false;
    const { speechIn: none } = setup({ platform: 'android', androidApiLevel: 34 }, android);
    expect((await none.availability(HOLD)).status).toBe('unavailable');
  });
});

describe('ExpoSpeechIn helpers', () => {
  it('joins pieces with the language separator and cleans hints', () => {
    expect(joinTranscripts(['hola', ' qué  tal ', ''])).toBe('hola qué tal');
    expect(wordSeparatorFor('es-US')).toBe(' ');
    expect(wordSeparatorFor('ja-JP')).toBe('');
    expect(joinTranscripts(['東京に', '行く'], wordSeparatorFor('ja-JP'))).toBe('東京に行く');
    expect(contextualStringsFor(undefined)).toEqual([]);
    expect(contextualStringsFor(Array.from({ length: 150 }, (_, i) => `w${i}`))).toHaveLength(100);
  });
});
