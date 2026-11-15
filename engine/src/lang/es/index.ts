/**
 * Spanish language pack.
 *
 * createSpanishPack() wires the segmenter, normalizer, analyzer, inflector and frequency
 * list into the LanguagePack contract. Correction rules and slang register packs are
 * data supplied by the caller (their own modules); by default there are none.
 */
import type { CorrectionRule, LanguagePack, RegisterPack } from '../types';
import { createAnalyzer } from './analyze';
import { chooseSpanishAnalysis } from './choose';
import { inflect } from './inflect';
import { LEMMAS_BY_FREQUENCY, frequencyRank } from './lexicon';
import { normalize, stripAccents } from './normalize';
import { createSegmenter } from './segment';

export interface SpanishPackOptions {
  rules?: readonly CorrectionRule[];
  registers?: readonly RegisterPack[];
}

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
 * is LEMMAS_BY_FREQUENCY. Defaults to no correction rules and no registers.
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
  };
}

export { normalize, stripAccents } from './normalize';
export { segment, createSegmenter, DEFAULT_LEADING_CLIPS, DEFAULT_TRAILING_CLIPS } from './segment';
export { conjugate, conjugateForm, featuresSlot, slotFeatures } from './conjugate';
export { inflect, paradigm, pluralize, feminine } from './inflect';
export { analyze, createAnalyzer, DEFAULT_ANALYZE_OPTIONS } from './analyze';
export { chooseSpanishAnalysis, VERB_CUE_ADVERBS } from './choose';
export { frequencyRank, LEXICON, LEMMAS_BY_FREQUENCY, lexiconRows } from './lexicon';
export type { LexRow, LexGender } from './lexicon';
