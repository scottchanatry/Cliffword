/**
 * Generate the next story sentence: prompt the model for several candidates, clean
 * them, reject the unusable ones and keep the one that best fits the learner.
 *
 * Method
 * ------
 * 1. Story lines: the last story sentences, each tagged with its key word (a StoryLine
 *    tag from the caller, such as the targets a generated sentence carried, or tagFor:
 *    its rarest word). Names: the caller's characters plus capitalized words the story
 *    uses as names (storyNames).
 * 2. Header: the level name for the learner's estimated vocabulary and a length hint for
 *    params.sentenceWords.max (pack data), the characters, the scene, and a vocabulary
 *    line (vocabularyFor) when the learner knows few words (fewer than vocabularyBelow
 *    lexemes at vocabularyKnownAt) or the caller gives familiar words (the bridge).
 * 3. Round 1 (targets): the continuation prompt ends with the target words as the next
 *    tag (buildStoryPrompt). `n` completions are sampled in one model call; completion i
 *    uses seed + i, so the whole step is reproducible from `seed`. Generation stops at
 *    the first sentence end (tuning.stop).
 * 4. Every completion is cleaned to one sentence (extractSentence with the pack's labels)
 *    and selectSentence ranks them (rejects first, then band, targets, novelty,
 *    continuity, length, unknown words), with the raw completion for the placeholder,
 *    list and heading checks.
 * 5. Round 2 (safe): when no accepted candidate is inside the band and retry is on, the
 *    same prompt prefix ends with a safe tag instead (safeTagFor: the caller's safeTag,
 *    else a content word the learner knows that the recent story has not used, picked by
 *    the seed, else the main character), `retryN` completions with seeds seed + n ...,
 *    at retryTemperature. Selection runs over both rounds together. Measured on
 *    Qwen3-1.7B: a running story locks into one pattern ("El X está en la casa."), every
 *    candidate becomes a near repeat, and a safe round tagged with the main character at
 *    a lower temperature repeated it again (2 of 8 early steps and 3 of 8 heritage steps
 *    ended with no sentence); a fresh known word moves the story on.
 * 6. Natural score, after each round: the `naturalTop` best accepted candidates (distinct
 *    texts) are scored by the model after the story (scoringContext); their mean
 *    log-probability per token enters the selection score (SelectOptions.naturalWeight),
 *    and one below SelectOptions.naturalFloor is rejected as unnatural and the next one
 *    is scored (at most naturalMaxCalls calls). Because it runs before the safe-round
 *    decision, a round whose in-band candidates are all unnatural gets the safe round.
 *    naturalTop 0 turns it off.
 * 7. The result: the selection (best may still be outside the band: there is always a
 *    next sentence unless every candidate was rejected), reject counts by reason, and
 *    diagnostics, including the number of model calls of each kind.
 *
 * Language-neutral: wording comes from LanguagePack.story; words from pack.segment.
 */
import type { LanguagePack } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { PairPack } from '../pair/types';
import type { DifficultyParams, LearnerView } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { estimateVocabulary } from '../learner/difficulty';
import { scoringContext } from '../scoring/context';
import { needsLeadingSpace } from '../scoring/text';
import type { Register, StoryLine } from './prompt';
import {
  DEFAULT_CONTEXT_SENTENCES,
  buildStoryPrompt,
  extractOptionsFor,
  extractSentence,
  lengthHintFor,
  levelName,
  tagFor,
} from './prompt';
import type { SelectCandidate, SelectContext, SelectOptions, Selection } from './select';
import { resolveSelectOptions, selectSentence } from './select';
import { isCapitalized, sentenceStartFlags, splitSentences, wholeAtLeast } from './text';

/** Collaborators that stay the same from sentence to sentence. */
export interface NextSentenceDeps {
  pack: LanguagePack;
  learner: LearnerView;
  /** Enables native-word rejection and trailing-gloss cleanup. */
  pair?: PairPack;
}

/** Tunable numbers of generateNextSentence. */
export interface NextSentenceTuning {
  /** Candidates sampled in the target round. */
  n: number;
  /** Candidates sampled in the safe round. */
  retryN: number;
  temperature: number;
  /** Temperature of the safe round (lower = safer, more common words). */
  retryTemperature: number;
  /** Run the safe round when nothing accepted lands in the band. */
  retry: boolean;
  /** Generation stops at these strings: the first sentence end. */
  stop: string[];
  /** maxTokens = ceil(maxWords x tokensPerWord) + extraTokens. */
  tokensPerWord: number;
  extraTokens: number;
  /** Story sentences shown in the prompt. */
  contextSentences: number;
  /** Recent story sentences checked for repeats and novelty. */
  previousSentences: number;
  /** Best accepted candidates scored by the model for naturalness (0 = no scoring calls). */
  naturalTop: number;
  /** Most scoring calls per step for the natural pass (candidates below the floor are replaced). */
  naturalMaxCalls: number;
  /** Most words in the vocabulary line. */
  vocabularyWords: number;
  /** Show the vocabulary line while the learner knows fewer lexemes than this... */
  vocabularyBelow: number;
  /** ...counting a lexeme as known from this pKnown(meaning). */
  vocabularyKnownAt: number;
}

