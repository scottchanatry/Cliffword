/**
 * Whole-word next-word distribution from a sub-word model.
 *
 * Language models predict tokens, and a word is often several tokens (" cans" + "ado").
 * Cliff scoring, cliff selection and answer options need probabilities of whole words,
 * so this module combines pieces into words with a small beam search.
 *
 * ## Method (reused by cliff.ts and by any code that needs word probabilities)
 *
 * Definitions, for the spaced scripts the default classifier handles:
 * - A token STARTS a word if, after optional leading whitespace, it begins with a letter
 *   (or an apostrophe followed by a letter, as in "'tá"), and either it has leading
 *   whitespace or the preceding text does not end inside a word (it ends in a space,
 *   in punctuation such as ¿ or «, or is empty).
 * - A token CONTINUES the current word if it has no leading whitespace, begins with a
 *   letter or an apostrophe, and the preceding text ends inside a word (letters
 *   following letters; a word-final apostrophe also counts, so "pa" + "'" is "pa'").
 * - Every other token is a BOUNDARY: punctuation, whitespace-only tokens, digits, and
 *   an empty end-of-text token. A token that starts a word is also a boundary for the
 *   word before it.
 *
 * Search:
 * 1. Ask the model for the `topTokens` most likely next tokens after the context. Each
 *    word-starting token opens a beam: (text so far, word so far, log-probability).
 *    A whitespace-only token opens a pending beam whose next token may start a word
 *    (for tokenizers that emit the space separately).
 * 2. Keep the `beamWidth` most probable beams (beams with identical text, reached by
 *    different tokenizations, are merged by adding probabilities). Drop beams below
 *    `minProb`: a word can only be less probable than its prefix.
 * 3. Expand each beam with one nextTokens(context + beam text) call:
 *    - boundary mass B = sum of the probabilities of the returned tokens that do not
 *      continue the word. The beam's word is complete with probability
 *      P(word) = product of its piece probabilities * B, and is recorded.
 *    - each continuing token extends the beam by one piece (up to `maxPieces` pieces).
 *    If a piece itself ends with punctuation (" hola," or "ado."), the word is complete
 *    inside that token, its probability is just the product of pieces, and no boundary
 *    call is needed.
 * 4. Repeat 2 and 3 until no beams remain or the model-call budget runs out.
 * 5. Merge recorded words with the same normalized form (`normalize`, lowercase by
 *    default) by adding probabilities; the surface form shown is the most probable
 *    variant. Drop words below `minProb`, sort by probability (ties by normalized form),
 *    return the top `k`.
 *
 * Truncation: B only counts boundary tokens that appear among the top `topTokens`, so it
 * is a lower bound (the "seen" estimate) and every word probability is slightly low; the
 * missing tail is spread over many unlikely tokens and affects all words similarly, so
 * rankings are stable. The "complement" estimate (1 minus the seen continuation mass)
 * is an upper bound instead; choose with `boundaryEstimate`. First-piece probabilities
 * are truncated the same way: a word whose first token is not among the top tokens is
 * never found.
 *
 * Cost: 1 call for the context plus at most `beamWidth` calls per piece depth, so at
 * most 1 + beamWidth * maxPieces calls (plus one level for pending-space beams). Calls
 * are counted in NextWordsResult.modelCalls, reported to `onModelCall` as they are
 * issued, and capped by `maxModelCalls`; when the budget runs out, beams that could not
 * be expanded are dropped (their boundary mass is unknown) and `budgetExhausted` is set.
 *
 * Scripts without spaces (Japanese, Chinese) need a pack-aware `classify`; the default
 * classifier treats a run of letters without spaces as one word.
 */
import type { LanguageModel, TokenCandidate } from '../model/types';
import type { NextWord } from './types';
import { endsInsideWord, firstChar, isAllSpace, isApostrophe, isLetter, isSpace, logAddExp, lowercaseNormalize } from './text';

