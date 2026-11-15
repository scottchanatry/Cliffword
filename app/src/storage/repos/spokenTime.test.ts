import { localDayKey } from '../day';
import { openTestStorage } from '../testing/openTestStorage';

/** Local time on 2026-11-<day> at <hour>:<minute>. */
const nov = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

describe('SpokenTimeRepo', () => {
  let storage: Awaited<ReturnType<typeof openTestStorage>>;
  beforeEach(async () => {
    storage = await openTestStorage();
  });
  afterEach(() => storage.close());

  it('adds utterances to their local day', async () => {
    await storage.spokenTime.addUtterance(1500, nov(15, 9));
    await storage.spokenTime.addUtterance(2499.6, nov(15, 23, 59));
    await storage.spokenTime.addUtterance(1000, nov(16, 0, 1));
    expect(await storage.spokenTime.day('2026-11-15')).toBe(4000);
    expect(await storage.spokenTime.today(nov(15, 18))).toBe(4000);
    expect(await storage.spokenTime.today(nov(16))).toBe(1000);
    expect(await storage.spokenTime.today(nov(17))).toBe(0);
    expect(await storage.spokenTime.total()).toBe(5000);
  });

  it('starts empty', async () => {
    expect(await storage.spokenTime.total()).toBe(0);
    expect(await storage.spokenTime.streak(nov(15))).toBe(0);
  });

  it('lists a range of days', async () => {
    await storage.spokenTime.addUtterance(100, nov(10));
    await storage.spokenTime.addUtterance(200, nov(12));
    await storage.spokenTime.addUtterance(300, nov(20));
    expect(await storage.spokenTime.range('2026-11-10', '2026-11-15')).toEqual([
      { day: '2026-11-10', ms: 100 },
      { day: '2026-11-12', ms: 200 },
    ]);
    await expect(storage.spokenTime.range('2026-11-31', '2026-12-01')).rejects.toThrow(/range/);
  });

  it('counts the streak back from today, or from yesterday while today is empty', async () => {
    for (const day of [10, 12, 13, 14]) await storage.spokenTime.addUtterance(60_000, nov(day));
    expect(await storage.spokenTime.streak(nov(15, 8))).toBe(3); // today empty: 12, 13, 14
    await storage.spokenTime.addUtterance(500, nov(15, 8));
    expect(await storage.spokenTime.streak(nov(15, 20))).toBe(4);
    expect(await storage.spokenTime.streak(nov(17))).toBe(0); // missed the 16th
    // Today's 500 ms is under the minimum, which does not break the streak while the day lasts.
    expect(await storage.spokenTime.streak(nov(15, 20), 1000)).toBe(3);
    expect(await storage.spokenTime.streak(nov(15, 20), 120_000)).toBe(0);
  });

  it('counts a streak across a month end', async () => {
    await storage.spokenTime.addUtterance(1000, new Date(2026, 9, 31, 12).getTime());
    await storage.spokenTime.addUtterance(1000, nov(1));
    expect(await storage.spokenTime.streak(nov(1, 22))).toBe(2);
    expect(localDayKey(nov(1))).toBe('2026-11-01');
  });

  it('ignores zero-length utterances and rejects bad input', async () => {
    await storage.spokenTime.addUtterance(0, nov(15));
    expect(await storage.spokenTime.range('2026-11-01', '2026-11-30')).toEqual([]);
    await expect(storage.spokenTime.addUtterance(-5, nov(15))).rejects.toThrow();
    await expect(storage.spokenTime.addUtterance(Number.NaN, nov(15))).rejects.toThrow();
    await expect(storage.spokenTime.addUtterance(10, Number.NaN)).rejects.toThrow();
  });
});
