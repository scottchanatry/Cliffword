/**
 * Typed app settings, one row per key with a JSON value. A missing, malformed or out-of-range
 * stored value reads as the default, so the app always gets a complete, valid settings object.
 */
import type { Register } from '@cliffword/engine';
import type { StorageClock } from '../clock';
import { fromJson, toJson } from '../json';
import type { SqlDatabase } from '../sql/types';

/** auto: words fade to tiles as the learner knows them by ear; text / tiles: forced. */
export type TextMode = 'auto' | 'text' | 'tiles';
export const TEXT_MODES: readonly TextMode[] = ['auto', 'text', 'tiles'];

/**
 * How the learner model starts (onboarding): 'brandNew' ("I'm brand new", placement skipped:
 * only cognates are probably known) or 'placement' ("I know some", the first story places the
 * learner). The learner prior is built from it (src/learner/prior.ts), because priors are not
 * stored in learner snapshots.
 */
export type StartLevel = 'brandNew' | 'placement';
export const START_LEVELS: readonly StartLevel[] = ['brandNew', 'placement'];

/**
 * Where onboarding stopped (app/onboarding): stored after each step, so a killed app resumes
 * there. 'done' once onboarding finished (onboarded is then true). The steps of the earlier
 * onboarding (model, voice, slang) read as 'welcome'.
 */
export type OnboardingStep = 'welcome' | 'experience' | 'level' | 'address' | 'choices' | 'mic' | 'done';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['welcome', 'experience', 'level', 'address', 'choices', 'mic', 'done'];

/**
 * The onboarding the app shows now. A learner onboarded by an earlier one (onboardingVersion
 * lower: the build with placement, model and slang steps) goes through this one once, to pick
 * an experience, a level and a form of address (isOnboarded).
 */
export const ONBOARDING_VERSION = 2;

/** How characters address the learner: '{you:a|b}' variants in the stories agree with it. */
export type Address = 'm' | 'f';

/** Learner level of the story library, 0-5 (0-1 recall, 2-3 hint, 4-5 predict). */
export const MIN_LEVEL = 0;
export const MAX_LEVEL = 5;

/** Longest stored voice id (platform voice identifiers are short; anything longer is junk). */
const MAX_VOICE_ID = 256;

/** Track ids, choice keys and option ids: short ids ('en-es.track.dating', 'partner', 'mateo'). */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface AppSettings {
  /** Correction register: neutral Spanish or street (slang is never marked). */
  register: Register;
  /** Slang region codes of the target language (Spanish: PR, DO, CU, CO, CARIB). */
  regions: readonly string[];
  /** Explicit lyrics and slang are shown. On by default (brief). */
  showExplicit: boolean;
  textMode: TextMode;
  /** Language codes of the learner (native) and of what they learn (target). */
  nativeLanguage: string;
  targetLanguage: string;
  onboarded: boolean;
  /** Set by onboarding; picks the learner prior. */
  startLevel: StartLevel;
  /** Added to the engine's speech rate; -0.5 to 0.5, 0 = as the engine decides. */
  speechRateBias: number;
  /** The learner may answer in their native language and gets the target phrase to repeat. */
  nativeAnswersAllowed: boolean;
  /** The onboarding step to resume at. */
  onboardingStep: OnboardingStep;
  /** SpeechOut voice id chosen in onboarding or settings; null: the app picks by region. */
  voiceId: string | null;
  /** The learner chose "Not now" for the model download (the app runs in canned mode). */
  modelDeclined: boolean;
  /**
   * Speech recognition may use the platform's server when the device cannot recognize the
   * language on the device. Off by default: "on-device recognition only".
   */
  allowNetworkRecognition: boolean;
  /**
   * No longer written: reset progress now runs at once (AppState.resetProgress). Kept so a
   * stored value still reads and validates.
   */
  progressResetPending: boolean;
  /** The onboarding the learner finished (ONBOARDING_VERSION once the current one is done). */
  onboardingVersion: number;
  /** The experience (LibraryTrack.id) the Story tab plays; null until one is picked. */
  trackId: string | null;
  /** How characters address the learner ("as a man" 'm', "as a woman" 'f'). */
  address: Address;
  /**
   * The learner level 0-5: onboarding's "How much Spanish do you know?" (brand new 0, a little 2,
   * comfortable 4), then the level the story moved to after each episode, or a manual override
   * in Settings.
   */
  level: number;
  /** Track choices, per track: track id -> choice key -> option id ('partner' -> 'mateo'). */
  trackChoices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** The first-episode guide (coach marks for listen, answer, feedback) was shown. */
  guideSeen: boolean;
}

export type SettingKey = keyof AppSettings;

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  register: 'neutral',
  regions: Object.freeze(['PR', 'CARIB']),
  showExplicit: true,
  textMode: 'auto',
  nativeLanguage: 'en',
  targetLanguage: 'es',
  onboarded: false,
  startLevel: 'brandNew',
  speechRateBias: 0,
  nativeAnswersAllowed: true,
  onboardingStep: 'welcome',
  voiceId: null,
  modelDeclined: false,
  allowNetworkRecognition: false,
  progressResetPending: false,
  onboardingVersion: 0,
  trackId: null,
  address: 'm',
  level: 0,
  trackChoices: Object.freeze({}),
  guideSeen: false,
} satisfies AppSettings);

/** Onboarding is done, in its current version (the root guard). */
export function isOnboarded(s: Pick<AppSettings, 'onboarded' | 'onboardingVersion'>): boolean {
  return s.onboarded && s.onboardingVersion >= ONBOARDING_VERSION;
}

