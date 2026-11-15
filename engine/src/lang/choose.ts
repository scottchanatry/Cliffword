/**
 * Choosing one analysis per word in context, through the LanguagePack contract only
 * (language-neutral). Story selection, cliff picking and the correction generator all
 * key words through this, so a word gets the same lexeme everywhere.
 *
 * Method, per word segment, left to right:
 * 1. A word capitalized away from a sentence start takes a PROPN analysis when the pack
 *    offers one.
 * 2. Otherwise pack.chooseAnalysis(analyses, { prev, sentenceStart }) when the pack has
 *    it, else the first analysis (the pack's most likely one).
 * 3. prev is the chosen analysis of the previous word when only spaces separate the two;
 *    punctuation and numbers break the chain (a number passes on a NUM analysis). A
 *    capitalized word the pack does not know, away from a sentence start, passes on a
 *    PROPN analysis (a name), so "Marta vino" reads vino as a verb.
 */
import type { Analysis, LanguagePack, Segment } from './types';

const UPPER_RE = /\p{Lu}/u;
const LETTER_RE = /\p{L}/u;

/**
 * True if the first letter of `s` is uppercase and the word is not written all in
 * capitals (two or more letters, none lowercase: "AQUÍ" in a shouted sentence is no
 * sign of a name).
 */
export function firstLetterUpper(s: string): boolean {
  let first: boolean | undefined;
  let letters = 0;
  let lower = false;
  for (const ch of s) {
    if (!LETTER_RE.test(ch)) continue;
    letters++;
    if (first === undefined) first = UPPER_RE.test(ch);
    if (ch !== ch.toUpperCase()) lower = true;
  }
  return first === true && (letters < 2 || lower);
}

export interface WordContext {
  /** The word is capitalized away from a sentence start. */
  capitalizedMidSentence: boolean;
  sentenceStart: boolean;
  prev?: Analysis;
}

/** Pick an analysis for one word (steps 1 and 2 of the module comment). */
export function chooseAnalysisInContext(
  pack: Pick<LanguagePack, 'chooseAnalysis'>,
  analyses: readonly Analysis[],
  ctx: WordContext,
): Analysis | undefined {
  if (analyses.length === 0) return undefined;
  if (ctx.capitalizedMidSentence) {
    const propn = analyses.find((a) => a.pos === 'PROPN');
    if (propn) return propn;
  }
  if (pack.chooseAnalysis) {
    const context = ctx.prev ? { prev: ctx.prev, sentenceStart: ctx.sentenceStart } : { sentenceStart: ctx.sentenceStart };
    const chosen = pack.chooseAnalysis(analyses, context);
    if (chosen && analyses.includes(chosen)) return chosen;
  }
  return analyses[0];
}

/** One word segment with its analyses and the chosen one. */
export interface ChosenWord {
  segIndex: number;
  norm: string;
  analyses: Analysis[];
  /** undefined when the pack does not know the word. */
  chosen: Analysis | undefined;
  /** Capitalized away from a sentence start. */
  capitalizedMidSentence: boolean;
}

/**
 * Choose an analysis for every word segment of `segments` (see the module comment).
 * `starts[i]` says whether segment i opens a sentence. Returns one entry per word
 * segment, in order.
 */
export function chooseAnalysesInText(
  pack: Pick<LanguagePack, 'analyze' | 'normalize' | 'chooseAnalysis'>,
  segments: readonly Segment[],
  starts: readonly boolean[],
  analyze: (norm: string) => Analysis[] = (n) => pack.analyze(n),
): ChosenWord[] {
  const out: ChosenWord[] = [];
  let prev: Analysis | undefined;
  segments.forEach((seg, i) => {
    if (seg.kind === 'space') return;
    if (seg.kind === 'number') {
      prev = { lemma: seg.norm || seg.text, pos: 'NUM', features: {} };
      return;
    }
    if (seg.kind !== 'word') {
      prev = undefined;
      return;
    }
    const norm = seg.norm || pack.normalize(seg.text);
    const sentenceStart = starts[i] === true;
    const capitalizedMidSentence = !sentenceStart && firstLetterUpper(seg.text);
    const analyses = analyze(norm);
    const chosen = chooseAnalysisInContext(pack, analyses, {
      capitalizedMidSentence,
      sentenceStart,
      ...(prev && !sentenceStart ? { prev } : {}),
    });
    out.push({ segIndex: i, norm, analyses, chosen, capitalizedMidSentence });
    prev = chosen ?? (capitalizedMidSentence ? { lemma: norm, pos: 'PROPN', features: {} } : undefined);
  });
  return out;
}
