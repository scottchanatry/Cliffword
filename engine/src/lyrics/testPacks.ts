/**
 * Test-only packs for the lyrics tests. Not exported from the module index.
 *
 * - cjkPack: a language without spaces between words. Each Han character is a word, so
 *   tests can check that nothing in the lyrics module splits on spaces.
 * - fixedLearner: a LearnerView with fixed probabilities.
 * - recordingModel: a model wrapper that records every call (contexts, scored text).
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { LearnerView, Skill } from '../learner/types';
import type { LanguageModel } from '../model/types';

const HAN_RE = /\p{Script=Han}/u;

function cjkSegment(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  for (const ch of text) {
    const kind: Segment['kind'] = /\s/u.test(ch) ? 'space' : HAN_RE.test(ch) || /\p{L}/u.test(ch) ? 'word' : /\p{N}/u.test(ch) ? 'number' : 'punct';
    out.push({ text: ch, norm: kind === 'space' ? '' : ch.toLowerCase(), start: i, end: i + ch.length, kind });
    i += ch.length;
  }
  return out;
}

export const cjkPack: LanguagePack = {
  code: 'zh',
  segment: cjkSegment,
  normalize: (w) => w.trim().toLowerCase(),
  analyze: () => [],
  inflect: () => undefined,
  frequencyRank: () => undefined,
  rules: [],
  registers: [],
};

/** A learner view with fixed probabilities per key and skill (fallback for the rest). */
export function fixedLearner(known: Record<string, Partial<Record<Skill, number>>>, fallback = 0): LearnerView {
  return {
    pKnown: (key, skill) => known[key]?.[skill] ?? fallback,
    knownKeys: () => Object.keys(known),
  };
}

/** One call made to a recorded model. */
export interface RecordedCall {
  method: 'scoreContinuation' | 'nextTokens' | 'generate';
  context: string;
  text?: string;
}

/** Wrap a model so every call (method, context, scored text) is recorded in `calls`. */
export function recordingModel(inner: LanguageModel): { model: LanguageModel; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const model: LanguageModel = {
    id: `${inner.id}+recorded`,
    scoreContinuation: (context, text) => {
      calls.push({ method: 'scoreContinuation', context, text });
      return inner.scoreContinuation(context, text);
    },
    nextTokens: (context, k) => {
      calls.push({ method: 'nextTokens', context });
      return inner.nextTokens(context, k);
    },
    generate: (prompt, opts) => {
      calls.push({ method: 'generate', context: prompt });
      return inner.generate(prompt, opts);
    },
  };
  return { model, calls };
}