/** The patch that marks onboarding done in its current version. */
export const ONBOARDED: Readonly<Pick<AppSettings, 'onboarded' | 'onboardingStep' | 'onboardingVersion'>> = Object.freeze({
  onboarded: true,
  onboardingStep: 'done',
  onboardingVersion: ONBOARDING_VERSION,
});

function normalizeChoices(v: unknown): AppSettings['trackChoices'] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [track, choices] of Object.entries(v as Record<string, unknown>)) {
    if (!ID.test(track) || !choices || typeof choices !== 'object' || Array.isArray(choices)) return undefined;
    const inner: Record<string, string> = {};
    for (const [key, option] of Object.entries(choices as Record<string, unknown>)) {
      if (!ID.test(key) || typeof option !== 'string' || !ID.test(option)) return undefined;
      inner[key] = option;
    }
    out[track] = Object.freeze(inner);
  }
  return Object.freeze(out);
}

export const SPEECH_RATE_BIAS_LIMIT = 0.5;

const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const REGION_CODE = /^[A-Z][A-Z0-9]{1,7}$/;

type Normalizer<K extends SettingKey> = (value: unknown) => AppSettings[K] | undefined;

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Each key's check: returns the (normalized) value, or undefined when it is not valid. */
const NORMALIZE: { [K in SettingKey]: Normalizer<K> } = {
  register: (v) => (v === 'neutral' || v === 'street' ? v : undefined),
  regions: (v) => {
    if (!Array.isArray(v) || !v.every((r): r is string => typeof r === 'string' && REGION_CODE.test(r))) return undefined;
    return Object.freeze([...new Set(v)]);
  },
  showExplicit: (v) => (isBool(v) ? v : undefined),
  textMode: (v) => (TEXT_MODES.includes(v as TextMode) ? (v as TextMode) : undefined),
  nativeLanguage: (v) => (typeof v === 'string' && LANGUAGE_CODE.test(v) ? v : undefined),
  targetLanguage: (v) => (typeof v === 'string' && LANGUAGE_CODE.test(v) ? v : undefined),
  onboarded: (v) => (isBool(v) ? v : undefined),
  startLevel: (v) => (START_LEVELS.includes(v as StartLevel) ? (v as StartLevel) : undefined),
  speechRateBias: (v) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(-SPEECH_RATE_BIAS_LIMIT, Math.min(SPEECH_RATE_BIAS_LIMIT, v)) : undefined,
  nativeAnswersAllowed: (v) => (isBool(v) ? v : undefined),
  onboardingStep: (v) => (ONBOARDING_STEPS.includes(v as OnboardingStep) ? (v as OnboardingStep) : undefined),
  voiceId: (v) => (v === null || (typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_VOICE_ID) ? v : undefined),
  modelDeclined: (v) => (isBool(v) ? v : undefined),
  allowNetworkRecognition: (v) => (isBool(v) ? v : undefined),
  progressResetPending: (v) => (isBool(v) ? v : undefined),
  onboardingVersion: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000 ? v : undefined),
  trackId: (v) => (v === null || (typeof v === 'string' && ID.test(v)) ? v : undefined),
  address: (v) => (v === 'm' || v === 'f' ? v : undefined),
  level: (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(v))) : undefined),
  trackChoices: normalizeChoices,
  guideSeen: (v) => (isBool(v) ? v : undefined),
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

function normalize<K extends SettingKey>(key: K, value: unknown): AppSettings[K] | undefined {
  return (NORMALIZE[key] as Normalizer<K>)(value);
}

function isSettingKey(key: string): key is SettingKey {
  return (KEYS as string[]).includes(key);
}

export class InvalidSettingError extends Error {
  constructor(readonly key: string) {
    super(`Invalid value for setting "${key}"`);
    this.name = 'InvalidSettingError';
  }
}

export class SettingsRepo {
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: StorageClock,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return normalize(key, fromJson<unknown>(row?.value, undefined)) ?? DEFAULT_SETTINGS[key];
  }

  /** Every setting, stored values over defaults. Unknown stored keys are ignored. */
  async getAll(): Promise<AppSettings> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const { key, value } of rows) {
      if (!isSettingKey(key)) continue;
      const v = normalize(key, fromJson<unknown>(value, undefined));
      if (v !== undefined) out[key] = v;
    }
    return out as unknown as AppSettings;
  }

  /** Store one setting. Throws InvalidSettingError for a value that fails its check. */
  async set<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<void> {
    await this.write({ [key]: value } as Partial<AppSettings>);
  }

  /** Store several settings in one transaction (all or none); returns the full settings afterwards. */
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.write(patch);
    return this.getAll();
  }

  private async write(patch: Partial<AppSettings>): Promise<void> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    const checked = entries.map(([key, value]) => {
      if (!isSettingKey(key)) throw new InvalidSettingError(key);
      const v = normalize(key, value);
      if (v === undefined) throw new InvalidSettingError(key);
      return [key, v] as const;
    });
    const at = this.clock.now();
    await this.db.transaction(async (tx) => {
      for (const [key, value] of checked) {
        await tx.run(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, toJson(value), at],
        );
      }
    });
  }

  /** Back to the default: one key, or every setting when no key is given. */
  async reset(key?: SettingKey): Promise<void> {
    if (key) await this.db.run('DELETE FROM settings WHERE key = ?', [key]);
    else await this.db.run('DELETE FROM settings');
  }
}