/** Role of a model token relative to the text before it. See the module doc. */
export type TokenRole = 'start' | 'continue' | 'boundary';

/** Decide the role of `token` given the exact text that precedes it. */
export type TokenClassifier = (prevText: string, token: string) => TokenRole;

/** One model call, reported to ModelCallListener as it is issued. */
export interface ModelCallInfo {
  method: 'nextTokens' | 'scoreContinuation';
  /** The context passed to the model. */
  context: string;
}

export type ModelCallListener = (call: ModelCallInfo) => void;

/** How the probability that a word ends here is estimated from the top tokens. */
export type BoundaryEstimate = 'seen' | 'complement';

export interface NextWordOptions {
  /** Number of words to return. */
  k: number;
  /** Partial words kept per expansion depth. Should be at least k, since each beam yields at most one word. */
  beamWidth: number;
  /** Tokens requested from the model per call. */
  topTokens: number;
  /** Maximum number of tokens in one word. */
  maxPieces: number;
  /** Words and partial words below this probability are dropped. */
  minProb: number;
  /** Hard cap on model calls for one search. */
  maxModelCalls: number;
  /** Boundary mass estimator; 'seen' is the documented default. */
  boundaryEstimate: BoundaryEstimate;
  /** Merge key for words, e.g. LanguagePack.normalize. Default: lowercase. */
  normalize: (word: string) => string;
  /** Token role classifier. Default: classifySpacedToken. */
  classify: TokenClassifier;
  /** Called once per model call, before it is issued. */
  onModelCall?: ModelCallListener;
}

export const DEFAULT_NEXT_WORD_OPTIONS: Readonly<NextWordOptions> = {
  k: 10,
  // Proof test: a beam of 30 partial words per level over the 60 best first tokens,
  // 4 pieces deep, pruned at 0.001, took about 60 model calls (8 s for Qwen3-1.7B on 4
  // CPU cores without KV-cache reuse) and gave usable top-10 lists for standard Spanish
  // (top-10 mass 0.33 to 0.99). Cliffs need about 10 alternatives, so the beam here is
  // narrower to keep a cliff under the call budget; widen it if lists look thin on device.
  beamWidth: 12,
  topTokens: 20,
  maxPieces: 4,
  // Proof test pruning floor.
  minProb: 1e-3,
  // Covers the worst case 1 + beamWidth * maxPieces = 49 plus one pending-space level.
  maxModelCalls: 64,
  boundaryEstimate: 'seen',
  normalize: lowercaseNormalize,
  classify: classifySpacedToken,
};

export interface NextWordsResult {
  /** Most likely next words, most likely first. */
  words: NextWord[];
  /** Number of model calls made. */
  modelCalls: number;
  /** True if the search stopped because maxModelCalls was reached. */
  budgetExhausted: boolean;
  /** Probability mass covered by the first call's top tokens (how much the search saw). */
  firstStepMass: number;
}

/**
 * Default token classifier for scripts that separate words with spaces (see the module
 * doc for the exact rules). Empty tokens (end of text) and whitespace-only tokens are
 * boundaries.
 */
export function classifySpacedToken(prevText: string, token: string): TokenRole {
  const first = firstChar(token);
  if (!first) return 'boundary';
  if (isSpace(first)) return startsWordBody(token.trimStart()) ? 'start' : 'boundary';
  if (isLetter(first) || isApostrophe(first)) {
    if (endsInsideWord(prevText)) return 'continue';
    return startsWordBody(token) ? 'start' : 'boundary';
  }
  return 'boundary';
}

function startsWordBody(body: string): boolean {
  const first = firstChar(body);
  if (!first) return false;
  if (isLetter(first)) return true;
  return isApostrophe(first) && isLetter(firstChar(body.slice(first.length)));
}

/**
 * Split a token body into its leading word characters (letters, marks, apostrophes) and
 * the rest. `closed` is true when something follows the word characters inside the same
 * token, i.e. the word ends within the token.
 */
