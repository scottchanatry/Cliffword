/**
 * Self-repair: before showing a fix, prompt the learner to repair their own sentence
 * (A2-Ink-Repair: "One word surprised me. Say it again. You get the answer after this
 * try.").
 *
 * repairFlow is a pure state machine over Judgement objects from
 * corrections/judgeSentence; judgeAttempt / attemptRepair are the async helpers that
 * run the judge for an attempt. repairEvents suggests the learner events of a finished
 * flow.
 *
 * States
 * ------
 * awaiting_attempt --attempt--> ok            verdict ok: nothing to fix
 *                            -> hinted        any other flag (hint by default): shade the
 *                                             word lightly and show what was expected;
 *                                             no repair prompt, no explanation (the
 *                                             brief: assert a fix only when the margin
 *                                             is large)
 *                            -> prompt_repair verdict in repairOn (assert): shade the
 *                                             word (heat), hide the explanation, ask
 *                                             for another try
 * prompt_repair --attempt--> repaired         the new attempt is not asserted any more
 *                                             and is the same sentence mended (at least
 *                                             minOverlap of the other words still land)
 *                         -> prompt_repair    still asserted and repairs remain
 *                         -> show_answer      still asserted with no repairs left, or a
 *                                             different sentence: the expected variant
 *                                             of the latest flagged attempt and its
 *                                             explainKey
 *               --give_up--> show_answer      "show me the answer" (or "no sé")
 * ok, hinted, repaired, show_answer are final: every input leaves them unchanged.
 * give_up before any attempt leaves the state unchanged (nothing to show yet).
 */
import type { LanguagePack, Pos, Register } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { Heat } from '../scoring/types';
import type { JudgeOptions, Judgement, Verdict } from '../corrections/judge';
import type { LearnerEvent } from '../learner/types';
import { judgeSentence } from '../corrections/judge';
import { chooseAnalysesInText } from '../lang/choose';
import { lexemeKey } from '../learner/types';
import { scoringContext, slangIn } from '../scoring/context';
import { sentenceStartFlags } from '../story/text';
import { alignTranscript } from './align';
import type { UiText } from './text';

export type RepairPhase = 'awaiting_attempt' | 'prompt_repair' | 'ok' | 'hinted' | 'repaired' | 'show_answer';

/** Phases after which the flow is over. */
export const FINAL_REPAIR_PHASES: readonly RepairPhase[] = ['ok', 'hinted', 'repaired', 'show_answer'];

export interface RepairAttempt {
  text: string;
  /** When the learner said it (ms since epoch). */
  at: number;
  judgement: Judgement;
}

/** The word to shade. */
export interface RepairHighlight {
  /** Index among the word segments of the attempt (Judgement.wordIndex). */
  wordIndex: number;
  /** Character span of that word in the attempt. */
  start: number;
  end: number;
  text: string;
  heat: Heat;
  /** Part of speech of the word in context, for prompts such as "try a different verb"; null when unknown. */
  pos: Pos | null;
}

export interface RepairState {
  phase: RepairPhase;
  attempts: readonly RepairAttempt[];
  /** Repair attempts made after the first prompt. */
  repairs: number;
  /** The learner asked for the answer. */
  gaveUp: boolean;
  /** prompt_repair and hinted (and repaired with a remaining hint): the word to shade; null otherwise. */
  highlight: RepairHighlight | null;
  /** hinted, show_answer (and repaired with a remaining hint): the sentence the model expected. */
  expected: string | null;
  /** show_answer only: key into PairPack.explanations. Hidden (null) while the learner may still repair. */
  explainKey: string | null;
  /** What the app shows now, as a PairPack.ui lookup; null when nothing needs saying. */
  ui: UiText | null;
}

export type RepairInput =
  | { type: 'attempt'; text: string; at: number; judgement: Judgement }
  | { type: 'give_up'; at: number };

/** Tunable numbers of the repair flow. */
export interface RepairOptions {
  /** Verdicts that prompt a repair. */
  repairOn: readonly Verdict[];
  /** Repair attempts allowed after the prompt before the answer is shown. */
  maxRepairs: number;
  /**
   * Share of the first attempt's other words (all but the flagged one) that must land in
   * a repair attempt for it to count as the same sentence mended.
   */
  minOverlap: number;
  /** Heat of the flagged word while prompting a repair. */
  assertHeat: Heat;
  /** Heat of a hinted word. */
  hintHeat: Heat;
  /** Register and regions for the overlap alignment (clipped forms count as the same word in street register). */
  register: Register;
  regions: readonly string[];
  /** Parts of speech that get no spoke_correct event (names and numbers say nothing about speaking). */
  excludePos: readonly Pos[];
  /** PairPack.ui keys. */
  promptKey: string;
  expectedKey: string;
  fixKey: string;
}

