/**
 * Fixtures for the onboarding, profile and settings views (the dev gallery and the view tests):
 * plain data for each screen state, so the web export can show a download in progress, a refused
 * microphone or a finished self-test without a device. Names are prefixed so they never clash
 * with the story and music fixtures.
 */
import type { ModelAvailability } from '../../adapters/model/keepModelLoaded';
import { DEFAULT_MODEL } from '../../adapters/model/descriptor';
import type { ModelFileState, ModelInfo } from '../../adapters/model/types';
import type { SpeechAvailability } from '../../adapters/speechIn/types';
import type { Voice } from '../../adapters/speechOut/types';
import { DEFAULT_SETTINGS, ONBOARDED, type AppSettings } from '../../storage/repos/settings';
import type { SelfTestReport, SentenceResult } from './selftest';
import { SELF_TEST_PAIRS, SELF_TEST_TOLERANCE } from './selftestData';
import type { SkillCounts, WeekBar } from './stats';
import type { MusicAccess } from './SettingsView';

export const ACCOUNT_FIXTURE_NAMES = [
  'onboarding-welcome',
  'onboarding-experience',
  'onboarding-level',
  'onboarding-address',
  'onboarding-mic',
  'onboarding-mic-denied',
  'profile',
  'profile-new',
  'settings',
  'settings-downloading',
  'licenses',
  'selftest',
  'selftest-mock',
] as const;

export type AccountFixtureName = (typeof ACCOUNT_FIXTURE_NAMES)[number];

export function isAccountFixtureName(name: string): name is AccountFixtureName {
  return (ACCOUNT_FIXTURE_NAMES as readonly string[]).includes(name);
}

const BYTES = DEFAULT_MODEL.bytes;

const progress = (fraction: number) => ({ bytesWritten: Math.round(BYTES * fraction), bytesTotal: BYTES, fraction });

export const MODEL_STATES: Readonly<Record<'absent' | 'downloading' | 'error' | 'ready', { file: ModelFileState; availability: ModelAvailability }>> = {
  absent: { file: { status: 'absent', progress: progress(0), error: null }, availability: 'missing' },
  downloading: { file: { status: 'downloading', progress: progress(0.42), error: null }, availability: 'downloading' },
  error: {
    file: { status: 'error', progress: progress(0), error: 'insufficient-storage', space: { freeBytes: 900_000_000, neededBytes: BYTES + 600_000_000 } },
    availability: 'download-failed',
  },
  ready: { file: { status: 'ready', progress: progress(1), error: null }, availability: 'ready' },
};

/** Free space the fixtures show (23.4 GB). */
export const FIXTURE_FREE_BYTES = 23_400_000_000;

/** Voices as an iPhone lists them for Spanish (names are the platform's). */
export const FIXTURE_VOICES: readonly Voice[] = [
  { id: 'com.apple.voice.enhanced.es-MX.Paulina', name: 'Paulina', lang: 'es-MX', quality: 'enhanced' },
  { id: 'com.apple.voice.compact.es-ES.Monica', name: 'Mónica', lang: 'es-ES', quality: 'default' },
  { id: 'com.apple.voice.compact.es-MX.Juan', name: 'Juan', lang: 'es-MX', quality: 'default' },
];

export const SPEECH_READY: SpeechAvailability = { status: 'ready', permission: 'granted', locale: 'es-US', onDevice: true, canDownload: false };
export const SPEECH_NEEDS_PERMISSION: SpeechAvailability = { ...SPEECH_READY, status: 'needs-permission', permission: 'undetermined' };
export const SPEECH_DENIED: SpeechAvailability = { ...SPEECH_READY, status: 'permission-denied', permission: 'denied' };

/** 2026-11-16 (a Monday) and the six days before it. */
const WEEK_DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'] as const;
const WEEK_MS = [184_000, 0, 412_000, 266_000, 95_000, 341_000, 303_000] as const;

export function fixtureWeek(ms: readonly number[] = WEEK_MS): WeekBar[] {
  const best = Math.max(0, ...ms);
  return WEEK_DAYS.map((day, i) => ({ day, weekday: (i + 2) % 7, ms: ms[i] ?? 0, share: best > 0 ? (ms[i] ?? 0) / best : 0, today: i === 6 }));
}

export interface ProfileFixture {
  spokenMs: number;
  todayMs: number;
  week: WeekBar[];
  streakDays: number;
  wordsKnown: number;
  skills: SkillCounts;
  practised: number;
}

export const PROFILE_FIXTURES: Readonly<Record<'profile' | 'profile-new', ProfileFixture>> = {
  profile: {
    spokenMs: 7_512_000,
    todayMs: 303_000,
    week: fixtureWeek(),
    streakDays: 4,
    wordsKnown: 412,
    skills: { meaning: 412, sound: 236, speaking: 97 },
    practised: 186,
  },
  'profile-new': {
    spokenMs: 0,
    todayMs: 0,
    week: fixtureWeek([0, 0, 0, 0, 0, 0, 0]),
    streakDays: 0,
    wordsKnown: 38,
    skills: { meaning: 38, sound: 6, speaking: 2 },
    practised: 0,
  },
};

export const SETTINGS_FIXTURE: AppSettings = {
  ...DEFAULT_SETTINGS,
  ...ONBOARDED,
  voiceId: 'com.apple.voice.enhanced.es-MX.Paulina',
  trackId: 'en-es.track.living',
  level: 1,
  address: 'f',
};

export const MUSIC_ACCESS_FIXTURE: MusicAccess = 'authorized';

export const MODEL_INFO_FIXTURES: Readonly<Record<'native' | 'mock', ModelInfo>> = {
  native: { id: 'qwen3-1.7b-q4_k_m', contextSize: 2048, backend: 'llama.rn', scoring: 'native' },
  mock: { id: 'mock-ngram-es', contextSize: 4096, backend: 'mock' },
};

/** A finished self-test: each total a little off the proof's (deterministic), all within the tolerance. */
export function fixtureSelfTestReport(info: ModelInfo): SelfTestReport {
  const mock = info.backend === 'mock';
  let n = 0;
  const sentence = (text: string, expected: number): SentenceResult => {
    n += 1;
    const actual = mock ? -2.5 * text.length * 0.31 : expected + (((n * 37) % 13) - 6) / 100;
    return { text, expected, actual, diff: Math.abs(actual - expected), ms: 180 + ((n * 53) % 90), tokens: 9, upperBound: 0 };
  };
  const pairs = SELF_TEST_PAIRS.map((pair) => {
    const good = sentence(pair.good, pair.goodTotal);
    const bad = sentence(pair.bad, pair.badTotal);
    return { pair, good, bad, prefersGood: (good.actual ?? 0) > (bad.actual ?? 0) };
  });
  const sentences = pairs.flatMap((p) => [p.good, p.bad]);
  return {
    verdict: mock ? 'mock' : 'pass',
    modelId: info.id,
    backend: info.backend,
    scoring: info.scoring ?? 'exact',
    tolerance: SELF_TEST_TOLERANCE,
    pairs,
    sentences: sentences.length,
    within: sentences.filter((s) => (s.diff ?? 1) <= SELF_TEST_TOLERANCE).length,
    maxDiff: Math.max(...sentences.map((s) => s.diff ?? 0)),
    preferred: pairs.filter((p) => p.prefersGood).length,
    scoredPairs: pairs.length,
    failedCalls: 0,
    totalMs: sentences.reduce((sum, s) => sum + s.ms, 0),
  };
}
