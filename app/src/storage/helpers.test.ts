import { createId } from './clock';
import { addDays, isDayKey, localDayKey } from './day';
import { fromFlag, fromJson, toFlag, toJson } from './json';

describe('storage helpers', () => {
  it('makes unique ids', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => createId(1_794_758_400_000)));
    expect(ids.size).toBe(2000);
    expect(createId()).toMatch(/^[0-9a-z]+-[0-9a-z]{4}-[0-9a-z]{6}$/);
  });

  it('turns times into local day keys and steps by calendar day', () => {
    expect(localDayKey(new Date(2026, 0, 5, 0, 0, 1).getTime())).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 0, 5, 23, 59, 59).getTime())).toBe('2026-01-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isDayKey('2026-11-15')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('15/11/2026')).toBe(false);
    expect(() => addDays('nope', 1)).toThrow();
  });

  it('reads damaged JSON as the fallback', () => {
    expect(fromJson(toJson({ a: [1, 'b'] }), null)).toEqual({ a: [1, 'b'] });
    expect(toJson(undefined)).toBe('null');
    expect(fromJson('{oops', 'fallback')).toBe('fallback');
    expect(fromJson(null, 7)).toBe(7);
    expect([toFlag(true), toFlag(false), fromFlag(1), fromFlag(0), fromFlag(null)]).toEqual([1, 0, true, false, false]);
  });
});
