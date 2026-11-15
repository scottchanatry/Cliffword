/**
 * Helpers shared by the story and lyric sessions: settings, priors, seeded randomness,
 * loose text comparison, hints and small view builders. Pure and language-neutral: words
 * always come from LanguagePack.segment().
 */
import type { LanguagePack } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { LearnerEvent } from '../learner/types';
import { lexemeKey } from '../learner/types';
import type { PriorFn } from '../learner/model';
import { PlacementTracker, rankOfFromPack } from '../learner/placement';
import { DEFAULT_DIFFICULTY_OPTIONS } from '../learner/difficulty';
import type { Alignment } from '../speaking/align';
import { looseKey, normOf } from '../lyrics/text';
import { DEFAULT_ACCENT_MARKS, needsLeadingSpace } from '../scoring/text';
import type { AlignmentView, PriorSpec, SessionSettings, TextMode } from './types';

/**
 * Defaults, from the brief: neutral register first (street is taught side by side once
 * chosen), every register pack of the language pack, explicit lyrics ON by default, text
 * fading per word (auto), the derived speech rate, native-language answers allowed (a
 * zero-knowledge learner may answer in their own language and hears the target phrase).
 */
export const DEFAULT_SESSION_SETTINGS: Readonly<SessionSettings> = Object.freeze({
  register: 'neutral',
  regions: Object.freeze([]) as readonly string[],
  showExplicit: true,
  textMode: 'auto',
  speechRateBias: 1,
  nativeAnswersAllowed: true,
}) as Readonly<SessionSettings>;

const TEXT_MODES: readonly TextMode[] = ['auto', 'all_text', 'all_tiles'];

/**
 * Settings over the defaults. Unknown or invalid values fall back to the default (a
 * non-positive or non-finite speechRateBias counts as 1); the result is a fresh, plain
 * object safe to store in a snapshot.
 */
export function resolveSessionSettings(input: Partial<SessionSettings> = {}, base: SessionSettings = DEFAULT_SESSION_SETTINGS): SessionSettings {
  const o: SessionSettings = { ...base, regions: [...base.regions] };
  if (input.register === 'neutral' || input.register === 'street') o.register = input.register;
  if (Array.isArray(input.regions)) o.regions = input.regions.filter((r): r is string => typeof r === 'string' && r !== '');
  if (typeof input.showExplicit === 'boolean') o.showExplicit = input.showExplicit;
  if (input.textMode && TEXT_MODES.includes(input.textMode)) o.textMode = input.textMode;
  if (typeof input.speechRateBias === 'number' && Number.isFinite(input.speechRateBias) && input.speechRateBias > 0) {
    o.speechRateBias = input.speechRateBias;
  }
  if (typeof input.nativeAnswersAllowed === 'boolean') o.nativeAnswersAllowed = input.nativeAnswersAllowed;
  return o;
}

/**
 * The speech rate to play at: the learner model's rate times the learner's bias times the
 * slow-down of "más despacio" for this sentence, kept inside the difficulty module's
 * hard limits (never slower than 60% or faster than 110% of natural; slower distorts
 * speech) unless the slow-down itself asks for less, down to `floor`.
 */
export function effectiveRate(derived: number, bias: number, slowFactor: number, floor: number): number {
  const lim = DEFAULT_DIFFICULTY_OPTIONS.speechRateLimits;
  const d = Number.isFinite(derived) && derived > 0 ? derived : 1;
  const base = Math.min(lim.max, Math.max(lim.min, d * (Number.isFinite(bias) && bias > 0 ? bias : 1)));
  if (!(slowFactor < 1) || !(slowFactor > 0)) return base;
  return Math.max(Math.min(floor, base), base * slowFactor);
}

/**
 * The prior function for a prior spec: brandNew is PlacementTracker.brandNew over the
 * pair's cognates; placement replays the tracker and builds its prior from the pack's
 * frequency ranks and the cognates; default is undefined (LearnerModel's own default).
 */
