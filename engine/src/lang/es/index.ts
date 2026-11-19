/**
 * Spanish language pack.
 *
 * createSpanishPack() wires the segmenter, normalizer, analyzer, inflector and frequency
 * list into the LanguagePack contract. Correction rules and slang register packs are
 * data supplied by the caller (their own modules); by default there are none.
 */
import type { CorrectionRule, LanguagePack, RegisterPack, SpokenCommandEntry, StoryLanguageData } from '../types';
import { createAnalyzer } from './analyze';
import { chooseSpanishAnalysis } from './choose';
import { attachClitic, splitClitics } from './clitics';
import { SPANISH_COMMANDS, SPANISH_FILLERS, SPANISH_STREET_ENDINGS } from './commands';
import { inflect } from './inflect';
import { LEMMAS_BY_FREQUENCY, frequencyRank } from './lexicon';
import { normalize, stripAccents } from './normalize';
import { createSegmenter } from './segment';
import { SPANISH_ABBREVIATIONS, SPANISH_STORY_DATA } from './story';

export interface SpanishPackOptions {
  rules?: readonly CorrectionRule[];
  registers?: readonly RegisterPack[];
  /** Overrides SPANISH_SCORING_PREFIX. */
  scoringPrefix?: string;
  /** Overrides SPANISH_COMMANDS (spoken commands for the speaking module). */
  commands?: readonly SpokenCommandEntry[];
  /** Overrides SPANISH_FILLERS (words dropped around a spoken command). */
  fillers?: readonly string[];
  /** Overrides SPANISH_STREET_ENDINGS (regular street endings for transcript alignment). */
  streetEndings?: readonly (readonly [string, string])[];
  /** Overrides SPANISH_ABBREVIATIONS (no sentence end after "Sr."). */
  abbreviations?: readonly string[];
  /** Overrides SPANISH_REPLY_CUE (who answers a character's question, for the judge). */
  replyCue?: Readonly<Partial<Record<'m' | 'f', string>>>;
  /** Overrides SPANISH_STORY_DATA (story-generation prompt wording and output checks). */
  story?: StoryLanguageData;
}

/** Fixed context for scoring a Spanish sentence; the prefix measured in the proof test. */
export const SPANISH_SCORING_PREFIX = 'Frase en español:\n';

/**
 * Who answers a character's question (LanguagePack.replyCue). Measured on Qwen3-1.7B after
 * "¡Buenos días, vecino! ¿Cómo estás?": a man's "Estoy cansado, gracias." went from a gender
 * hint (+2.71) to ok (-4.83) with 'Él responde:', and a woman's "cansada" stayed ok.
 */
export const SPANISH_REPLY_CUE: Readonly<Record<'m' | 'f', string>> = Object.freeze({ m: 'Él responde:', f: 'Ella responde:' });

/**
 * Clipped forms in register packs that start or end with an apostrophe ('tá, pa'),
 * so the segmenter keeps the apostrophe inside the word.
 */
export function registerClips(registers: readonly RegisterPack[]): { leading: string[]; trailing: string[] } {
  const leading: string[] = [];
  const trailing: string[] = [];
  for (const reg of registers) {
    for (const e of reg.entries) {
      for (const f of [e.form, e.norm]) {
        const n = normalize(f);
        if (n.startsWith("'")) leading.push(n);
        if (n.endsWith("'")) trailing.push(n);
      }
    }
  }
  return { leading, trailing };
}

/**
 * Build the Spanish LanguagePack (code "es").
 *
 * Method: the segmenter learns the clipped forms of the given register packs; the
 * analyzer adds their slang forms (each its own lemma, with the part of speech of its
 * neutral equivalent, or the entry's own pos); everything else is the shared standard
 * lexicon. chooseAnalysis is chooseSpanishAnalysis (homographs in context: la comida,
 * he estado, ella vino). foldAccents is stripAccents (accents and diaeresis go, ñ stays); frequencyList
 * is LEMMAS_BY_FREQUENCY. attachClitic and splitClitics (clitics.ts) attach enclitic
 * pronouns keeping the host's stress (leyendo + lo -> leyéndolo) and split them off again
 * (dámelo -> da + me, lo), for the move rules. commands defaults to SPANISH_COMMANDS,
 * fillers to SPANISH_FILLERS and streetEndings to SPANISH_STREET_ENDINGS; abbreviations to
 * SPANISH_ABBREVIATIONS and story (story-generation data) to SPANISH_STORY_DATA.
 * Defaults to no correction rules and no registers.
 */
export function createSpanishPack(opts: SpanishPackOptions = {}): LanguagePack {
  const rules = opts.rules ?? [];
  const registers = opts.registers ?? [];
  const clips = registerClips(registers);
  const segment = createSegmenter({ leadingClips: clips.leading, trailingClips: clips.trailing });
  const analyze = createAnalyzer(registers);
  return {
    code: 'es',
    segment,
    normalize,
    foldAccents: stripAccents,
    analyze,
    chooseAnalysis: chooseSpanishAnalysis,
    inflect,
    frequencyRank,
    frequencyList: LEMMAS_BY_FREQUENCY,
    rules,
    registers,
    scoringPrefix: opts.scoringPrefix ?? SPANISH_SCORING_PREFIX,
    attachClitic,
    splitClitics: (word: string) => splitClitics(word),
    commands: opts.commands ?? SPANISH_COMMANDS,
    fillers: opts.fillers ?? SPANISH_FILLERS,
    streetEndings: opts.streetEndings ?? SPANISH_STREET_ENDINGS,
    abbreviations: opts.abbreviations ?? SPANISH_ABBREVIATIONS,
    replyCue: opts.replyCue ?? SPANISH_REPLY_CUE,
    story: opts.story ?? SPANISH_STORY_DATA,
  };
}

export { normalize, stripAccents } from './normalize';
export { segment, createSegmenter, DEFAULT_LEADING_CLIPS, DEFAULT_TRAILING_CLIPS } from './segment';
export { conjugate, conjugateForm, featuresSlot, slotFeatures } from './conjugate';
export { inflect, paradigm, pluralize, feminine } from './inflect';
export { analyze, createAnalyzer, DEFAULT_ANALYZE_OPTIONS } from './analyze';
export { chooseSpanishAnalysis, VERB_CUE_ADVERBS, VERB_CUE_CONJUNCTIONS } from './choose';
export { attachClitic, splitClitics } from './clitics';
export { SPANISH_COMMANDS, SPANISH_FILLERS, SPANISH_STREET_ENDINGS } from './commands';
export {
  SPANISH_ABBREVIATIONS,
  SPANISH_LEAK_PATTERNS,
  SPANISH_META_WORDS,
  SPANISH_PREAMBLE_WORDS,
  SPANISH_PROMPT_TEXT,
  SPANISH_REGION_NAMES,
  SPANISH_STORY_DATA,
  SPANISH_STORY_EXAMPLES,
  SPANISH_STORY_LABELS,
  SPANISH_STORY_PROMPT_TEXT,
} from './story';
export { frequencyRank, LEXICON, LEMMAS_BY_FREQUENCY, lexiconRows } from './lexicon';
export type { LexRow, LexGender } from './lexicon';
