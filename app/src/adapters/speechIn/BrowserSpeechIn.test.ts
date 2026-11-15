/**
 * BrowserSpeechIn and TypedSpeechIn against a scripted SpeechRecognition stand-in (the shape of
 * Chrome's webkitSpeechRecognition): the test fires onstart, onresult, onerror and onend.
 */
import { FakeClock } from '../clock/FakeClock';
import { BrowserSpeechIn, joinSegments, mapBrowserError } from './BrowserSpeechIn';
import type { BrowserRecognition, BrowserRecognitionResult, BrowserSpeechEnv } from './browserTypes';
import { createBrowserSpeechIn } from './createBrowserSpeechIn';
import { recordEvents } from '../../testing/recordSpeechInEvents';
import { TypedSpeechIn } from './TypedSpeechIn';
import type { ListenOptions } from './types';

const LISTEN: ListenOptions = { lang: 'es-ES', onDevice: true, interim: true };

class ScriptedRecognition implements BrowserRecognition {
  static instances: ScriptedRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: BrowserRecognition['onresult'] = null;
  onerror: BrowserRecognition['onerror'] = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  private results: BrowserRecognitionResult[] = [];

  constructor() {
    ScriptedRecognition.instances.push(this);
  }

  start(): void {
    this.started += 1;
  }

  stop(): void {
    this.stopped += 1;
  }

  abort(): void {
    this.aborted += 1;
  }

  /** Sets result `index` (as Chrome does: earlier results stay in the list). */
  result(index: number, transcript: string, isFinal: boolean, confidence = 0.8): void {
    this.results[index] = { isFinal, length: 1, 0: { transcript, confidence } };
    const results = this.results;
    this.onresult?.({ resultIndex: index, results: { ...results, length: results.length } });
  }

  static get last(): ScriptedRecognition {
    const r = ScriptedRecognition.instances[ScriptedRecognition.instances.length - 1];
    if (!r) throw new Error('no recognizer created');
    return r;
  }
}

function setup(env: Partial<BrowserSpeechEnv> = {}) {
  ScriptedRecognition.instances = [];
  const clock = new FakeClock();
  const speechIn = new BrowserSpeechIn(ScriptedRecognition, env, clock);
  return { clock, speechIn, rec: recordEvents(speechIn) };
}

