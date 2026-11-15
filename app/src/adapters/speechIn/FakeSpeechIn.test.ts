import { FakeClock } from '../clock/FakeClock';
import { FakeSpeechIn } from './FakeSpeechIn';
import { LevelMeter, levelToUnit, moduleLevelToDb } from './levels';
import { TypedSpeechIn } from './TypedSpeechIn';
import { recordEvents } from '../../testing/recordSpeechInEvents';
import type { ListenOptions } from './types';

const LISTEN: ListenOptions = { lang: 'es-ES', onDevice: true, interim: true };

describe('FakeSpeechIn', () => {
  it('says a scripted utterance: levels, growing partials, a timed final, then end', async () => {
    const clock = new FakeClock();
    const speechIn = new FakeSpeechIn({ clock });
    const rec = recordEvents(speechIn);

    await speechIn.start(LISTEN);
    expect(speechIn.isListening).toBe(true);
    expect(speechIn.currentOptions).toEqual(LISTEN);
    speechIn.say({ text: 'Marta llegó tarde', msPerWord: 300, gapMs: 100, levels: [-40, -12] });

    expect(rec.types()).toEqual(['level', 'level', 'partial', 'partial', 'partial', 'final', 'end']);
    expect(rec.events.filter((e) => e.type === 'partial').map((e) => (e.type === 'partial' ? e.text : ''))).toEqual([
      'Marta',
      'Marta llegó',
      'Marta llegó tarde',
    ]);
    const final = rec.events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.transcript).toEqual({
      text: 'Marta llegó tarde',
      source: 'speech',
      durationMs: 1100,
      confidence: undefined,
      words: [
        { text: 'Marta', startMs: 0, endMs: 300 },
        { text: 'llegó', startMs: 400, endMs: 700 },
        { text: 'tarde', startMs: 800, endMs: 1100 },
      ],
    });
    expect(speechIn.isListening).toBe(false);
  });

  it('plays a queued utterance when the learner lets go (stop), without partials if not asked', async () => {
    const speechIn = new FakeSpeechIn();
    const rec = recordEvents(speechIn);
    speechIn.queueUtterance('otra vez');
    await speechIn.start({ ...LISTEN, interim: false });
    await speechIn.stop();
    expect(rec.types()).toEqual(['final', 'end']);
    expect(speechIn.stopCalls).toBe(1);

    await speechIn.start(LISTEN);
    await speechIn.stop();
    expect(rec.types()).toEqual(['final', 'end', 'end']);
  });

  it('measures durationMs on the clock for emitFinal', async () => {
    const clock = new FakeClock();
    const speechIn = new FakeSpeechIn({ clock });
    const rec = recordEvents(speechIn);
    await speechIn.start(LISTEN);
    clock.advance(2500);
    speechIn.emitPartial('no');
    speechIn.emitLevel(-30);
    speechIn.emitFinal('no sé', { confidence: 0.9 });
    expect(rec.events.find((e) => e.type === 'final')).toMatchObject({
      transcript: { text: 'no sé', durationMs: 2500, confidence: 0.9, source: 'speech' },
    });
  });

  it('reports errors then ends; abort ends without a final', async () => {
    const speechIn = new FakeSpeechIn();
    const rec = recordEvents(speechIn);
    await speechIn.start(LISTEN);
    speechIn.emitError('no-speech');
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'no-speech', message: undefined } }, { type: 'end' }]);

    await speechIn.start(LISTEN);
    speechIn.abort();
    speechIn.abort();
    expect(rec.types()).toEqual(['error', 'end', 'end']);
    expect(speechIn.abortCalls).toBe(2);
    expect(() => speechIn.say('hola')).toThrow(/not listening/);
  });

  it('reports busy for a second start and keeps the running session', async () => {
    const speechIn = new FakeSpeechIn();
    const rec = recordEvents(speechIn);
    await speechIn.start(LISTEN);
    await speechIn.start({ ...LISTEN, lang: 'en-US' });
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'busy' } }]);
    expect(speechIn.isListening).toBe(true);
    expect(speechIn.startCalls).toHaveLength(2);
    expect(speechIn.currentOptions?.lang).toBe('es-ES');
  });

  it('asks for permission and refuses to listen without it', async () => {
    const speechIn = new FakeSpeechIn({ permission: 'undetermined', requestResult: 'denied' });
    const rec = recordEvents(speechIn);
    expect(await speechIn.permissionStatus()).toBe('undetermined');
    expect(await speechIn.requestPermission()).toBe('denied');
    await speechIn.start(LISTEN);
    expect(rec.events).toEqual([{ type: 'error', error: { code: 'not-allowed' } }, { type: 'end' }]);
    expect(speechIn.isListening).toBe(false);
  });

  it('takes typed answers, aborting a running session first; blank text is ignored', async () => {
    const speechIn = new FakeSpeechIn();
    const rec = recordEvents(speechIn);
    await speechIn.start(LISTEN);
    speechIn.submitTyped('  el mercado ');
    speechIn.submitTyped('   ');
    expect(rec.events).toEqual([
      { type: 'end' },
      { type: 'final', transcript: { text: 'el mercado', durationMs: 0, source: 'typed' } },
    ]);
    rec.stop();
    speechIn.submitTyped('nada');
    expect(rec.events).toHaveLength(2);
  });
});

