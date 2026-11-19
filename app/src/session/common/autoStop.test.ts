import { AutoStop, DEFAULT_AUTO_STOP } from './autoStop';

const listening = (level: number, partial = '') => ({ phase: 'listening' as const, level, partial });

describe('AutoStop (tap-mode listening)', () => {
  it('stops about 1.5 s after the voice was last heard, never before anything was said', () => {
    const a = new AutoStop(0);
    a.observe(listening(0.2), 100);
    expect(a.due(3000)).toBe(false);
    a.observe(listening(0.7), 3200);
    a.observe(listening(0.3), 3400);
    expect(a.due(3200 + DEFAULT_AUTO_STOP.silenceMs - 1)).toBe(false);
    expect(a.due(3200 + DEFAULT_AUTO_STOP.silenceMs)).toBe(true);
  });

  it('counts a new partial transcript as voice', () => {
    const a = new AutoStop(0);
    a.observe(listening(0.1), 50);
    a.observe(listening(0.1, 'son'), 1000);
    a.observe(listening(0.1, 'son las'), 2000);
    expect(a.due(3000)).toBe(false);
    expect(a.due(3500)).toBe(true);
  });

  it('without levels (a recognizer that sends none), stops at the 6 s cap', () => {
    const a = new AutoStop(1000);
    a.observe(listening(0, 'cuatro'), 1500);
    expect(a.due(4000)).toBe(false);
    expect(a.due(1000 + DEFAULT_AUTO_STOP.capMs)).toBe(true);
  });

  it('a noisy room never reads as silence, so the cap ends it', () => {
    const a = new AutoStop(0, { capMs: 6000 });
    for (let t = 0; t < 6000; t += 100) a.observe(listening(0.8), t);
    expect(a.due(5900)).toBe(false);
    expect(a.due(6000)).toBe(true);
  });
});
