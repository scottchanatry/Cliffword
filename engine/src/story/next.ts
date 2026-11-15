/**
 * Generate the next story sentence: prompt the model for several candidates, clean
 * them, and keep the one that best fits the learner.
 *
 * Method
 * ------
 * 1. Build a continuation prompt from the last story sentences, the target words, the
 *    maximum sentence length and the register (buildContinuationPrompt).
 * 2. Sample `n` completions in one model call. Completion i uses seed + i, so the whole
 *    step is reproducible from `seed`.
 * 3. Clean every completion to one sentence (extractSentence) and rank them with
 *    selectSentence (recent sentences for repeat checks, prompt instructions for leak
 *    checks).
 * 4. If no accepted candidate falls inside the known-word band, retry once with the
 *    simpler prompt (easier wording, only the first target) and seeds seed + n ...
 *    seed + 2n - 1, then select over the candidates of both rounds together.
 * 5. Return the selection (best may still be outside the band: there is always a next
 *    sentence unless every candidate was rejected) with diagnostics, including the
 *    number of model calls.
 */
import type { LanguagePack } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { PairPack } from '../pair/types';
import type { DifficultyParams, LearnerView } from '../learner/types';
import { lexemeOf } from '../learner/types';
import type { Register } from './prompt';
import { buildContinuationPrompt, extractSentence, promptInstructionLines, storySentences } from './prompt';
import type { SelectOptions, Selection } from './select';
import { selectSentence } from './select';
import { wholeAtLeast } from './text';

/** Collaborators that stay the same from sentence to sentence. */
export interface NextSentenceDeps {
  pack: LanguagePack;
  learner: LearnerView;
  /** Enables native-word rejection and trailing-gloss cleanup. */
  pair?: PairPack;
}

/** Tunable numbers of generateNextSentence. */
export interface NextSentenceTuning {
  /** Candidates sampled per model call. */
  n: number;
  temperature: number;
  /** Temperature of the simpler retry (lower = safer, more common words). */
  retryTemperature: number;
  /** Retry once with the simpler prompt when nothing lands in the band. */
  retry: boolean;
  /** Generation stops at these strings. The prompt asks for one line. */
  stop: string[];
  /** maxTokens = ceil(maxWords x tokensPerWord) + extraTokens. */
  tokensPerWord: number;
  extraTokens: number;
  /** Story sentences shown in the prompt. */
  contextSentences: number;
  /** Recent story sentences checked for repeats. */
  previousSentences: number;
}

export const DEFAULT_NEXT_SENTENCE_TUNING: Readonly<NextSentenceTuning> = {
  n: 6,
  temperature: 0.8,
  retryTemperature: 0.6,
  retry: true,
  stop: ['\n'],
  // set from proof/RESULTS.md (tokens per Spanish word for the chosen model's tokenizer)
  tokensPerWord: 2,
  extraTokens: 8,
  contextSentences: 4,
  previousSentences: 8,
};

export interface NextSentenceOptions {
  /** Story so far (sentences, or one text). */
  story: string | readonly string[];
  /** Lexeme keys to introduce or practice. */
  targets: readonly string[];
  /** Surface words for the prompt; defaults to the lemma part of each target key. */
  targetWords?: readonly string[];
  params: DifficultyParams;
  /** Time for pKnown, ms since epoch. */
  now: number;
  /** Base seed for sampling. */
  seed: number;
  register?: Register;
  region?: string;
  tuning?: Partial<NextSentenceTuning>;
  select?: Partial<SelectOptions>;
}

/** One model call made while generating. */
export interface GenerationRound {
  prompt: string;
  simple: boolean;
  seed: number;
  temperature: number;
  raw: string[];
  cleaned: string[];
}