/**
 * Defaults (judgement calls):
 * - repairOn ['assert']: the brief asks to assert a fix only when the margin is large
 *   (3 nats: no false flags in the proof test); a hint (1 to 3 nats, one false flag)
 *   is shaded lightly with the expected sentence, never turned into a "try again".
 * - maxRepairs 1: the design promises the answer after one more try.
 * - minOverlap 0.5: a mended sentence keeps most of its words; below half it is another
 *   sentence and the learner gets the answer.
 * - assertHeat 2, hintHeat 1: the design shades the flagged word in the middle amber
 *   (#FFC46B) and hints in the lightest (#FFE9C7).
 * - excludePos PROPN, NUM: as story selection counts words.
 * - keys: the en-es pair pack's 'repair.prompt', 'repair.expected', 'repair.fix'.
 */
export const DEFAULT_REPAIR_OPTIONS: Readonly<RepairOptions> = {
  repairOn: ['assert'],
  maxRepairs: 1,
  minOverlap: 0.5,
  assertHeat: 2,
  hintHeat: 1,
  register: 'neutral',
  regions: [],
  excludePos: ['PROPN', 'NUM'],
  promptKey: 'repair.prompt',
  expectedKey: 'repair.expected',
  fixKey: 'repair.fix',
};

/** A fresh flow, waiting for the learner's sentence. */
export function startRepair(): RepairState {
  return { phase: 'awaiting_attempt', attempts: [], repairs: 0, gaveUp: false, highlight: null, expected: null, explainKey: null, ui: null };
}

/** True for ok, hinted, repaired and show_answer. */
export function isRepairFinal(state: Pick<RepairState, 'phase'>): boolean {
  return FINAL_REPAIR_PHASES.includes(state.phase);
}

type Pack = Pick<LanguagePack, 'code' | 'segment' | 'normalize' | 'analyze' | 'chooseAnalysis' | 'foldAccents' | 'registers' | 'streetEndings'>;

interface WordInfo {
  wordIndex: number;
  start: number;
  end: number;
  text: string;
  norm: string;
  lemma: string | null;
  pos: Pos | null;
}

/** Word segments of a text with the analysis chosen in context (lang/choose.ts). */
function wordInfos(pack: Pack, text: string): WordInfo[] {
  const segments = pack.segment(text);
  const chosen = new Map(chooseAnalysesInText(pack, segments, sentenceStartFlags(segments)).map((c) => [c.segIndex, c]));
  const out: WordInfo[] = [];
  segments.forEach((seg, i) => {
    if (seg.kind !== 'word') return;
    const c = chosen.get(i);
    out.push({
      wordIndex: out.length,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      norm: c?.norm ?? (seg.norm || pack.normalize(seg.text)),
      lemma: c?.chosen?.lemma ?? null,
      pos: c?.chosen?.pos ?? (c?.capitalizedMidSentence ? 'PROPN' : null),
    });
  });
  return out;
}

function highlightOf(pack: Pack, attempt: RepairAttempt, heat: Heat): RepairHighlight | null {
  const idx = attempt.judgement.wordIndex ?? attempt.judgement.best?.wordIndex;
  if (idx === null || idx === undefined) return null;
  const w = wordInfos(pack, attempt.text)[idx];
  if (!w) return null;
  return { wordIndex: idx, start: w.start, end: w.end, text: w.text, heat, pos: w.pos };
}

/** Share of the first attempt's words, except the flagged one, that land in `next`. */
export function repairOverlap(pack: Pack, first: RepairAttempt, next: string, opts: Pick<RepairOptions, 'register' | 'regions'>): number {
  const alignment = alignTranscript(first.text, next, pack, { register: opts.register, regions: opts.regions });
  // Alignment indexes words and numbers; Judgement.wordIndex indexes word segments only.
  const flaggedWord = first.judgement.wordIndex;
  const segs = pack.segment(first.text).filter((s) => s.kind === 'word' || s.kind === 'number');
  let wordCount = -1;
  let flaggedContent = -1;
  segs.forEach((s, i) => {
    if (s.kind === 'word') wordCount++;
    if (s.kind === 'word' && wordCount === flaggedWord && flaggedContent < 0) flaggedContent = i;
  });
  const others = alignment.words.filter((w) => w.index !== flaggedContent);
  if (others.length === 0) return 1;
  return others.filter((w) => w.outcome === 'landed').length / others.length;
}