export function splitWordRun(body: string): { run: string; closed: boolean } {
  const m = /^[\p{L}\p{M}'’ʼ]*/u.exec(body);
  const run = m ? m[0] : '';
  return { run, closed: run.length < body.length };
}

/**
 * Probability that a word ending at `prevText` is complete, from the model's top next
 * tokens `cands` (most likely first). 'seen': sum of probabilities of tokens that do not
 * continue the word (a lower bound, because only the top tokens are seen). 'complement':
 * 1 minus the probability of the seen continuing tokens (an upper bound). Clamped to
 * [0, 1].
 */
export function boundaryMass(
  cands: readonly TokenCandidate[],
  prevText: string,
  classify: TokenClassifier = classifySpacedToken,
  estimate: BoundaryEstimate = 'seen',
): number {
  let boundary = 0;
  let cont = 0;
  for (const c of cands) {
    const p = probOf(c.logprob);
    if (p === 0) continue;
    if (classify(prevText, c.text) === 'continue') cont += p;
    else boundary += p;
  }
  const mass = estimate === 'seen' ? boundary : 1 - cont;
  return Math.min(1, Math.max(0, mass));
}

/**
 * One-call helper: boundary mass after `text` (see boundaryMass), using the classifier,
 * estimator, topTokens and onModelCall of `opts`.
 */
export async function wordBoundaryMass(
  model: LanguageModel,
  text: string,
  opts: Partial<NextWordOptions> = {},
): Promise<number> {
  const o = { ...DEFAULT_NEXT_WORD_OPTIONS, ...opts };
  o.onModelCall?.({ method: 'nextTokens', context: text });
  const cands = await model.nextTokens(text, o.topTokens);
  return boundaryMass(cands, text, o.classify, o.boundaryEstimate);
}

interface Beam {
  /** Exact token texts since the context, leading whitespace included. */
  raw: string;
  /** Word letters so far (no leading whitespace); '' for a pending-space beam. */
  word: string;
  pieces: number;
  logprob: number;
}

function probOf(lp: number): number {
  return Number.isFinite(lp) ? Math.exp(Math.min(0, lp)) : 0;
}

/**
 * Next-word distribution with search statistics. See the module doc for the method.
 * The context should end at a word boundary (normally right after a word, without a
 * trailing space); a letter piece directly after a context ending in letters would
 * continue that word and is ignored.
 */
export async function nextWordsDetailed(
  model: LanguageModel,
  context: string,
  opts: Partial<NextWordOptions> = {},
): Promise<NextWordsResult> {
  const o = { ...DEFAULT_NEXT_WORD_OPTIONS, ...opts };
  const minLp = o.minProb > 0 ? Math.log(o.minProb) : -Infinity;
  let calls = 0;
  let budgetExhausted = false;
  /** norm -> surface -> probability */
  const found = new Map<string, Map<string, number>>();

  const record = (word: string, lp: number): void => {
    const p = probOf(lp);
    if (!word || p === 0) return;
    const norm = o.normalize(word);
    if (!norm) return;
    let m = found.get(norm);
    if (!m) found.set(norm, (m = new Map()));
    m.set(word, (m.get(word) ?? 0) + p);
  };

  const query = (text: string): Promise<TokenCandidate[]> => {
    calls++;
    o.onModelCall?.({ method: 'nextTokens', context: text });
    return model.nextTokens(text, o.topTokens);
  };

  /** Open a beam (or record a closed word) for a word-starting token after `prev`. */
  const open = (out: Beam[], prevRaw: string, prevLp: number, tok: TokenCandidate): void => {
    const lp = prevLp + tok.logprob;
    const { run, closed } = splitWordRun(tok.text.trimStart());
    if (!/\p{L}/u.test(run)) return;
    if (closed) record(run, lp);
    else out.push({ raw: prevRaw + tok.text, word: run, pieces: 1, logprob: lp });
  };

  const prune = (beams: Beam[]): Beam[] => {
    const merged = new Map<string, Beam>();
    for (const b of beams) {
      const prev = merged.get(b.raw);
      if (prev) prev.logprob = logAddExp(prev.logprob, b.logprob);
      else merged.set(b.raw, { ...b });
    }
    return [...merged.values()]
      .filter((b) => Number.isFinite(b.logprob) && b.logprob >= minLp)
      .sort((a, b) => b.logprob - a.logprob || (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0))
      .slice(0, Math.max(0, o.beamWidth));
  };

  if (o.maxModelCalls < 1 || o.k < 1) {
    return { words: [], modelCalls: 0, budgetExhausted: o.maxModelCalls < 1, firstStepMass: 0 };
  }

  const rootCands = await query(context);
  let firstStepMass = 0;
  let frontier: Beam[] = [];
  for (const c of rootCands) {
    const p = probOf(c.logprob);
    firstStepMass += p;
    if (p === 0) continue;
    if (isAllSpace(c.text)) {
      frontier.push({ raw: c.text, word: '', pieces: 0, logprob: c.logprob });
    } else if (o.classify(context, c.text) === 'start') {
      open(frontier, '', 0, c);
    }
  }
  frontier = prune(frontier);

  while (frontier.length > 0) {
    const allowed = Math.max(0, o.maxModelCalls - calls);
    if (allowed < frontier.length) budgetExhausted = true;
    const batch = frontier.slice(0, allowed);
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map((b) => query(context + b.raw)));
    const children: Beam[] = [];
    batch.forEach((beam, i) => {
      const cands = results[i] ?? [];
      const prev = context + beam.raw;
      if (beam.word === '') {
        // Pending whitespace: only a word start may follow.
        for (const c of cands) {
          if (probOf(c.logprob) === 0 || isAllSpace(c.text)) continue;
          if (o.classify(prev, c.text) === 'start') open(children, beam.raw, beam.logprob, c);
        }
        return;
      }
      const mass = boundaryMass(cands, prev, o.classify, o.boundaryEstimate);
      if (mass > 0) record(beam.word, beam.logprob + Math.log(mass));
      if (beam.pieces >= o.maxPieces) return;
      for (const c of cands) {
        if (probOf(c.logprob) === 0 || o.classify(prev, c.text) !== 'continue') continue;
        const { run, closed } = splitWordRun(c.text);
        if (!run) continue;
        const lp = beam.logprob + c.logprob;
        if (closed) record(beam.word + run, lp);
        else children.push({ raw: beam.raw + c.text, word: beam.word + run, pieces: beam.pieces + 1, logprob: lp });
      }
    });
    if (budgetExhausted) break;
    frontier = prune(children);
  }

  const words: NextWord[] = [];
  for (const [norm, surfaces] of found) {
    let prob = 0;
    let best = '';
    let bestP = -1;
    for (const [surface, p] of surfaces) {
      prob += p;
      if (p > bestP || (p === bestP && surface < best)) {
        best = surface;
        bestP = p;
      }
    }
    prob = Math.min(1, prob);
    if (prob < o.minProb || prob <= 0) continue;
    words.push({ word: best, norm, logprob: Math.log(prob), prob });
  }
  words.sort((a, b) => b.prob - a.prob || (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0));
  return { words: words.slice(0, o.k), modelCalls: calls, budgetExhausted, firstStepMass };
}

/**
 * The k most likely whole next words after `context`, most likely first. Same method and
 * options as nextWordsDetailed (see the module doc); use that function, or
 * opts.onModelCall, to see how many model calls were made.
 */
export async function nextWords(
  model: LanguageModel,
  context: string,
  opts: Partial<NextWordOptions> = {},
): Promise<NextWord[]> {
  return (await nextWordsDetailed(model, context, opts)).words;
}
