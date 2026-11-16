/**
 * Zero knowledge to generated story: when the session plays the pair's starter story,
 * when it generates on a bridge vocabulary, and when it generates on the learner's own
 * knowledge.
 *
 * Stages (handoverStage), decided before every story sentence from data:
 * - 'starter': a zero-knowledge learner (startMode 'brand_new', or no evidence at all)
 *   hears the pair's canned starter story first (PairPack.starter: cognates plus a few
 *   taught function words), the first `starterSentences` of it ('all' by default). Canned
 *   mode (no model) never leaves it: after the starter it plays the unused placement
 *   ladder sentences, and only then cycles the starter, because it has nothing to
 *   generate with.
 * - 'bridge': generation, while the learner knows fewer than `strictFrom` lexemes at
 *   pKnown(meaning) >= knownAt. The learner model gains evidence slowly (a word read in
 *   eight starter sentences is still near 0.5), so the known-word band cannot hold on
 *   the learner's own pKnown yet. The band is held on the bridge vocabulary instead:
 *   the starter's taught words, every word of its sentences (each was met with a gloss),
 *   the pair's cognates ("probably known", the brief's zero-knowledge start) and the
 *   words introduced as targets since (bridgeFamiliar). Those count as known in the band
 *   check (SelectOptions.familiarCredit) and fill the prompt's vocabulary line, and the
 *   new words the bridge introduces are content words (bridgeTargetPos) outside it.
 * - 'free': generation on the learner's own knowledge, the band on pKnown alone.
 *
 * The thresholds are data (DEFAULT_HANDOVER_OPTIONS, re-exported from config.ts).
 * Measured on Qwen3-1.7B (proof/ENGINE_REAL_MODEL.md, "Story generation at every level"):
 * the early learner (about 200 lexemes at 0.9) found an in-band candidate on its own
 * knowledge in most steps, so `strictFrom` sits below that.
 */
import type { LanguagePack, Pos } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { LearnerView } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { knownLexemeCount } from '../story/next';

export type StoryStage = 'starter' | 'bridge' | 'free';

/** Tunable numbers of the hand-over. See DEFAULT_HANDOVER_OPTIONS for the reasoning. */
export interface HandoverOptions {
  /** Starter sentences a zero-knowledge learner hears before generation ('all' = the whole starter story). */
  starterSentences: number | 'all';
  /** A lexeme counts as known for the hand-over from this pKnown(meaning). */
  knownAt: number;
  /** Generation runs on the learner's own knowledge (no bridge) from this many known lexemes on. */
  strictFrom: number;
  /** Parts of speech of the new words the bridge introduces. */
  bridgeTargetPos: readonly Pos[];
  /** Introduced words remembered for the bridge vocabulary (the most recent ones). */
  introducedKeep: number;
}

/**
 * Defaults:
 * - starterSentences 'all': the starter is one short scene (eight sentences in en-es);
 *   cutting it would leave the learner without its taught words.
 * - knownAt 0.9 and strictFrom 150: the simulated early learner (reach 300, about 200
 *   lexemes at 0.9) found in-band candidates on its own knowledge in most steps on the
 *   real model; at 150 known lexemes most of the top-150 frequency words, which make up
 *   the bulk of a beginner sentence, are known. Judgement between the two; calibrate
 *   from learner logs.
 * - bridgeTargetPos NOUN, VERB, ADJ, ADV: a function word as the next tag (the Spanish
 *   relative pronoun) made Qwen3-1.7B answer with that one word, as a question or as a
 *   two-word fragment; content words were used in 12 of 12 candidates.
 * - introducedKeep 200: the bridge lasts until strictFrom; every introduced word stays usable.
 */
export const DEFAULT_HANDOVER_OPTIONS: Readonly<HandoverOptions> = Object.freeze({
  starterSentences: 'all',
  knownAt: 0.9,
  strictFrom: 150,
  bridgeTargetPos: Object.freeze(['NOUN', 'VERB', 'ADJ', 'ADV']) as readonly Pos[],
  introducedKeep: 200,
});

export interface HandoverInput {
  pack: LanguagePack;
  pair: PairPack;
  learner: LearnerView;
  now: number;
  /** Starter sentences already played. */
  starterUsed: number;
  /** The learner starts from zero (startMode 'brand_new', or no evidence at all). */
  zeroStart: boolean;
  /** A model is available (canned mode has none). */
  hasModel: boolean;
  options?: Partial<HandoverOptions>;
}

/** Number of starter sentences a zero-knowledge learner hears first. */
export function starterLimit(pair: PairPack, options: Partial<HandoverOptions> = {}): number {
  const o: HandoverOptions = { ...DEFAULT_HANDOVER_OPTIONS, ...options };
  const total = pair.starter?.sentences.length ?? 0;
  return o.starterSentences === 'all' ? total : Math.min(total, Math.max(0, Math.floor(o.starterSentences)));
}

/** The stage of the next story sentence (see the module comment). */
export function handoverStage(i: HandoverInput): StoryStage {
  const o: HandoverOptions = { ...DEFAULT_HANDOVER_OPTIONS, ...i.options };
  if (i.zeroStart && i.starterUsed < starterLimit(i.pair, o)) return 'starter';
  if (!i.hasModel) return 'starter';
  return knownLexemeCount(i.pack, i.learner, i.now, o.knownAt) >= o.strictFrom ? 'free' : 'bridge';
}

/**
 * The bridge vocabulary as lexeme keys: the starter's taught words, the lemmas of every
 * word of its sentences (names aside), the pair's cognates and `introduced`, without
 * duplicates. Taught and story words come first (they make the prompt's vocabulary line).
 */
export function bridgeFamiliar(pack: LanguagePack, pair: PairPack, introduced: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    const k = lexemeOf(key);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  const st = pair.starter;
  for (const l of st?.taught ?? []) add(lexemeKey(pack.code, l));
  for (const s of st?.sentences ?? []) {
    for (const seg of pack.segment(s.text)) {
      if (seg.kind !== 'word') continue;
      const a = pack.analyze(seg.norm || pack.normalize(seg.text))[0];
      if (a && a.pos !== 'PROPN') add(lexemeKey(pack.code, a.lemma));
    }
  }
  for (const k of introduced) add(k);
  // Cognates most frequent first (the vocabulary line lists the first ones).
  const rank = (lemma: string) => pack.frequencyRank(lemma) ?? Number.MAX_SAFE_INTEGER;
  for (const c of [...pair.cognates].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))) add(lexemeKey(pack.code, c));
  return out;
}