function verdictPrompts(v: Verdict, o: RepairOptions): boolean {
  return o.repairOn.includes(v);
}

/**
 * The answer to show: the best variant of the latest attempt that was flagged (a verdict
 * in repairOn). A later attempt that was not flagged (another sentence) has no answer of
 * its own: its best variant was never asserted.
 */
function showAnswer(state: RepairState, attempts: readonly RepairAttempt[], extra: Partial<RepairState>, o: RepairOptions): RepairState {
  let flagged: RepairAttempt | undefined;
  for (const a of attempts) if (verdictPrompts(a.judgement.verdict, o) && a.judgement.best) flagged = a;
  const best = flagged?.judgement.best ?? null;
  const expected = best?.text ?? null;
  return {
    ...state,
    ...extra,
    attempts,
    phase: 'show_answer',
    highlight: null,
    expected,
    explainKey: best?.explainKey ?? null,
    ui: expected === null ? null : { key: o.fixKey, params: { fix: expected, expected } },
  };
}

/**
 * One step of the repair flow (see the module comment). Pure: returns a new state, or the
 * same state when the input does not apply. The pack is used to locate and analyze the
 * flagged word and to compare a repair attempt with the first one.
 */
export function repairFlow(state: RepairState, input: RepairInput, pack: Pack, opts: Partial<RepairOptions> = {}): RepairState {
  const o: RepairOptions = { ...DEFAULT_REPAIR_OPTIONS, ...opts };
  if (isRepairFinal(state)) return state;

  if (input.type === 'give_up') {
    if (state.phase !== 'prompt_repair' || state.attempts.length === 0) return state;
    return showAnswer(state, state.attempts, { gaveUp: true }, o);
  }

  // An attempt with no words (the recognizer heard nothing, or only punctuation or an
  // emoji) is not an attempt: it neither passes as ok nor uses up a repair.
  if (!pack.segment(input.text).some((x) => x.kind === 'word' || x.kind === 'number')) return state;

  const attempt: RepairAttempt = { text: input.text, at: input.at, judgement: input.judgement };
  const attempts = [...state.attempts, attempt];
  const j = input.judgement;

  if (state.phase === 'awaiting_attempt') {
    if (verdictPrompts(j.verdict, o) && j.best) {
      return { ...state, attempts, phase: 'prompt_repair', highlight: highlightOf(pack, attempt, o.assertHeat), expected: null, explainKey: null, ui: { key: o.promptKey } };
    }
    // A flag outside repairOn (a hint, by default) is shaded lightly, never accepted as ok.
    if (j.verdict !== 'ok' && j.best) {
      return {
        ...state, attempts, phase: 'hinted', highlight: highlightOf(pack, attempt, o.hintHeat), expected: j.best.text, explainKey: null,
        ui: { key: o.expectedKey, params: { expected: j.best.text } },
      };
    }
    return { ...state, attempts, phase: 'ok', highlight: null, expected: null, explainKey: null, ui: null };
  }

  // prompt_repair: a repair attempt.
  const first = state.attempts[0] as RepairAttempt;
  const repairs = state.repairs + 1;
  const mended = repairOverlap(pack, first, attempt.text, o) >= o.minOverlap;
  if (!mended) return showAnswer(state, attempts, { repairs }, o);
  if (verdictPrompts(j.verdict, o) && j.best) {
    if (repairs < o.maxRepairs) {
      return { ...state, attempts, repairs, phase: 'prompt_repair', highlight: highlightOf(pack, attempt, o.assertHeat), ui: { key: o.promptKey } };
    }
    return showAnswer(state, attempts, { repairs }, o);
  }
  const hint = j.verdict !== 'ok' && j.best ? j.best : null;
  return {
    ...state, attempts, repairs, phase: 'repaired',
    highlight: hint ? highlightOf(pack, attempt, o.hintHeat) : null,
    expected: hint ? hint.text : null,
    explainKey: null,
    ui: hint ? { key: o.expectedKey, params: { expected: hint.text } } : null,
  };
}

/** Options of judgeAttempt. */
export interface JudgeAttemptOptions {
  /** Story text before the learner's sentence ('' for a lone sentence). */
  before: string;
  register: Register;
  /** Region codes for the street prefix and slang (see scoring/context.ts); [] = every pack. */
  regions: readonly string[];
  /** Overrides for judgeSentence (register is always taken from `register`). */
  judge: Partial<JudgeOptions>;
}

export const DEFAULT_JUDGE_ATTEMPT_OPTIONS: Readonly<JudgeAttemptOptions> = {
  before: '',
  register: 'neutral',
  regions: [],
  judge: {},
};

