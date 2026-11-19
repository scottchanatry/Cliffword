/**
 * English -> Spanish pair pack: what an English speaker brings to Spanish (cognates,
 * false friends, English words to spot in replies), glosses both ways, correction
 * explanations and interface text.
 */
import { slangNorm, SPANISH_REGISTERS } from '../../lang/es/registers';
import type { RegisterPack } from '../../lang/types';
import type { LibraryStory, LibraryTrack, PairPack, StarterStory } from '../types';
import { COGNATES } from './cognates';
import { EXPLANATIONS } from './explanations';
import { FALSE_FRIENDS } from './falseFriends';
import { glossEs, toTargetEs } from './glossary';
import { NATIVE_LEXICON_WORDS } from './nativeLexicon';
import { EN_ES_STARTER } from './starter';
import { UI_STRINGS } from './ui';

// The authored series (Story flow content) live in ./stories, written by the series
// writers: EN_ES_TRACKS (all six experiences, picker order) and EN_ES_LIBRARY (the
// episodes). A pack created with library: null (or tracks: null) carries none and
// StorySession falls back to the generated flow.
import { EN_ES_LIBRARY, EN_ES_TRACKS } from './stories';

export interface EnEsPairPackOptions {
  /**
   * Slang register packs whose English glosses back up gloss() for slang lemmas
   * (janguear, 'tá, pa'). Defaults to SPANISH_REGISTERS; pass [] to disable.
   */
  registers: readonly RegisterPack[];
  /**
   * The canned first story (PairPack.starter): zero-knowledge sentences, canned mode
   * before the model is loaded, the placement ladder. Defaults to EN_ES_STARTER; pass
   * null for a pack without one (sessions then need a model to say anything).
   */
  starter: StarterStory | null;
  /**
   * The authored series (PairPack.library): the Story flow's content. Defaults to
   * EN_ES_LIBRARY; pass null for a pack without one (StorySession then plays the
   * generated flow).
   */
  library: readonly LibraryStory[] | null;
  /** The experiences of the picker (PairPack.tracks). Defaults to EN_ES_TRACKS; null for none. */
  tracks: readonly LibraryTrack[] | null;
}

export const DEFAULT_EN_ES_OPTIONS: EnEsPairPackOptions = {
  registers: SPANISH_REGISTERS,
  starter: EN_ES_STARTER,
  library: EN_ES_LIBRARY,
  tracks: EN_ES_TRACKS,
};

/**
 * Index the English glosses of slang entries by lemma and by norm (first entry wins,
 * in pack order), keyed with the slang normalization.
 */
export function slangGlossIndex(registers: readonly RegisterPack[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const pack of registers) {
    for (const e of pack.entries) {
      const en = e.gloss.en;
      if (!en) continue;
      for (const k of [slangNorm(e.lemma), slangNorm(e.norm)]) if (k && !out.has(k)) out.set(k, en);
    }
  }
  return out;
}

/**
 * Create the English -> Spanish pair pack.
 *
 * Method: cognates and the English lexicon become fresh Sets on each call (so no caller
 * can change another's copy); gloss() looks up the standard glossary first and falls
 * back to the English gloss of a slang lexeme from the register packs; toTarget() maps
 * an English word (inflected forms included: went, houses, walking) or a listed phrase
 * (hardware store) to Spanish lemmas; falseFriends maps each false-friend lemma to its
 * warning; explanations and interface strings are frozen copies; the series (tracks and
 * library) are shared, read-only data.
 */
export function createEnEsPairPack(opts: Partial<EnEsPairPackOptions> = {}): PairPack {
  const o: EnEsPairPackOptions = { ...DEFAULT_EN_ES_OPTIONS, ...opts };
  const slang = slangGlossIndex(o.registers);
  return {
    native: 'en',
    target: 'es',
    gloss: (lemma: string) => glossEs(lemma) ?? slang.get(slangNorm(lemma)),
    cognates: new Set(COGNATES),
    nativeLexicon: new Set(NATIVE_LEXICON_WORDS),
    toTarget: (nativeWord: string) => toTargetEs(nativeWord),
    falseFriends: Object.freeze(Object.fromEntries(FALSE_FRIENDS.map((f) => [f.es, f.warning]))),
    explanations: Object.freeze({ ...EXPLANATIONS }),
    ui: Object.freeze({ ...UI_STRINGS }),
    ...(o.starter ? { starter: o.starter } : {}),
    ...(o.library && o.library.length > 0 ? { library: o.library } : {}),
    ...(o.tracks && o.tracks.length > 0 ? { tracks: o.tracks } : {}),
  };
}

export { COGNATES } from './cognates';
export { FALSE_FRIENDS, falseFriend } from './falseFriends';
export type { FalseFriend } from './falseFriends';
export { NATIVE_LEXICON_WORDS, SPANISH_LOOKALIKES, parseWords } from './nativeLexicon';
export {
  EN_PHRASES_TO_ES,
  EN_TO_ES,
  ES_TO_EN,
  englishBaseCandidates,
  glossEs,
  normalizeEnglish,
  parseGlossLines,
  toTargetEs,
} from './glossary';
export { EN_IRREGULAR } from './glossaryEnEs';
export { EXPLANATIONS, EXPLANATION_KEYS } from './explanations';
export type { ExplanationKey } from './explanations';
export { UI_STRINGS } from './ui';
export { EN_ES_STARTER } from './starter';
export { EN_ES_LIBRARY, EN_ES_TRACKS } from './stories';
