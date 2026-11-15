import type { Clock } from './types';

/** The real clock: Date.now(). */
export const systemClock: Clock = {
  now: () => Date.now(),
};
