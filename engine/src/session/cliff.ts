/**
 * Cliff helpers for sessions: where a canned answer sits in its sentence, spoken options
 * for the options rung, answers checked without a model, and the landing data ("You
 * landed where a Spanish speaker would", "About N times in 100", "X is just as natural").
 *
 * Options rung (BRIEF "Levels": pick from two or three spoken options). One option is
 * natural: the story's own words. The others must not be natural continuations, so a
 * pick says something: with a model each candidate distractor is scored at the cliff and
 * kept only when its probability is below the credit module's partial floor, the line
 * below which scoreCliffAnswer gives no credit (DEFAULT_CREDIT_OPTIONS.partialFloor).
 * Candidates are words the learner probably understands (so every option is
 * recognizable), never the answer's lemma, never one of the model's plausible
 * alternatives.
 */
import type { LanguagePack, Segment } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { CliffRung } from '../learner/types';
import type { CliffResult, Credit, CreditReason, NextWord } from '../scoring/types';
import { DEFAULT_CREDIT_OPTIONS } from '../scoring/cliff';
import { clampLogprob, needsLeadingSpace } from '../scoring/text';
import type { LyricEquivalence } from '../lyrics/cliffs';
import { looseText, sameWords, shuffled } from './common';
import type { CliffOption, CliffOutcome, LandingPoint, UiText } from './types';

/** A hidden span located in a sentence. */
export interface AnswerSpan {
  /** First hidden word among the word and number segments. */
  wordIndex: number;
  length: number;
  /** Character span in the sentence. */
  start: number;
  end: number;
}

function contentSegs(pack: Pick<LanguagePack, 'segment'>, text: string): Segment[] {
  return pack.segment(text).filter((s) => s.kind === 'word' || s.kind === 'number');
}

/**
 * Locate `answer` in `text`: the last run of word and number segments whose loose forms
 * (case, accents and apostrophes ignored) equal the answer's, never starting at the
 * first word (a cliff needs context). null when there is none.
 */
export function locateAnswer(pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents'>, text: string, answer: string): AnswerSpan | null {
  const segs = contentSegs(pack, text);
  const want = looseText(pack, answer).split(' ').filter(Boolean);
  if (want.length === 0) return null;
  const keys = segs.map((s) => looseText(pack, s.text));
  for (let i = segs.length - want.length; i >= 1; i--) {
    if (want.every((w, j) => keys[i + j] === w)) {
      const first = segs[i] as Segment;
      const last = segs[i + want.length - 1] as Segment;
      return { wordIndex: i, length: want.length, start: first.start, end: last.end };
    }
  }
  return null;
}

/** Tunable numbers of spoken options. */
export interface OptionChoiceOptions {
  /** Distractors wanted: 2 gives three options, the brief's upper end. */
  count: number;
  /** Model calls spent checking candidates (one scoreContinuation each). */
  maxChecks: number;
  /** A candidate is "not a natural continuation" when P(candidate) is below this. */
  notNaturalBelow: number;
  /** Token log-probabilities are clamped to this before summing. */
  logprobFloor: number;
}

/**
 * Defaults. count 2: three spoken options is the brief's upper end and keeps chance at
 * one in three. maxChecks 6: each check is one scoring call (about 0.3 s on 4 CPU cores
 * in the proof test), and unrelated words almost always fail the floor, so six checks
 * find two distractors in practice while bounding the cost. notNaturalBelow is the
 * credit floor below which scoreCliffAnswer gives no credit, so a picked distractor
 * scores exactly as if it had been said.
 */
export const DEFAULT_OPTION_CHOICE_OPTIONS: Readonly<OptionChoiceOptions> = {
  count: 2,
  maxChecks: 6,
  notNaturalBelow: DEFAULT_CREDIT_OPTIONS.partialFloor,
  logprobFloor: -100,
};

export interface Distractor {
  text: string;
  /** P(text) at the cliff when it was checked with a model; null otherwise. */
  prob: number | null;
}

/**
 * Pick distractors from `pool` (candidate words, best first): never the same words as
 * `actual`, never a word sharing a lemma with it (pack.analyze), never one of the
 * model's alternatives at or above the floor. With a model, each candidate (in a seeded
 * order among the first few) is scored after `context` and kept when its probability
 * is below the floor; without one, the first eligible candidates are taken unchecked.
 */