describe('FakeSpeechIn meter, availability and downloads', () => {
  it('turns levels into a smoothed 0..1 meter that returns to 0 when the session ends', async () => {
    const speechIn = new FakeSpeechIn();
    const meters: number[] = [];
    speechIn.onMeter((m) => meters.push(m));
    await speechIn.start(LISTEN);
    speechIn.say({ text: 'hola', levels: [0, -60] });
    expect(meters).toEqual([0.6, 0.42, 0]);

    await speechIn.start(LISTEN);
    speechIn.abort();
    expect(meters).toEqual([0.6, 0.42, 0]);
  });

  it('reports availability from the permission unless overridden, and records downloads', async () => {
    const speechIn = new FakeSpeechIn({ permission: 'undetermined' });
    expect(await speechIn.availability(LISTEN)).toEqual({
      status: 'needs-permission',
      permission: 'undetermined',
      locale: 'es-ES',
      onDevice: true,
      canDownload: false,
    });
    speechIn.availabilityOverride = { status: 'on-device-unavailable', canDownload: true };
    speechIn.downloadResult = 'started';
    expect(await speechIn.availability(LISTEN)).toMatchObject({ status: 'on-device-unavailable', canDownload: true });
    expect(await speechIn.downloadLanguage('es-US')).toBe('started');
    expect(speechIn.downloadCalls).toEqual(['es-US']);
  });

  it('passes extra final fields through emitFinal', async () => {
    const speechIn = new FakeSpeechIn();
    const rec = recordEvents(speechIn);
    await speechIn.start(LISTEN);
    speechIn.emitFinal('otra vez', { spokenMs: 640, wordTiming: 'estimated', alternatives: ['otra ves'], locale: 'es-US', onDevice: true });
    expect(rec.events[0]).toMatchObject({
      transcript: { text: 'otra vez', spokenMs: 640, wordTiming: 'estimated', alternatives: ['otra ves'], locale: 'es-US', onDevice: true },
    });
  });

  it('typed-only input is unavailable and cannot download', async () => {
    const typed = new TypedSpeechIn();
    expect(await typed.availability(LISTEN)).toEqual({
      status: 'unavailable',
      permission: 'unsupported',
      locale: null,
      onDevice: false,
      canDownload: false,
    });
    expect(await typed.downloadLanguage('es-ES')).toBe('unsupported');
  });
});

describe('LevelMeter and module levels', () => {
  it('rises fast, falls slower, and maps the module scale to dBFS', () => {
    const meter = new LevelMeter();
    expect(meter.push(0)).toBe(0.6);
    expect(meter.push(0)).toBe(0.84);
    expect(meter.push(-90)).toBe(0.588);
    meter.reset();
    expect(meter.current).toBe(0);
    expect(moduleLevelToDb(-2)).toBe(-60);
    expect(moduleLevelToDb(0)).toBe(-50);
    expect(moduleLevelToDb(10)).toBe(0);
    expect(moduleLevelToDb(Number.NaN)).toBe(-60);
  });
});

describe('levelToUnit', () => {
  it('maps dBFS to 0..1 for a meter', () => {
    expect(levelToUnit(0)).toBe(1);
    expect(levelToUnit(-30)).toBeCloseTo(0.5);
    expect(levelToUnit(-90)).toBe(0);
    expect(levelToUnit(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(levelToUnit(5)).toBe(1);
  });
});
