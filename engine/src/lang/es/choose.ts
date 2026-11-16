/**
 * Spanish analysis choice in context (LanguagePack.chooseAnalysis).
 *
 * The analyzer orders a word's analyses without context: a noun or adjective in its own
 * dictionary form first (comida, vino, trabajo), then by lemma frequency. The previous
 * word settles the common homographs:
 * - after a determiner or a numeral, a noun, else an adjective (la comida, las comidas,
 *   dos comidas);
 * - after haber, the masculine singular participle of a compound tense (he estado, ha
 *   hecho; "hay comida" keeps the noun, because a compound-tense participle never takes
 *   -a);
 * - after a pronoun, a name, or no/ya/nunca/también/tampoco/siempre, a finite verb
 *   (ella vino, me pregunta, Marta vino, no trabajo);
 * - after a conjunction that opens a clause (que, si, cuando, porque, aunque, ojalá,
 *   mientras), a finite verb: "quieren que estudio medicina" is the verb, so the mood rule
 *   can offer "estudie";
 * - at a sentence start, a finite verb over a bare noun or adjective (Vivo en Madrid,
 *   Trabajo en casa): Spanish drops subject pronouns, while a noun usually takes a
 *   determiner.
 * Otherwise the first analysis stands (bebo vino: the noun).
 */
import type { Analysis, AnalysisContext } from '../types';

/** Adverbs after which a noun/verb homograph is read as the verb. */
export const VERB_CUE_ADVERBS: readonly string[] = ['no', 'ya', 'nunca', 'también', 'tampoco', 'siempre'];

/** Conjunctions that open a clause, after which a noun/verb homograph is read as the verb. */
export const VERB_CUE_CONJUNCTIONS: readonly string[] = ['que', 'si', 'cuando', 'porque', 'aunque', 'ojalá', 'mientras'];

function isFinite(a: Analysis): boolean {
  return (a.pos === 'VERB' || a.pos === 'AUX') && (a.features.mood !== undefined || a.features.form === 'fin');
}

function isCompoundParticiple(a: Analysis): boolean {
  return (
    (a.pos === 'VERB' || a.pos === 'AUX') &&
    a.features.form === 'part' &&
    (a.features.gender ?? 'm') === 'm' &&
    (a.features.number ?? 's') === 's'
  );
}

export function chooseSpanishAnalysis(analyses: readonly Analysis[], context: AnalysisContext): Analysis | undefined {
  const first = analyses[0];
  if (!first) return undefined;
  const find = (test: (a: Analysis) => boolean) => analyses.find(test);
  const prev = context.prev;
  if (prev) {
    if (prev.pos === 'DET' || prev.pos === 'NUM') {
      return find((a) => a.pos === 'NOUN') ?? find((a) => a.pos === 'ADJ') ?? first;
    }
    if (prev.lemma === 'haber' && (prev.pos === 'AUX' || prev.pos === 'VERB')) return find(isCompoundParticiple) ?? first;
    if (
      prev.pos === 'PRON' ||
      prev.pos === 'PROPN' ||
      (prev.pos === 'ADV' && VERB_CUE_ADVERBS.includes(prev.lemma)) ||
      (prev.pos === 'CONJ' && VERB_CUE_CONJUNCTIONS.includes(prev.lemma))
    ) {
      return find(isFinite) ?? first;
    }
    return first;
  }
  if (context.sentenceStart && (first.pos === 'NOUN' || first.pos === 'ADJ')) return find(isFinite) ?? first;
  return first;
}