export function buildPrior(spec: PriorSpec, pack: Pick<LanguagePack, 'code' | 'frequencyRank'>, pair: Pick<PairPack, 'target' | 'cognates'>): PriorFn | undefined {
  const cognates = [...pair.cognates].map((lemma) => lexemeKey(pair.target, lemma));
  if (spec.kind === 'brandNew') return PlacementTracker.brandNew(cognates);
  if (spec.kind === 'placement') return PlacementTracker.restore(spec.placement).prior(rankOfFromPack(pack), cognates);
  return undefined;
}

/** mulberry32: a small, fast, seeded PRNG (the mock model uses the same one). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for step `n` of a session seeded with `seed` (distinct, reproducible, 32-bit). */
export function seedFor(seed: number, n: number): number {
  return (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(n + 1, 0xc2b2ae35)) >>> 0;
}

/** Fisher-Yates shuffle with a seeded PRNG (a copy; the input is unchanged). */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i] as T;
    out[i] = out[j] as T;
    out[j] = t;
  }
  return out;
}

type TextPack = Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>;

/** Loose keys of the words and numbers of a text, joined by spaces: case, accents and apostrophes ignored. */
export function looseText(pack: TextPack, text: string): string {
  return pack
    .segment(text)
    .filter((s) => s.kind === 'word' || s.kind === 'number')
    .map((s) => looseKey(pack, normOf(pack, s), DEFAULT_ACCENT_MARKS))
    .filter(Boolean)
    .join(' ');
}

/** The two texts are the same words once case, accents, apostrophes and punctuation are ignored. */
export function sameWords(pack: TextPack, a: string, b: string): boolean {
  const ka = looseText(pack, a);
  return ka !== '' && ka === looseText(pack, b);
}

/**
 * The hint for the hint rung: the first letters of the first hidden word. Two letters
 * (one for words of three letters or fewer) carry the first sound in most alphabetic
 * spellings (digraphs such as ch, ll, qu, th included) without giving the word away; a
 * syllabic or logographic script loses only its first character. Counted in code
 * points.
 */
export function hintFor(word: string, letters = 2, shortWord = 3): string {
  const chars = Array.from(word.trim());
  const n = chars.length <= shortWord ? 1 : letters;
  return chars.slice(0, Math.max(1, n)).join('');
}

/** An alignment (alignTranscript) as a view: landed words and the "Understood N of M" text. */
export function alignmentView(a: Alignment): AlignmentView {
  return { understood: a.understood, total: a.total, ui: a.ui, words: a.words.map((w) => ({ text: w.text, landed: w.outcome === 'landed' })) };
}

/** Lexeme key of a word in a text: the chosen analysis's lemma, else its normalized form. */
export function keyFor(pack: Pick<LanguagePack, 'code'>, lemma: string | undefined, norm: string): string {
  return lexemeKey(pack.code, lemma ?? norm);
}

/** Events stamped and filtered: keyless events are dropped. */
export function cleanEvents(events: readonly LearnerEvent[]): LearnerEvent[] {
  return events.filter((e) => typeof e.key === 'string' && e.key !== '' && Number.isFinite(e.at));
}

/** A deep copy of plain data (snapshots, screens). */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Credited speaking time is added only for finite, positive lengths. */
export function finitePositive(x: number | undefined): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * The space to put between a text and what follows it: ' ' when needsLeadingSpace says
 * so (after a word or a full stop in a language written with spaces), '' otherwise (an
 * empty text, a trailing space, a script written without spaces such as Japanese).
 */
export function leadAfter(text: string): string {
  return needsLeadingSpace(text) ? ' ' : '';
}

/** Sentences joined into one text, with a space between them only where the script uses one. */
export function joinSentences(parts: readonly string[]): string {
  let out = '';
  for (const p of parts) out += (out ? leadAfter(out) : '') + p;
  return out;
}
