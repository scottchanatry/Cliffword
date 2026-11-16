/**
 * App settings to the engine's session settings, and back for the text mode.
 *
 * - textMode: the app stores 'auto' | 'text' | 'tiles'; the engine speaks 'auto' |
 *   'all_text' | 'all_tiles'.
 * - speechRateBias: the app's is added to the engine's rate (-0.5 to 0.5, 0 = as derived);
 *   the engine's multiplies it (1 = as derived). 1 + bias maps one onto the other.
 * - showExplicit, register, regions and nativeAnswersAllowed carry over as they are.
 */
import type { PriorSpec, SessionSettings, StartMode, TextMode } from '@cliffword/engine';
import type { AppSettings, StartLevel, TextMode as AppTextMode } from '../../storage/repos/settings';

const TO_ENGINE: Readonly<Record<AppTextMode, TextMode>> = { auto: 'auto', text: 'all_text', tiles: 'all_tiles' };
const TO_APP: Readonly<Record<TextMode, AppTextMode>> = { auto: 'auto', all_text: 'text', all_tiles: 'tiles' };

export function toEngineTextMode(mode: AppTextMode): TextMode {
  return TO_ENGINE[mode] ?? 'auto';
}

export function toAppTextMode(mode: TextMode): AppTextMode {
  return TO_APP[mode] ?? 'auto';
}

/** The session settings for the app settings. */
export function sessionSettingsFor(s: AppSettings): SessionSettings {
  const bias = Number.isFinite(s.speechRateBias) ? s.speechRateBias : 0;
  return {
    register: s.register,
    regions: [...s.regions],
    showExplicit: s.showExplicit,
    textMode: toEngineTextMode(s.textMode),
    speechRateBias: Math.max(0.1, 1 + bias),
    nativeAnswersAllowed: s.nativeAnswersAllowed,
  };
}

/** True when two session settings say the same thing. */
export function sameSessionSettings(a: SessionSettings, b: SessionSettings): boolean {
  return (
    a.register === b.register &&
    a.showExplicit === b.showExplicit &&
    a.textMode === b.textMode &&
    a.speechRateBias === b.speechRateBias &&
    a.nativeAnswersAllowed === b.nativeAnswersAllowed &&
    a.regions.length === b.regions.length &&
    a.regions.every((r, i) => r === b.regions[i])
  );
}

/**
 * How a new story session starts. A learner with history (an earlier story session, or a
 * placement already stored as the prior) continues; otherwise the onboarding choice decides:
 * "I'm brand new" plays the starter story, "I know some" runs placement in the first story.
 */
export function startModeFor(start: StartLevel, history: { storedPrior: PriorSpec | null; earlierSessions: number }): StartMode {
  if (history.storedPrior?.kind === 'placement' || history.earlierSessions > 0) return 'continue';
  return start === 'placement' ? 'placement' : 'brand_new';
}