describe('BrowserSpeechIn', () => {
  it('configures one recognizer per session and emits partials, one final and end', async () => {
    const { clock, speechIn, rec } = setup();
    await speechIn.start({ ...LISTEN, continuous: true });
    const r = ScriptedRecognition.last;
    expect(r).toMatchObject({ lang: 'es-ES', interimResults: true, continuous: true, maxAlternatives: 1, started: 1 });
    expect(speechIn.isListening).toBe(true);

    clock.advance(50);
    r.onstart?.();
    r.result(0, 'Marta lle', false);
    r.result(0, 'Marta llegó', true, 0.9);
    r.result(1, ' tar', false);
    r.result(1, ' tarde', true, 0.7);
    clock.advance(2000);
    await speechIn.stop();
    expect(r.stopped).toBe(1);
    r.onend?.();

    expect(rec.events).toEqual([
      { type: 'partial', text: 'Marta lle' },
      { type: 'partial', text: 'Marta llegó' },
      { type: 'partial', text: 'Marta llegó tar' },
      { type: 'partial', text: 'Marta llegó tarde' },
      { type: 'final', transcript: { text: 'Marta llegó tarde', durationMs: 2000, source: 'speech', confidence: 0.8 } },
      { type: 'end' },
    ]);
    expect(speechIn.isListening).toBe(false);
  });

  it('emits no partials when interim is off', async () => {
    const { speechIn, rec } = setup();
    await speechIn.start({ ...LISTEN, interim: false });
    const r = ScriptedRecognition.last;
    r.result(0, 'siguiente', true);
    r.onend?.();
    expect(rec.types()).toEqual(['final', 'end']);
  });

  it('maps errors and sends no final after one', async () => {
    const { speechIn, rec } = setup();
    await speechIn.start(LISTEN);
    const r = ScriptedRecognition.last;
    r.result(0, 'hola', true);
    r.onerror?.({ error: 'network' });
    r.onend?.();
    expect(rec.events).toEqual([
      { type: 'partial', text: 'hola' },
      { type: 'error', error: { code: 'network', message: undefined } },
      { type: 'end' },
    ]);
  });

  it('abort ends at once and ignores the aborted recognizer afterwards', async () => {
    const { speechIn, rec } = setup();
    await speechIn.start(LISTEN);
    const r = ScriptedRecognition.last;
    speechIn.abort();
    expect(r.aborted).toBe(1);
    r.onerror?.({ error: 'aborted' });
    r.result(0, 'tarde', true);
    r.onend?.();
    expect(rec.types()).toEqual(['end']);
  });

  it('ends without a final when nothing was recognized, and reports busy on a second start', async () => {
    const { speechIn, rec } = setup();
    await speechIn.start(LISTEN);
    await speechIn.start(LISTEN);
    expect(ScriptedRecognition.instances).toHaveLength(1);
    ScriptedRecognition.last.onend?.();
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'busy' } }, { type: 'end' }]);
  });

  it('reports a recognizer that refuses to start', async () => {
    const { speechIn, rec } = setup();
    jest.spyOn(ScriptedRecognition.prototype, 'start').mockImplementationOnce(() => {
      throw new Error('InvalidStateError');
    });
    await speechIn.start(LISTEN);
    expect(rec.types()).toEqual(['error', 'end']);
    expect(rec.events[0]).toMatchObject({ error: { code: 'unknown' } });
    expect(speechIn.isListening).toBe(false);
  });

  it('reads and requests microphone permission through navigator', async () => {
    const trackStop = jest.fn();
    const { speechIn } = setup({
      navigator: {
        permissions: { query: async () => ({ state: 'prompt' }) },
        mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: trackStop }] }) },
      },
    });
    expect(await speechIn.permissionStatus()).toBe('undetermined');
    expect(await speechIn.requestPermission()).toBe('granted');
    expect(trackStop).toHaveBeenCalledTimes(1);

    const denied = new BrowserSpeechIn(ScriptedRecognition, {
      navigator: {
        permissions: { query: async () => ({ state: 'denied' }) },
        mediaDevices: { getUserMedia: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) },
      },
    });
    expect(await denied.permissionStatus()).toBe('denied');
    expect(await denied.requestPermission()).toBe('denied');

    const bare = new BrowserSpeechIn(ScriptedRecognition, {});
    expect(await bare.permissionStatus()).toBe('undetermined');
    expect(await bare.requestPermission()).toBe('undetermined');
  });
});

describe('browser helpers', () => {
  it('joins result segments as written and maps error names', () => {
    expect(joinSegments(['Marta llegó', ' tarde ', ''])).toBe('Marta llegó tarde');
    expect(joinSegments(['東京', 'に行く'])).toBe('東京に行く');
    expect(mapBrowserError('service-not-allowed').code).toBe('not-allowed');
    expect(mapBrowserError('no-speech').code).toBe('no-speech');
    expect(mapBrowserError('aborted').code).toBe('interrupted');
    expect(mapBrowserError('bad-grammar')).toEqual({ code: 'unknown', message: 'bad-grammar' });
  });
});

describe('createBrowserSpeechIn and TypedSpeechIn', () => {
  it('uses the standard or prefixed recognizer when present, else typed answers', () => {
    expect(createBrowserSpeechIn({ SpeechRecognition: ScriptedRecognition }).kind).toBe('browser');
    expect(createBrowserSpeechIn({ webkitSpeechRecognition: ScriptedRecognition }).kind).toBe('browser');
    expect(createBrowserSpeechIn({}).kind).toBe('typed');
  });

  it('typed-only input reports unavailable on start and still takes typed answers', async () => {
    const speechIn = new TypedSpeechIn();
    const rec = recordEvents(speechIn);
    expect(speechIn.capabilities.speech).toBe(false);
    expect(await speechIn.permissionStatus()).toBe('unsupported');
    expect(await speechIn.requestPermission()).toBe('unsupported');
    await speechIn.start(LISTEN);
    await speechIn.stop();
    speechIn.abort();
    speechIn.submitTyped('listo');
    expect(rec.events).toEqual([
      { type: 'error', error: { code: 'unavailable' } },
      { type: 'end' },
      { type: 'final', transcript: { text: 'listo', durationMs: 0, source: 'typed' } },
    ]);
    expect(speechIn.isListening).toBe(false);
  });
});
