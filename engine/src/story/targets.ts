/**
 * Choosing target words: the lexemes the next story sentence should introduce (one or
 * two new words) or, when nothing new is left, practice.
 *
 * Method
 * ------
 * The candidates are lexeme keys in frequency order (most frequent first), usually the
 * pack's frequency list (see frequencyLexemeKeys in packs.ts). They are taken in four
 * passes until `count` targets are found:
 * 1. new: lexemes the learner does not understand yet (pKnown(meaning) < newBelow),
 *    most frequent first. These are the next words worth learning, so the learner's
 *    frontier moves down the frequency list.
 * 2. extra: lexemes from `extra` that are new in the same sense, in the given order
 *    (slang lexemes of the register packs, words from texts the learner brought). This
 *    is what a learner who knows the whole list still has to learn.
 * 3. practice: lexemes the learner understands (pKnown(meaning) >= knownAt) but cannot
 *    yet produce (pKnown(speaking) < practiceBelow), weakest speaking first.
 * 4. review: every remaining lexeme, least known for meaning first.
 * Keys in `exclude` (targets used in the last few sentences) are skipped in every pass,
 * and no key is returned twice. The result therefore holds min(count, usable keys)
 * entries: there is always material while any candidate is left, at every level.
 * Deterministic: ties keep candidate order.
 */
import type { LearnerView } from '../learner/types';
import { lexemeOf } from '../learner/types';

/** Why a key was chosen. */
export type TargetReason = 'new' | 'extra' | 'practice' | 'review';

export interface TargetChoice {
  /** Lexeme key, e.g. "es:comprar". */
  key: string;
  reason: TargetReason;
  /** pKnown(meaning) at `now`. */
  pMeaning: number;
  /** pKnown(speaking) at `now`. */
  pSpeaking: number;
}

/** Tunable numbers of chooseTargets. */
export interface TargetOptions {
  /** Number of targets to return. The brief: one or two new words per sentence. */
  count: number;
  /** A lexeme is new while pKnown(meaning) is below this. */
  newBelow: number;
  /** A lexeme counts as understood for practice from this pKnown(meaning) on. */
  knownAt: number;
  /** An understood lexeme needs production practice while pKnown(speaking) is below this. */
  practiceBelow: number;
}

/** Defaults; to be calibrated from usage. */
export const DEFAULT_TARGET_OPTIONS: Readonly<TargetOptions> = Object.freeze({
  // One new word per sentence; the caller asks for two when newWordsPerSentence allows.
  count: 1,
  // Same line as SelectOptions.unknownBelow: below 0.5 the word is more likely unknown.
  newBelow: 0.5,
  // Understood with some confidence before production practice makes sense.
  knownAt: 0.8,
  // Same line as RungOptions.hintBelow: below it the learner cannot yet answer freely.
  practiceBelow: 0.6,
});

export interface TargetContext {
  learner: LearnerView;
  /** Time for pKnown, ms since epoch. */
  now: number;
  /** Candidate lexeme keys in frequency order (form keys are reduced to their lexeme). */
  frequencyKeys: Iterable<string>;
  /** Lexemes beyond the frequency list (slang, words from the learner's own texts). */
  extra?: Iterable<string>;
  /** Keys never returned (recent targets). */
  exclude?: Iterable<string>;
  options?: Partial<TargetOptions>;
}

/**
 * Choose the target lexemes for the next sentence (see the module comment for the
 * method). Returns at most options.count choices, in pass order.
 */
export function chooseTargets(ctx: TargetContext): TargetChoice[] {
  const o: TargetOptions = { ...DEFAULT_TARGET_OPTIONS, ...ctx.options };
  const count = Math.max(0, Math.floor(o.count));
  const out: TargetChoice[] = [];
  if (count === 0) return out;
  const taken = new Set<string>([...(ctx.exclude ?? [])].map(lexemeOf));
  const look = (key: string): Omit<TargetChoice, 'reason'> => ({
    key,
    pMeaning: ctx.learner.pKnown(key, 'meaning', ctx.now),
    pSpeaking: ctx.learner.pKnown(key, 'speaking', ctx.now),
  });
  const take = (c: Omit<TargetChoice, 'reason'>, reason: TargetReason): boolean => {
    taken.add(c.key);
    out.push({ ...c, reason });
    return out.length >= count;
  };

  const listed: string[] = [];
  const seen = new Set<string>();
  for (const k of ctx.frequencyKeys) {
    const key = lexemeOf(k);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    listed.push(key);
  }

  // 1. New lexemes from the frequency list, most frequent first.
  for (const key of listed) {
    if (taken.has(key)) continue;
    const c = look(key);
    if (c.pMeaning < o.newBelow && take(c, 'new')) return out;
  }
  // 2. New lexemes beyond the list.
  for (const k of ctx.extra ?? []) {
    const key = lexemeOf(k);
    if (!key || taken.has(key)) continue;
    const c = look(key);
    if (c.pMeaning < o.newBelow && take(c, 'extra')) return out;
  }
  // 3. Understood but not yet produced, weakest speaking first.
  const rest = listed.filter((k) => !taken.has(k)).map(look);
  const practice = rest
    .filter((c) => c.pMeaning >= o.knownAt && c.pSpeaking < o.practiceBelow)
    .sort((a, b) => a.pSpeaking - b.pSpeaking);
  for (const c of practice) if (take(c, 'practice')) return out;
  // 4. Everything else, least known first.
  const review = rest.filter((c) => !taken.has(c.key)).sort((a, b) => a.pMeaning - b.pMeaning);
  for (const c of review) if (take(c, 'review')) return out;
  return out;
}