/**
 * Defaults, measured on Qwen3-1.7B through proof/model_server.py (proof/ENGINE_REAL_MODEL.md,
 * "Story generation at every level"):
 * - n 5, retryN 4: with 5 candidates at least one landed in the band in most steps for
 *   every simulated learner; the safe round rescues most of the rest. retryTemperature 1:
 *   the safe round runs when the first one gave repeats or out-of-band words, and a
 *   hotter round with a fresh known word as its tag breaks the repeats (see step 5).
 * - temperature 0.9: at 0.8 the beginner prompts repeated one sentence in up to 6 of 12
 *   candidates; a little more temperature spreads them, and llama.cpp's min-p filter
 *   (applied before the temperature) keeps out the unlikely tokens. Judgement.
 * - stop at the first sentence end (". ", "? ", "! " or a line break): about 10 to 14
 *   tokens per candidate instead of the 24 to 36 of a full maxTokens run.
 * - tokensPerWord 2: Qwen3 uses about 1.6 tokens per Spanish word, punctuation included;
 *   extraTokens 4 leaves room for the stop string.
 * - naturalTop 3, naturalMaxCalls 6: three to six scoring calls of about 0.1 s each; a
 *   candidate below the natural floor (SelectOptions.naturalFloor) is replaced by the next.
 * - vocabularyBelow 800 at 0.9: the early learner (about 230 lexemes at 0.9) got 33% of
 *   its candidates in the band with the line, 25% without; learners past a few hundred
 *   words gain nothing from it and pay for the longer prompt.
 */
export const DEFAULT_NEXT_SENTENCE_TUNING: Readonly<NextSentenceTuning> = {
  n: 5,
  retryN: 4,
  temperature: 0.9,
  retryTemperature: 1,
  retry: true,
  stop: ['. ', '? ', '! ', '\n'],
  tokensPerWord: 2,
  extraTokens: 4,
  contextSentences: DEFAULT_CONTEXT_SENTENCES,
  previousSentences: 8,
  naturalTop: 3,
  naturalMaxCalls: 6,
  vocabularyWords: 40,
  vocabularyBelow: 800,
  vocabularyKnownAt: 0.9,
};

export interface NextSentenceOptions {
  /** Story so far: sentences (optionally tagged with their key word), or one text. */
  story: string | readonly (string | StoryLine)[];
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
  /** The story's characters (the main character first). */
  names?: readonly string[];
  /** Where the story happens, for the header. */
  scene?: string;
  /** Estimated vocabulary for the level name (estimateVocabulary over the pack's list when omitted). */
  vocab?: number;
  /** The vocabulary line's words; [] for none. Computed with vocabularyFor when omitted. */
  vocabulary?: readonly string[];
  /** Lexeme keys counted as known in the band check (the zero-knowledge bridge). */
  familiar?: readonly string[];
  /** Tag of the safe round. */
  safeTag?: string;
  tuning?: Partial<NextSentenceTuning>;
  select?: Partial<SelectOptions>;
}

/** One model call made while generating. */
export interface GenerationRound {
  prompt: string;
  /** The tag the prompt ended with. */
  tag: string;
  /** True for the safe round. */
  simple: boolean;
  seed: number;
  temperature: number;
  maxTokens: number;
  raw: string[];
  cleaned: string[];
}

