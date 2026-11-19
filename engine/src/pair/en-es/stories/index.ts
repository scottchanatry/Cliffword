/**
 * The authored series of the en-es pair (docs/STORY-FORMAT.md): EN_ES_TRACKS (the six
 * experiences, picker order) and EN_ES_LIBRARY (every written episode). Writers add
 * their series here: import its stories and append them to EN_ES_LIBRARY (and its track
 * to tracks.ts if it is new).
 */
import type { LibraryStory } from '../../types';
import { LIVING_STORIES } from './living';

export { EN_ES_TRACKS, DATING_TRACK, FOOD_TRACK, FRIENDS_TRACK, MYSTERY_TRACK, TRAVEL_TRACK } from './tracks';
export { LIVING_STORIES, LIVING_TRACK, LIVING_WORDS } from './living';

/** Every written episode of every series. */
export const EN_ES_LIBRARY: readonly LibraryStory[] = [...LIVING_STORIES];
