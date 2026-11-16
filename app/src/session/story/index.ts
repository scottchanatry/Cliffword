/**
 * The Story tab's controller: createStoryController(deps) implements StoryController
 * (../contract.ts) over the engine's StorySession; useStoryController() builds it for the
 * route from useServices() and the app state.
 */
export { createStoryController, initialStoryViewModel } from './createStoryController';
export type { StoryControllerDeps, StoryControllerHandle } from './createStoryController';
export { useStoryController } from './useStoryController';
export type { UseStoryController } from './useStoryController';
export { sameSessionSettings, sessionSettingsFor, startModeFor, toAppTextMode, toEngineTextMode } from './settings';
export { cueForScreen, hintsFor, planCue, sentenceOf, wordSpansOf } from './speech';
export type { CuePlan } from './speech';