export interface NextSentenceDiagnostics {
  /** Number of LanguageModel calls made (generate and score). */
  modelCalls: number;
  generateCalls: number;
  scoreCalls: number;
  retried: boolean;
  /** True when the best candidate is inside the known-word band. */
  inBand: boolean;
  /** True when the best candidate uses a target word. */
  targetUsed: boolean;
  rounds: GenerationRound[];
  /** Round (0-based) of each candidate, by candidate index in the selection. */
  candidateRound: number[];
  /** Candidates rejected, by reason, over all rounds. */
  rejectCounts: Selection['rejectCounts'];
  /** The vocabulary line's words (empty when the prompt had none). */
  vocabulary: string[];
  names: string[];
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

/**
 * Names a story uses: capitalized words the pack analyzes as PROPN, and capitalized
 * words away from a sentence start that the pack does not know, in order of first use,
 * distinct.
 */
export function storyNames(pack: LanguagePack, sentences: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    const segs = pack.segment(s);
    const starts = sentenceStartFlags(segs, pack.abbreviations ?? []);
    segs.forEach((seg, i) => {
      if (seg.kind !== 'word' || !isCapitalized(seg.text)) return;
      const norm = seg.norm || pack.normalize(seg.text);
      const a = pack.analyze(norm);
      const propn = a.some((x) => x.pos === 'PROPN');
      // At a sentence start only a word the pack knows as a name; elsewhere also an unknown one.
      if (starts[i] ? !propn : a.length > 0 && !propn) return;
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(seg.text);
      }
    });
  }
  return out;
}

const CONTENT_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

export interface VocabularyInput {
  pack: LanguagePack;
  learner: LearnerView;
  now: number;
  /** Recent story sentences: their known content words come first. */
  story: readonly string[];
  /** Keys counted as known (the bridge), listed before other known words. */
  familiar?: readonly string[];
  /** A lexeme is known from this pKnown(meaning). */
  knownAt: number;
  max: number;
  /** Keys never listed (the targets: they are the tag). */
  exclude?: readonly string[];
}

/**
 * Words for the vocabulary line: content words (NOUN, VERB, ADJ, ADV) the reader knows
 * or that are familiar, as dictionary forms. Order: those of the recent story, then the
 * familiar keys in the given order, then the pack's frequency list (most frequent first)
 * at knownAt or above; distinct, at most `max`.
 */
export function vocabularyFor(v: VocabularyInput): string[] {
  const { pack, learner, now } = v;
  const familiar = new Set((v.familiar ?? []).map(lexemeOf));
  const exclude = new Set((v.exclude ?? []).map(lexemeOf));
  const out: string[] = [];
  const seen = new Set<string>();
  const known = (key: string) => familiar.has(key) || learner.pKnown(key, 'meaning', now) >= v.knownAt;
  const add = (lemma: string, key: string): void => {
    if (out.length >= v.max || seen.has(key) || exclude.has(key)) return;
    seen.add(key);
    out.push(lemma);
  };
  for (const s of v.story) {
    for (const seg of pack.segment(s)) {
      if (seg.kind !== 'word') continue;
      const a = pack.analyze(seg.norm || pack.normalize(seg.text))[0];
      if (!a || !CONTENT_POS.has(a.pos)) continue;
      const key = lexemeKey(pack.code, a.lemma);
      if (known(key)) add(a.lemma, key);
    }
  }
  for (const key of familiar) {
    const lemma = targetWordsFromKeys([key])[0] as string;
    const a = pack.analyze(pack.normalize(lemma))[0];
    if (a && CONTENT_POS.has(a.pos)) add(lemma, key);
  }
  for (const lemma of pack.frequencyList ?? []) {
    if (out.length >= v.max) break;
    const key = lexemeKey(pack.code, lemma);
    if (seen.has(key) || learner.pKnown(key, 'meaning', now) < v.knownAt) continue;
    const a = pack.analyze(pack.normalize(lemma))[0];
    if (a && CONTENT_POS.has(a.pos)) add(lemma, key);
  }
  return out;
}

/**
 * The safe round's tag: a noun the learner knows (from `vocabulary`, else the known
 * content words of the frequency list; another content word only when no noun is left)
 * that the recent story does not use, picked by `seed` among the first `pool`; undefined
 * when there is none.
 */
export function safeTagFor(i: {
  pack: LanguagePack;
  learner: LearnerView;
  now: number;
  seed: number;
  story: readonly string[];
  vocabulary: readonly string[];
  knownAt: number;
  exclude?: readonly string[];
  pool?: number;
}): string | undefined {
  const { pack } = i;
  const used = new Set<string>();
  for (const s of i.story) {
    for (const seg of pack.segment(s)) {
      if (seg.kind !== 'word') continue;
      const norm = seg.norm || pack.normalize(seg.text);
      used.add(norm);
      const a = pack.analyze(norm)[0];
      if (a) used.add(pack.normalize(a.lemma));
    }
  }
  const words = i.vocabulary.length
    ? i.vocabulary
    : vocabularyFor({ pack, learner: i.learner, now: i.now, story: [], knownAt: i.knownAt, max: 4 * (i.pool ?? 30), exclude: i.exclude });
  const unused = words.filter((w) => !used.has(pack.normalize(w)));
  // Nouns first: a verb, adverb or adjective as the tag of a locked story gave "El hombre
  // es estar." and "El hombre es la vez." (fluent to the model, -2.1 to -2.8 nats per
  // token, so the natural floor keeps them); a noun gave "El hombre está en la casa.".
  const nouns = unused.filter((w) => pack.analyze(pack.normalize(w))[0]?.pos === 'NOUN');
  const fresh = (nouns.length ? nouns : unused).slice(0, i.pool ?? 30);
  if (!fresh.length) return undefined;
  return fresh[(((i.seed % fresh.length) + fresh.length) % fresh.length)];
}