export async function chooseDistractors(
  model: LanguageModel | null,
  pack: LanguagePack,
  args: {
    context: string;
    actual: string;
    alternatives: readonly NextWord[];
    pool: readonly string[];
    random: () => number;
    options?: Partial<OptionChoiceOptions>;
  },
): Promise<Distractor[]> {
  const o: OptionChoiceOptions = { ...DEFAULT_OPTION_CHOICE_OPTIONS, ...args.options };
  const actualLemmas = new Set(contentSegs(pack, args.actual).flatMap((s) => pack.analyze(s.norm || pack.normalize(s.text)).map((a) => a.lemma)));
  const natural = new Set(args.alternatives.filter((a) => a.prob >= o.notNaturalBelow).map((a) => looseText(pack, a.word)));
  const seen = new Set<string>([looseText(pack, args.actual)]);
  const eligible: string[] = [];
  for (const cand of args.pool) {
    const key = looseText(pack, cand);
    if (!key || seen.has(key) || natural.has(key)) continue;
    seen.add(key);
    const lemmas = contentSegs(pack, cand).flatMap((s) => pack.analyze(s.norm || pack.normalize(s.text)).map((a) => a.lemma));
    if (lemmas.some((l) => actualLemmas.has(l))) continue;
    eligible.push(cand);
  }
  const want = Math.max(0, Math.floor(o.count));
  if (!model) return eligible.slice(0, want).map((text) => ({ text, prob: null }));
  // A seeded order among the first candidates, so options vary between sentences.
  const head = shuffled(eligible.slice(0, Math.max(want, o.maxChecks)), args.random);
  const ctx = args.context.replace(/\s+$/u, '');
  const lead = needsLeadingSpace(ctx) ? ' ' : '';
  const out: Distractor[] = [];
  for (const cand of head.slice(0, o.maxChecks)) {
    if (out.length >= want) break;
    const toks = await model.scoreContinuation(ctx, lead + cand);
    let lp = 0;
    for (const t of toks) lp += clampLogprob(t.logprob, o.logprobFloor);
    const p = Math.exp(lp);
    if (p < o.notNaturalBelow) out.push({ text: cand, prob: p });
  }
  return out;
}

/** The options in a seeded order, and the index of the natural one. */
export function arrangeOptions(natural: string, distractors: readonly string[], random: () => number): { options: CliffOption[]; naturalIndex: number } {
  const texts = shuffled([natural, ...distractors], random);
  return { options: texts.map((text, index) => ({ index, text })), naturalIndex: texts.indexOf(natural) };
}

/** The prompt line of a rung: pick one, it starts with a sound, or say what comes next. */
export function cliffUi(rung: CliffRung, hint: string | undefined): UiText {
  if (rung === 'options') return { key: 'cliff.pickOne' };
  if (rung === 'hint' && hint) return { key: 'cliff.hint', params: { sound: hint } };
  return { key: 'cliff.prompt' };
}

function sharesLemma(pack: LanguagePack, a: string, b: string): boolean {
  const wa = contentSegs(pack, a);
  const wb = contentSegs(pack, b);
  if (wa.length !== wb.length || wa.length === 0) return false;
  return wa.every((s, i) => {
    const x = new Set(pack.analyze(s.norm || pack.normalize(s.text)).map((an) => an.lemma));
    const t = wb[i] as Segment;
    return x.size > 0 && pack.analyze(t.norm || pack.normalize(t.text)).some((an) => x.has(an.lemma));
  });
}

/**
 * Credit without a model (canned mode), by string and form match: the expected words
 * (case, accents and apostrophes ignored) are full 'actual'; a listed natural answer is
 * full 'likely'; the same lemmas in another form are partial 'form'; anything else is
 * none 'unlikely' (a distractor, or an answer nothing can judge: the outcome says
 * scoredBy 'canned'). Probabilities are unknown: logprob is the floor and prob 0.
 */
export function cannedResult(
  pack: LanguagePack,
  answer: string,
  expected: string,
  accept: readonly string[] = [],
  floor = -100,
): CliffResult {
  const base = { answer, scored: answer.trim(), logprob: floor, prob: 0, rank: null, alternatives: [] as NextWord[] };
  if (looseText(pack, answer) === '') return { ...base, scored: '', credit: 'none', reason: 'unlikely' };
  if (sameWords(pack, answer, expected)) return { ...base, scored: expected, credit: 'full', reason: 'actual' };
  const listed = accept.find((a) => sameWords(pack, answer, a));
  if (listed !== undefined) return { ...base, scored: listed, credit: 'full', reason: 'likely' };
  if (sharesLemma(pack, answer, expected)) return { ...base, credit: 'partial', reason: 'form' };
  return { ...base, credit: 'none', reason: 'unlikely' };
}

/** A picked option as a CliffResult: the natural one is the actual words; a distractor gets no credit. */
export function optionResult(
  text: string,
  natural: boolean,
  prob: number | null,
  alternatives: readonly NextWord[],
  floor = -100,
): CliffResult {
  const p = prob !== null && prob > 0 ? prob : 0;
  const credit: Credit = natural ? 'full' : 'none';
  const reason: CreditReason = natural ? 'actual' : 'unlikely';
  return { answer: text, scored: text, logprob: p > 0 ? Math.max(floor, Math.log(p)) : floor, prob: p, rank: null, credit, reason, alternatives: [...alternatives] };
}

/** Tunable numbers of the landing line. */
export interface LandingOptions {
  /** Probability at the surprising end of the line (x = 0): one in ten thousand. */
  floor: number;
  /** Alternatives drawn on the line besides the answer and the actual words. */
  maxAlternatives: number;
  /** An alternative is "just as natural" when P >= naturalRatio x P(top alternative) or P >= naturalFloor. */
  naturalRatio: number;
  naturalFloor: number;
}