export interface NextSentenceDiagnostics {
  /** Number of LanguageModel calls made (1, or 2 after a retry). */
  modelCalls: number;
  retried: boolean;
  /** True when the best candidate is inside the known-word band. */
  inBand: boolean;
  rounds: GenerationRound[];
  /** Round (0-based) of each candidate, by candidate index in the selection. */
  candidateRound: number[];
}

export interface NextSentenceResult extends Selection {
  /** The chosen sentence, or null when every candidate was rejected. */
  sentence: string | null;
  diagnostics: NextSentenceDiagnostics;
}

/** Surface words for target keys: the lemma part of "es:comprar" is "comprar". */
export function targetWordsFromKeys(keys: readonly string[]): string[] {
  return keys.map((k) => {
    const lex = lexemeOf(k);
    const i = lex.indexOf(':');
    return i < 0 ? lex : lex.slice(i + 1);
  });
}

/** maxTokens for a sentence of at most `maxWords` words. */
export function maxTokensFor(maxWords: number, t: Pick<NextSentenceTuning, 'tokensPerWord' | 'extraTokens'>): number {
  return Math.ceil(wholeAtLeast(maxWords) * t.tokensPerWord) + t.extraTokens;
}

function hasInBand(sel: Selection): boolean {
  return sel.ranked.some((e) => e.accepted && e.inBand);
}

/**
 * Generate, clean and select the next story sentence (see the module comment).
 * Reproducible: the same model, inputs and seed give the same result.
 */
export async function generateNextSentence(
  model: LanguageModel,
  deps: NextSentenceDeps,
  opts: NextSentenceOptions,
): Promise<NextSentenceResult> {
  const t: NextSentenceTuning = { ...DEFAULT_NEXT_SENTENCE_TUNING, ...opts.tuning };
  const n = wholeAtLeast(t.n);
  const register = opts.register ?? 'neutral';
  const targetWords = opts.targetWords ?? targetWordsFromKeys(opts.targets);
  const sentences = storySentences(opts.story);
  const previous = sentences.slice(-Math.max(0, t.previousSentences));
  const maxWords = opts.params.sentenceWords.max;
  const extract = {
    nativeLexicon: deps.pair?.nativeLexicon,
    isTargetWord: (w: string) => deps.pack.analyze(deps.pack.normalize(w)).length > 0,
  };

  const rounds: GenerationRound[] = [];
  const candidates: string[] = [];
  const candidateRound: number[] = [];
  const instructions: string[] = [];

  const runRound = async (simple: boolean): Promise<Selection> => {
    const promptOpts = {
      targets: targetWords,
      maxWords,
      register,
      region: opts.region,
      simple,
      contextSentences: t.contextSentences,
    };
    const prompt = buildContinuationPrompt(sentences, promptOpts);
    const seed = opts.seed + rounds.length * n;
    const temperature = simple ? t.retryTemperature : t.temperature;
    const raw = await model.generate(prompt, {
      n,
      maxTokens: maxTokensFor(maxWords, t),
      temperature,
      stop: t.stop,
      seed,
    });
    const cleaned = raw.map((r) => extractSentence(r, extract));
    const round = rounds.length;
    rounds.push({ prompt, simple, seed, temperature, raw, cleaned });
    for (const c of cleaned) {
      candidates.push(c);
      candidateRound.push(round);
    }
    instructions.push(...promptInstructionLines(promptOpts, sentences.length === 0));
    return selectSentence(candidates, {
      pack: deps.pack,
      learner: deps.learner,
      now: opts.now,
      targets: opts.targets,
      params: opts.params,
      previous,
      pair: deps.pair,
      instructions,
      options: opts.select,
    });
  };

  let selection = await runRound(false);
  let retried = false;
  if (t.retry && !hasInBand(selection)) {
    retried = true;
    selection = await runRound(true);
  }
  return {
    ...selection,
    sentence: selection.best?.text ?? null,
    diagnostics: {
      modelCalls: rounds.length,
      retried,
      inBand: selection.best?.inBand ?? false,
      rounds,
      candidateRound,
    },
  };
}