/** Lexemes of the pack's frequency list the learner knows at `knownAt` or above. */
export function knownLexemeCount(pack: LanguagePack, learner: LearnerView, now: number, knownAt: number): number {
  let n = 0;
  for (const lemma of pack.frequencyList ?? []) if (learner.pKnown(lexemeKey(pack.code, lemma), 'meaning', now) >= knownAt) n++;
  return n;
}

/** Sentences joined with a space only where the script uses one (needsLeadingSpace). */
function joinScriptAware(parts: readonly string[]): string {
  let out = '';
  for (const p of parts) out += (out && needsLeadingSpace(out) ? ' ' : '') + p;
  return out;
}

function storyLines(pack: LanguagePack, story: NextSentenceOptions['story']): StoryLine[] {
  const entries = typeof story === 'string' ? [story] : story;
  const out: StoryLine[] = [];
  for (const e of entries) {
    const line = typeof e === 'string' ? { text: e } : e;
    const parts = splitSentences(line.text.replace(/\s+/gu, ' '), pack.abbreviations ?? []);
    parts.forEach((text, i) => out.push(i === parts.length - 1 && line.tag ? { text, tag: line.tag } : { text }));
  }
  return out;
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
  const { pack, learner } = deps;
  const n = wholeAtLeast(t.n);
  const register = opts.register ?? 'neutral';
  const targetWords = (opts.targetWords ?? targetWordsFromKeys(opts.targets)).map((w) => w.trim()).filter(Boolean);
  const lines = storyLines(pack, opts.story);
  const texts = lines.map((l) => l.text);
  const previous = texts.slice(-Math.max(0, t.previousSentences));
  const names = [...new Set([...(opts.names ?? []), ...storyNames(pack, texts.slice(-Math.max(t.previousSentences, t.contextSentences)))])];
  const maxWords = opts.params.sentenceWords.max;
  const familiar = opts.familiar ?? [];
  const frequencyKeys = (pack.frequencyList ?? []).map((l) => lexemeKey(pack.code, l));
  const vocab = opts.vocab ?? estimateVocabulary(learner, opts.now, frequencyKeys);
  let vocabulary: string[];
  if (opts.vocabulary) vocabulary = [...opts.vocabulary];
  else if (familiar.length > 0 || knownLexemeCount(pack, learner, opts.now, t.vocabularyKnownAt) < t.vocabularyBelow) {
    vocabulary = vocabularyFor({
      pack, learner, now: opts.now, story: texts.slice(-t.contextSentences), familiar, knownAt: t.vocabularyKnownAt,
      max: t.vocabularyWords, exclude: opts.targets,
    });
  } else vocabulary = [];
  const extract = extractOptionsFor(pack, {
    nativeLexicon: deps.pair?.nativeLexicon,
    isTargetWord: (w: string) => pack.analyze(pack.normalize(w)).length > 0,
  });
  const promptInput = {
    story: lines,
    level: levelName(pack.story, vocab),
    lengthHint: lengthHintFor(pack.story, maxWords),
    names,
    scene: opts.scene,
    vocabulary,
    register,
    region: opts.region,
    options: { contextSentences: t.contextSentences },
  };
  const selectCtx = (instructions: string[]): SelectContext => ({
    pack,
    learner,
    now: opts.now,
    targets: opts.targets,
    params: opts.params,
    previous,
    pair: deps.pair,
    instructions,
    names,
    familiar,
    seed: opts.seed,
    options: opts.select,
  });

  const rounds: GenerationRound[] = [];
  const candidates: SelectCandidate[] = [];
  const candidateRound: number[] = [];
  let instructions: string[] = [];
  let generateCalls = 0;
  let scoreCalls = 0;

  // Natural scores by candidate text (model log-probability per token after the story).
  const naturals = new Map<string, number>();
  const o = resolveSelectOptions(opts.select);
  const scoreContext = scoringContext(pack, joinScriptAware(texts.slice(-t.contextSentences)));
  const scoreLead = needsLeadingSpace(scoreContext) ? ' ' : '';
  const top = Math.max(0, Math.floor(t.naturalTop));
  const maxScores = Math.max(top, Math.floor(t.naturalMaxCalls));

  /**
   * Selection over every candidate so far, then the natural pass: the best accepted
   * candidates (distinct texts) are scored by the model, up to `naturalTop` that pass the
   * natural floor and `naturalMaxCalls` calls per step; a scored candidate below the floor
   * is rejected (unnatural). The scored ones are ranked among themselves first, the other
   * accepted candidates keep their order below them.
   */
  const select = async (): Promise<Selection> => {
    const ctx = selectCtx(instructions);
    let sel = selectSentence(
      candidates.map((c) => {
        const nat = naturals.get(c.text);
        return nat === undefined ? c : { ...c, natural: nat };
      }),
      ctx,
    );
    if (top === 0 || !sel.best) return sel;
    let kept = sel.ranked.filter((e) => e.accepted && e.natural !== null).length;
    for (const e of sel.ranked) {
      if (!e.accepted || kept >= top || scoreCalls >= maxScores) break;
      if (e.natural !== null || naturals.has(e.text)) continue;
      const tokens = await model.scoreContinuation(scoreContext, scoreLead + e.text);
      scoreCalls += 1;
      let sum = 0;
      for (const tok of tokens) sum += Number.isFinite(tok.logprob) ? Math.max(tok.logprob, -100) : -100;
      const nat = sum / Math.max(1, tokens.length);
      naturals.set(e.text, nat);
      if (nat >= o.naturalFloor) kept += 1;
    }
    sel = selectSentence(
      candidates.map((c) => {
        const nat = naturals.get(c.text);
        return nat === undefined ? c : { ...c, natural: nat };
      }),
      ctx,
    );
    const scored = sel.ranked.filter((e) => e.accepted && e.natural !== null);
    const unscored = sel.ranked.filter((e) => e.accepted && e.natural === null).sort((a, b) => a.index - b.index);
    const order = new Map(sel.ranked.map((e, i) => [e.index, i]));
    unscored.sort((a, b) => (order.get(a.index) ?? 0) - (order.get(b.index) ?? 0));
    const rejected = sel.ranked.filter((e) => !e.accepted);
    return { best: scored[0] ?? unscored[0] ?? null, ranked: [...scored, ...unscored, ...rejected], rejectCounts: sel.rejectCounts };
  };

  const runRound = async (tag: string, simple: boolean, count: number, temperature: number): Promise<Selection> => {
    const built = buildStoryPrompt(pack, { ...promptInput, tag });
    const seed = opts.seed + rounds.reduce((s, r) => s + r.raw.length, 0);
    const maxTokens = maxTokensFor(maxWords, t);
    const raw = await model.generate(built.prompt, { n: count, maxTokens, temperature, stop: t.stop, seed });
    generateCalls += 1;
    const cleaned = raw.map((r) => extractSentence(r, extract));
    const round = rounds.length;
    rounds.push({ prompt: built.prompt, tag, simple, seed, temperature, maxTokens, raw, cleaned });
    cleaned.forEach((text, i) => {
      candidates.push({ text, raw: raw[i] ?? '' });
      candidateRound.push(round);
    });
    instructions = built.headerLines.filter((l) => l !== built.vocabularyLine);
    return select();
  };

  const firstTag = targetWords.join(', ') || (lines.length ? lines[lines.length - 1]?.tag ?? tagFor(pack, texts[texts.length - 1] ?? '', names) : '');
  let selection = await runRound(firstTag, false, n, t.temperature);
  let retried = false;
  if (t.retry && wholeAtLeast(t.retryN, 0) > 0 && !selection.ranked.some((e) => e.accepted && e.inBand)) {
    retried = true;
    const safe = opts.safeTag ?? safeTagFor({
      pack, learner, now: opts.now, seed: opts.seed, story: texts.slice(-t.contextSentences), vocabulary,
      knownAt: t.vocabularyKnownAt, exclude: opts.targets,
    }) ?? names[0] ?? lines[lines.length - 1]?.tag ?? tagFor(pack, texts[texts.length - 1] ?? '', names);
    selection = await runRound(safe || firstTag, true, wholeAtLeast(t.retryN), t.retryTemperature);
  }

  return {
    ...selection,
    sentence: selection.best?.text ?? null,
    diagnostics: {
      modelCalls: generateCalls + scoreCalls,
      generateCalls,
      scoreCalls,
      retried,
      inBand: selection.best?.inBand ?? false,
      targetUsed: (selection.best?.targetsHit.length ?? 0) > 0,
      rounds,
      candidateRound,
      rejectCounts: selection.rejectCounts,
      vocabulary,
      names,
    },
  };
}
