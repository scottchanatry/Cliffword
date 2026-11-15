/**
 * Native-language answers: the learner may answer in their own language (the brief:
 * "the app gives the target phrase to repeat"). Built on gaps/: findNativeGaps finds the
 * runs of native words, and each gap's best target candidate becomes the phrase to
 * repeat, with a native_gap learner event keyed like gapEvents.
 *
 * When the app knows what it expected (the cliff's actual words) and a gap's candidates
 * include one of its lemmas, the expected words themselves are the phrase to repeat, in
 * the right form ("market" at the cliff "llegó tarde al ___" gives "mercado"), and the
 * event is keyed by that lemma. Otherwise the phrase is the candidate as the pair pack
 * gives it (a dictionary form). The engine has no translator: a whole native sentence
 * gets the phrase translation the pair pack has, else its head word.
 */
import type { LanguagePack } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { LearnerEvent } from '../learner/types';
import type { GapOptions, NativeGap } from '../gaps/capture';
import { candidateLemma, findNativeGaps } from '../gaps/capture';
import { chooseAnalysesInText } from '../lang/choose';
import { lexemeKey } from '../learner/types';
import { sentenceStartFlags } from '../story/text';
import { needsLeadingSpace } from '../scoring/text';
import type { UiText } from './text';
import { spokenWords } from './text';

/** Options of nativeReply. `at` is required: it stamps the events. */
export interface NativeReplyOptions {
  /** When the learner said it (ms since epoch). */
  at: number;
  /** The target words the app expected (a cliff's actual words), if any. */
  expected?: string;
  /** Overrides for findNativeGaps. */
  gap?: Partial<GapOptions>;
  /**
   * Put between the phrases of several gaps in targetPhrase. Default: a space only where
   * the script uses one (needsLeadingSpace), so Spanish gets ' ' and Japanese ''.
   */
  phraseSeparator?: string;
  /** PairPack.ui key of the prompt to repeat ('cliff.repeatAloud'). */
  repeatKey?: string;
}

/** One native run and the target phrase offered for it. */
export interface NativePhrase {
  /** The native text exactly as said. */
  native: string;
  start: number;
  end: number;
  /** The target phrase to repeat; null when the pair pack has no candidate. */
  target: string | null;
  /** The pack's lemma behind `target` (for the learner key); null when there is none. */
  lemma: string | null;
  /** `target` is the app's expected words. */
  fromExpected: boolean;
}

export interface NativeReply {
  hasNative: boolean;
  /** Every content word of the reply is native (a whole answer in the native language). */
  allNative: boolean;
  gaps: NativeGap[];
  phrases: NativePhrase[];
  /** The target phrases joined by phraseSeparator; null when no gap has one. */
  targetPhrase: string | null;
  /** One native_gap event per phrase with a lemma, at options.at. */
  events: LearnerEvent[];
  /** "Now say it out loud" when there is a phrase to repeat; null otherwise. */
  ui: UiText | null;
}

type Pack = Pick<LanguagePack, 'code' | 'segment' | 'normalize' | 'analyze' | 'chooseAnalysis' | 'frequencyRank' | 'foldAccents'>;

/** Lemmas (and normalized forms) of the expected words, for matching gap candidates. */
function expectedLemmas(pack: Pack, expected: string): Set<string> {
  const segments = pack.segment(expected);
  const out = new Set<string>();
  for (const c of chooseAnalysesInText(pack, segments, sentenceStartFlags(segments))) {
    out.add(c.norm);
    if (c.chosen) out.add(c.chosen.lemma);
    for (const a of c.analyses) out.add(a.lemma);
  }
  return out;
}

/** The expected words as one phrase: from the first to the last word or number, punctuation trimmed. */
function trimmedExpected(pack: Pack, expected: string): string {
  const words = spokenWords(pack, expected);
  const first = words[0];
  const last = words[words.length - 1];
  return first && last ? expected.slice(first.start, last.end) : '';
}

/**
 * Native words in a reply and the target phrase to repeat for them (see the module
 * comment). A reply with no native word gives hasNative false, no phrase and no event.
 */
export function nativeReply(transcript: string, pack: LanguagePack, pair: PairPack, opts: NativeReplyOptions): NativeReply {
  const gaps = findNativeGaps(transcript, pack, pair, opts.gap);
  const expected = opts.expected !== undefined ? trimmedExpected(pack, opts.expected) : '';
  const lemmas = expected ? expectedLemmas(pack, expected) : new Set<string>();
  let expectedUsed = false;
  const phrases: NativePhrase[] = gaps.map((g) => {
    if (expected && !expectedUsed) {
      for (const c of g.candidates) {
        const lemma = candidateLemma(c, pack);
        if (lemmas.has(lemma) || lemmas.has(c)) {
          expectedUsed = true;
          return { native: g.text, start: g.start, end: g.end, target: expected, lemma, fromExpected: true };
        }
      }
    }
    const best = g.candidates[0];
    if (best === undefined || best === '') return { native: g.text, start: g.start, end: g.end, target: null, lemma: null, fromExpected: false };
    return { native: g.text, start: g.start, end: g.end, target: best, lemma: candidateLemma(best, pack), fromExpected: false };
  });
  const targets = phrases.map((p) => p.target).filter((t): t is string => t !== null);
  // Phrases joined with the given separator, else with a space only where the script uses
  // one (needsLeadingSpace: none after Japanese or Chinese text).
  const targetPhrase = targets.length
    ? targets.reduce((acc, t) => acc + (opts.phraseSeparator ?? (needsLeadingSpace(acc) ? ' ' : '')) + t)
    : null;
  const events: LearnerEvent[] = phrases
    .filter((p): p is NativePhrase & { lemma: string } => p.lemma !== null)
    .map((p) => ({ type: 'native_gap', key: lexemeKey(pack.code, p.lemma), at: opts.at }));
  const content = spokenWords(pack, transcript);
  const inGap = (start: number, end: number) => gaps.some((g) => start >= g.start && end <= g.end);
  const allNative = gaps.length > 0 && content.every((w) => inGap(w.start, w.end));
  return {
    hasNative: gaps.length > 0,
    allNative,
    gaps,
    phrases,
    targetPhrase,
    events,
    ui: targetPhrase !== null ? { key: opts.repeatKey ?? 'cliff.repeatAloud' } : null,
  };
}