/**
 * Defaults. floor 1e-4: the credit floors sit at 0.005 and 0.05, so a line from 1e-4 to
 * the top alternative leaves room on the surprising side for answers that earned
 * nothing. maxAlternatives 3: the B2 design draws four words (the answer and three
 * others). "Just as natural" uses the credit module's full-credit rule
 * (DEFAULT_CREDIT_OPTIONS fullRatio and fullFloor), so the word named is one that would
 * itself have earned full credit.
 */
export const DEFAULT_LANDING_OPTIONS: Readonly<LandingOptions> = {
  floor: 1e-4,
  maxAlternatives: 3,
  naturalRatio: DEFAULT_CREDIT_OPTIONS.fullRatio,
  naturalFloor: DEFAULT_CREDIT_OPTIONS.fullFloor,
};

/** What buildOutcome needs besides the scorer's result. */
export interface OutcomeContext {
  pack: LanguagePack;
  expected: string;
  rung: CliffRung;
  scoredBy: CliffOutcome['scoredBy'];
  /** P(actual words) at the cliff when known (cliff positions or a scoring). */
  actualProb: number | null;
  equivalence?: LyricEquivalence;
  options?: Partial<LandingOptions>;
}

/**
 * The landing data of a scored answer: the answer, the actual words and the top
 * alternatives on a log-probability line from `floor` (surprising) to the most likely of
 * them (expected); the headline for the credit reason (landing.<reason>); "About N
 * times in 100" when the answer has at least a 1-in-100 chance; "X is just as natural"
 * naming the actual words (when the learner said something else and the actual words
 * are natural) or else the most likely natural alternative that is not the answer.
 * Canned results have no probabilities: no points and no notes.
 */
export function buildOutcome(result: CliffResult, ctx: OutcomeContext): CliffOutcome {
  const o: LandingOptions = { ...DEFAULT_LANDING_OPTIONS, ...ctx.options };
  const pack = ctx.pack;
  const scored = ctx.scoredBy !== 'canned';
  const answerKey = looseText(pack, result.scored ?? result.answer) || looseText(pack, result.answer);
  const actualKey = looseText(pack, ctx.expected);
  const isActual = result.reason === 'actual' || answerKey === actualKey;
  const outcome: CliffOutcome = {
    answer: result.answer,
    scored: result.scored ?? result.answer,
    expected: ctx.expected,
    credit: result.credit,
    reason: result.reason,
    rung: ctx.rung,
    prob: scored ? result.prob : null,
    timesIn100: scored ? Math.round(result.prob * 100) : null,
    points: [],
    headline: { key: `landing.${result.reason}` },
    notes: [],
    scoredBy: ctx.scoredBy,
  };
  if (result.bounded) outcome.bounded = true;
  if (ctx.equivalence) outcome.explanation = ctx.equivalence.explain;
  if (!scored) return outcome;

  const raw: Omit<LandingPoint, 'x'>[] = [];
  const add = (text: string, prob: number, answer: boolean, actual: boolean): void => {
    const key = looseText(pack, text);
    if (!key || !(prob >= 0) || !Number.isFinite(prob)) return;
    const hit = raw.find((p) => looseText(pack, p.text) === key);
    if (hit) {
      hit.answer ||= answer;
      hit.actual ||= actual;
      return;
    }
    raw.push({ text, prob, answer, actual });
  };
  add(outcome.scored || result.answer, result.prob, true, isActual);
  const actualProb = ctx.actualProb ?? result.alternatives.find((a) => looseText(pack, a.word) === actualKey)?.prob ?? null;
  if (actualProb !== null) add(ctx.expected, actualProb, false, true);
  let alts = 0;
  for (const a of result.alternatives) {
    if (alts >= o.maxAlternatives) break;
    const before = raw.length;
    add(a.word, a.prob, false, looseText(pack, a.word) === actualKey);
    if (raw.length > before) alts++;
  }
  const top = Math.max(o.floor * 10, ...raw.map((p) => p.prob));
  const lo = Math.log(o.floor);
  const hi = Math.log(top);
  outcome.points = raw
    .map((p) => ({ ...p, x: Math.min(1, Math.max(0, (Math.log(Math.max(p.prob, o.floor)) - lo) / (hi - lo))) }))
    .sort((a, b) => a.x - b.x || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

  if (outcome.timesIn100 !== null && outcome.timesIn100 >= 1) outcome.notes.push({ key: 'landing.timesInHundred', params: { n: outcome.timesIn100 } });
  const topAlt = result.alternatives[0]?.prob ?? 0;
  const natural = (p: number) => (topAlt > 0 && p >= o.naturalRatio * topAlt) || p >= o.naturalFloor;
  let other: string | undefined;
  if (!isActual && actualProb !== null && natural(actualProb)) other = ctx.expected;
  else other = result.alternatives.find((a) => looseText(pack, a.word) !== answerKey && natural(a.prob))?.word;
  if (other !== undefined && result.credit !== 'none') outcome.notes.push({ key: 'landing.justAsNatural', params: { word: other } });
  return outcome;
}