/**
 * Judge one attempt with the scoring context the proof test requires: the pack's fixed
 * prefix in neutral register, or in street register the register prefix naming the
 * slang found in the attempt (scoringContext + slangIn), followed by `before`. Then
 * judgeSentence with the same register, so street-tolerant rules are skipped and slang
 * is protected.
 */
export async function judgeAttempt(
  model: LanguageModel,
  pack: LanguagePack,
  text: string,
  opts: Partial<JudgeAttemptOptions> = {},
): Promise<Judgement> {
  const o: JudgeAttemptOptions = { ...DEFAULT_JUDGE_ATTEMPT_OPTIONS, ...opts };
  const words = o.register === 'street' ? slangIn(pack, text, o.regions) : [];
  const context = scoringContext(pack, o.before, { register: o.register, regions: o.regions, words });
  return judgeSentence(model, pack, context, text, { ...o.judge, register: o.register });
}

/**
 * Judge an attempt (judgeAttempt) and step the flow with it. Register and regions are
 * shared by the judge and the flow. A final state is returned unchanged without calling
 * the model.
 */
export async function attemptRepair(
  state: RepairState,
  model: LanguageModel,
  pack: LanguagePack,
  text: string,
  at: number,
  opts: { judge?: Partial<JudgeAttemptOptions>; flow?: Partial<RepairOptions> } = {},
): Promise<RepairState> {
  if (isRepairFinal(state)) return state;
  const register = opts.judge?.register ?? opts.flow?.register ?? DEFAULT_REPAIR_OPTIONS.register;
  const regions = opts.judge?.regions ?? opts.flow?.regions ?? DEFAULT_REPAIR_OPTIONS.regions;
  const judgement = await judgeAttempt(model, pack, text, { ...opts.judge, register, regions });
  return repairFlow(state, { type: 'attempt', text, at, judgement }, pack, { ...opts.flow, register, regions });
}

/**
 * The lexeme a flagged attempt blames: for an inserted word (a missing personal a), the
 * inserted word; otherwise the word at the flagged index, by the lemma of its analysis in
 * context (its normalized form when the pack does not know it).
 */
export function blamedKey(attempt: RepairAttempt, pack: Pack): string | null {
  const best = attempt.judgement.best;
  if (!best) return null;
  if (best.kind === 'insert') {
    const w = wordInfos(pack, best.replacement)[0];
    if (!w) return null;
    return lexemeKey(pack.code, w.lemma ?? w.norm);
  }
  const w = wordInfos(pack, attempt.text)[best.wordIndex];
  if (!w) return null;
  return lexemeKey(pack.code, w.lemma ?? w.norm);
}

/**
 * Suggested learner events of a finished flow (none before it ends), keyed like story
 * selection and gaps/capture.ts: lexemeKey(pack.code, lemma of the analysis in context).
 * - spoke_error for the word blamed by each asserted attempt (repairOn), at that
 *   attempt's time;
 * - spoke_correct for every other known word of the accepted attempt (the first one for
 *   ok, hinted and show_answer; the last for repaired), at its time, except names,
 *   numbers (excludePos), words the pack does not know (possible misrecognitions), the
 *   blamed words and a hinted word (uncertain either way).
 * Each key appears at most once.
 */
export function repairEvents(state: RepairState, pack: Pack, opts: Partial<RepairOptions> = {}): LearnerEvent[] {
  const o: RepairOptions = { ...DEFAULT_REPAIR_OPTIONS, ...opts };
  if (!isRepairFinal(state)) return [];
  const first = state.attempts[0];
  if (!first) return [];
  const events: LearnerEvent[] = [];
  const used = new Set<string>();
  for (const a of state.attempts) {
    if (!verdictPrompts(a.judgement.verdict, o)) continue;
    const key = blamedKey(a, pack);
    if (key && !used.has(key)) {
      used.add(key);
      events.push({ type: 'spoke_error', key, at: a.at });
    }
  }
  const accepted = state.phase === 'repaired' ? (state.attempts[state.attempts.length - 1] as RepairAttempt) : first;
  if (accepted.judgement.verdict !== 'ok') {
    const key = blamedKey(accepted, pack);
    if (key) used.add(key);
  }
  for (const w of wordInfos(pack, accepted.text)) {
    if (w.lemma === null || (w.pos !== null && o.excludePos.includes(w.pos))) continue;
    const key = lexemeKey(pack.code, w.lemma);
    if (used.has(key)) continue;
    used.add(key);
    events.push({ type: 'spoke_correct', key, at: accepted.at });
  }
  return events;
}
