import { createTranslator } from './translator';
import { clockParts } from './duration';

describe('clockParts', () => {
  it('splits ms into whole minutes and padded seconds', () => {
    expect(clockParts(0)).toEqual({ m: 0, ss: '00' });
    expect(clockParts(125_999)).toEqual({ m: 2, ss: '05' });
    expect(clockParts(61 * 60_000)).toEqual({ m: 61, ss: '00' });
  });

  it('treats negative and non-finite values as zero', () => {
    expect(clockParts(-5)).toEqual({ m: 0, ss: '00' });
    expect(clockParts(Number.NaN)).toEqual({ m: 0, ss: '00' });
    expect(clockParts(Number.POSITIVE_INFINITY)).toEqual({ m: 0, ss: '00' });
  });

  it('fills the catalog pattern', () => {
    expect(createTranslator().t('time.clock', clockParts(125_000))).toBe('2:05');
  });
});
