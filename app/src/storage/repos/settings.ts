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
} satisfies AppSettings);

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
