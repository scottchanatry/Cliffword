import { FakeClock } from '../clock/FakeClock';
import { FakeSpeechOut } from './FakeSpeechOut';
import type { WordBoundary } from './types';

describe('FakeSpeechOut', () => {
  it('records calls and reports every word boundary with estimated timings', async () => {
    const clock = new FakeClock();
    const speech = new FakeSpeechOut({ clock });
    const boundaries: WordBoundary[] = [];

    const result = await speech.speak('Marta llegó tarde.', {
      lang: 'es-ES',
      rate: 0.8,
      voice: 'fake.es-ES.enhanced',
      onWordBoundary: (b) => boundaries.push(b),
    });

    expect(result).toEqual({ completed: true });
    expect(speech.isSpeaking).toBe(false);
    expect(boundaries.map((b) => [b.index, b.text, b.start, b.end])).toEqual([
      [0, 'Marta', 0, 5],
      [1, 'llegó', 6, 11],
      [2, 'tarde', 12, 17],
    ]);
    expect(boundaries.map((b) => b.elapsedMs)).toEqual(speech.lastCall?.timings.map((t) => t.startMs));
    expect(speech.lastCall).toMatchObject({ text: 'Marta llegó tarde.', lang: 'es-ES', rate: 0.8, completed: true, startedAt: clock.now() });
    expect(speech.spokenTexts).toEqual(['Marta llegó tarde.']);
  });

  it('uses the caller word spans when given', async () => {
    const speech = new FakeSpeechOut();
    const seen: string[] = [];
    await speech.speak('ab cd', { words: [{ text: 'ab cd', start: 0, end: 5 }], onWordBoundary: (b) => seen.push(b.text) });
    expect(seen).toEqual(['ab cd']);
  });

  it('in manual mode stays pending until finish(), and stop() cuts it off', async () => {
    const speech = new FakeSpeechOut({ autoFinish: false });
    const seen: number[] = [];
    const first = speech.speak('uno dos tres', { onWordBoundary: (b) => seen.push(b.index) });
    expect(speech.isSpeaking).toBe(true);
    speech.speakWords(2);
    expect(seen).toEqual([0, 1]);
    speech.finish();
    await expect(first).resolves.toEqual({ completed: true });
    expect(seen).toEqual([0, 1, 2]);

    const second = speech.speak('otra vez');
    await speech.stop();
    await expect(second).resolves.toEqual({ completed: false });
    expect(speech.stopCount).toBe(1);
    expect(speech.calls.map((c) => c.completed)).toEqual([true, false]);
    expect(() => speech.finish()).toThrow(/nothing is speaking/);
  });

  it('a new speak() interrupts the one playing', async () => {
    const speech = new FakeSpeechOut({ autoFinish: false });
    const first = speech.speak('primera');
    const second = speech.speak('segunda');
    await expect(first).resolves.toEqual({ completed: false });
    speech.finish();
    await expect(second).resolves.toEqual({ completed: true });
  });

  it('lists fake voices by language', async () => {
    const speech = new FakeSpeechOut();
    const spanish = await speech.voices('es');
    expect(spanish.length).toBeGreaterThan(1);
    expect(spanish.every((v) => v.lang.startsWith('es'))).toBe(true);
    expect(spanish[0]?.quality).toBe('enhanced');
    expect((await speech.voices('en')).map((v) => v.lang)).toEqual(['en-US']);
  });
});
