/**
 * Learner model contract.
 *
 * Knowledge is tracked per item and per skill. An item is a lexeme (lemma) or a
 * specific form of it. Time is always passed in (ms since epoch) so everything is
 * deterministic and testable.
 */
import type { Features } from '../lang/types';

/** meaning: understands it; sound: recognizes it by ear; written: recognizes it as text; speaking: can produce it. */
export type Skill = 'meaning' | 'sound' | 'written' | 'speaking';
export const SKILLS: readonly Skill[] = ['meaning', 'sound', 'written', 'speaking'];

/** Key for a lexeme, e.g. "es:tener". */
export function lexemeKey(lang: string, lemma: string): string {
  return `${lang}:${lemma}`;
}

/** Key for a specific form, e.g. "es:tener#mood=ind|number=s|person=3|tense=pret". */
export function formKey(lang: string, lemma: string, features: Features): string {
  const parts = Object.entries(features)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${lexemeKey(lang, lemma)}#${parts.join('|')}` : lexemeKey(lang, lemma);
}

/** The lexeme key of a form key ("es:tener#..." -> "es:tener"). */
export function lexemeOf(key: string): string {
  const i = key.indexOf('#');
  return i < 0 ? key : key.slice(0, i);
}

/** Things the learner did. Each maps to evidence about one or more skills. */
export type LearnerEvent =
  /** Heard the word in context and moved on without help (weak evidence of sound + meaning). */
  | { type: 'heard'; key: string; at: number }
  /** Tapped a tile to hear the word again (sound not yet secure). */
  | { type: 'tap_rehear'; key: string; at: number }
  /** Held a tile to see the word (sound failed; tells us nothing about written). */
  | { type: 'hold_reveal'; key: string; at: number }
  /** Saw the word as text and moved on without help. */
  | { type: 'read'; key: string; at: number }
  /** Asked for the meaning (gloss) of the word. */
  | { type: 'gloss_lookup'; key: string; at: number }
  /** Produced the word at a cliff. credit from cliff scoring. rung = how much help was given. */
  | { type: 'cliff_answer'; key: string; at: number; credit: 'full' | 'partial' | 'none'; rung: CliffRung }
  /** Said "no sé" at a cliff for this target word. */
  | { type: 'cliff_skip'; key: string; at: number }
  /** Used the word correctly in free speech. */
  | { type: 'spoke_correct'; key: string; at: number }
  /** Used the word in free speech and a correction was asserted on it. */
  | { type: 'spoke_error'; key: string; at: number }
  /** Used a native-language word where this target word was needed. */
  | { type: 'native_gap'; key: string; at: number }
  /** Learner said they know this already (onboarding, or "I know this"). */
  | { type: 'marked_known'; key: string; at: number };

/** How a cliff is answered: pick from spoken options, free answer with a first-sound hint, free answer. */
export type CliffRung = 'options' | 'hint' | 'free';

/**
 * Continuous difficulty settings derived from the learner model. There are no level
 * modes; every field moves smoothly with what the learner knows and how they are doing.
 */
export interface DifficultyParams {
  /** Target sentence length in words. */
  sentenceWords: { min: number; max: number };
  /** Allowed share of known words per sentence (meaning skill). Stays near 0.95 to 0.98 at every level. */
  knownBand: { min: number; max: number };
  /** New lexemes to introduce per sentence; fractional means "every other sentence" etc. */
  newWordsPerSentence: number;
  /** Speech playback rate; 1 = natural speed. */
  speechRate: number;
  /** Number of words hidden at a cliff. */
  cliffWords: number;
  /** A word is shown as a tile (text hidden) when pKnown(sound) is at least this. */
  tileThreshold: number;
}

/** Read-only view of the learner model used by the rest of the engine. */
export interface LearnerView {
  /** Probability in [0, 1] that the learner has this skill for this item at time `now`. */
  pKnown(key: string, skill: Skill, now: number): number;
  /** Keys with any recorded evidence. */
  knownKeys(): Iterable<string>;
}
