import { Listeners } from './listeners';
import { FakeClock, FAKE_CLOCK_START, systemClock } from './clock';

describe('Listeners', () => {
  it('calls listeners in order and stops calling removed ones', () => {
    const set = new Listeners<number>();
    const seen: string[] = [];
    const offA = set.add((v) => seen.push(`a${v}`));
    set.add((v) => seen.push(`b${v}`));
    set.emit(1);
    offA();
    offA();
    set.emit(2);
    expect(seen).toEqual(['a1', 'b1', 'b2']);
    expect(set.size).toBe(1);
  });

  it('runs every listener even when one throws, then rethrows the first error', () => {
    const set = new Listeners<void>();
    const after = jest.fn();
    set.add(() => {
      throw new Error('first');
    });
    set.add(after);
    expect(() => set.emit()).toThrow('first');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('applies adds and removes made during emit from the next emit', () => {
    const set = new Listeners<number>();
    const late = jest.fn();
    set.add(() => {
      set.add(late);
    });
    set.emit(1);
    expect(late).not.toHaveBeenCalled();
    set.emit(2);
    expect(late).toHaveBeenCalledWith(2);
  });
});

describe('clocks', () => {
  it('FakeClock starts at a fixed time and only moves when told', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(FAKE_CLOCK_START);
    expect(clock.advance(1500)).toBe(FAKE_CLOCK_START + 1500);
    clock.set(42);
    expect(clock.now()).toBe(42);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });

  it('systemClock reads Date.now()', () => {
    const before = Date.now();
    const t = systemClock.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});
