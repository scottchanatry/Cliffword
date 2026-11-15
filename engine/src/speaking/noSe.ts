/**
 * "No sé" always works: the learner hears the answer, then repeats it aloud.
 *
 * Steps
 * -----
 * 1. play_answer: the app plays the answer (the cliff's actual words) and reports
 *    { type: 'played' }. "otra vez" / "más despacio" (the app matches commands) send
 *    { type: 'replay', slower? } and play it again.
 * 2. prompt_repeat: the app asks the learner to say it ('cliff.repeatAloud').
 * 3. align the repeat: { type: 'repeat', transcript, at } aligns the transcript with the
 *    answer (alignTranscript, the hollow-tile view). When enough of it landed the flow is
 *    done; otherwise the learner may try again until maxRepeats, then it is done anyway.
 *    { type: 'skip' } ("siguiente") ends it at any time.
 *
 * Events: cliff_skip for the cliff word when the flow starts, then spoke_correct for the
 * same key if a repeat landed. Match commands against the transcript only after checking
 * it is not the answer itself (matchCommand's `answer` option): a cliff whose word is
 * "siguiente" or "ya" must not end the flow when the learner repeats it.
 */
import type { LanguagePack, Register } from '../lang/types';
import type { LearnerEvent } from '../learner/types';
import { alignTranscript } from './align';
import type { Alignment } from './align';
import type { UiText } from './text';

export type NoSeStep = 'play_answer' | 'prompt_repeat' | 'done';

/** The three steps of the flow, in order (the third happens on each repeat input). */
export const NO_SE_STEPS = ['play_answer', 'prompt_repeat', 'align_repeat'] as const;

export interface NoSeState {
  step: NoSeStep;
  /** The words to hear and repeat (the cliff's actual words). */
  answer: string;
  /** Learner key of the cliff word (pickCliff's key). */
  key: string;
  /** When the learner said "no sé" (ms since epoch). */
  skippedAt: number;
  /** The last replay asked for slower speech ("más despacio"). */
  slower: boolean;
  /** Repeats aligned so far. */
  repeats: number;
  /** Alignment of the latest repeat, or null before the first. */
  last: Alignment | null;
  /** A repeat landed. */
  landed: boolean;
  /** cliff_skip, then spoke_correct when a repeat landed. */
  events: LearnerEvent[];
  /** What the app shows now, as a PairPack.ui lookup; null while playing and when done. */
  ui: UiText | null;
}

export type NoSeInput =
  | { type: 'played' }
  | { type: 'replay'; slower?: boolean }
  | { type: 'repeat'; transcript: string; at: number }
  | { type: 'skip' };

/** Tunable numbers of the no-sé flow. */
export interface NoSeOptions {
  /** Share of the answer's words that must land for the repeat to count. */
  landedShare: number;
  /** Repeats aligned before the flow ends without a landing. */
  maxRepeats: number;
  /** Alignment register and regions (street register accepts clipped forms). */
  register: Register;
  regions: readonly string[];
  /** PairPack.ui key of the prompt to repeat. */
  repeatKey: string;
}

/**
 * Defaults (judgement calls):
 * - landedShare 1: the learner has just heard the answer, which is at most a few words
 *   (cliffs hide up to 4), so every word should land.
 * - maxRepeats 2: one retry after a miss, then move on; repeating a word over and over
 *   is the opposite of the story's pace.
 * - repeatKey: the en-es pair pack's 'cliff.repeatAloud'.
 */
export const DEFAULT_NO_SE_OPTIONS: Readonly<NoSeOptions> = {
  landedShare: 1,
  maxRepeats: 2,
  register: 'neutral',
  regions: [],
  repeatKey: 'cliff.repeatAloud',
};

/** Start the flow when the learner says "no sé": play the answer; the cliff_skip event is recorded now. */
export function startNoSe(args: { answer: string; key: string; at: number }): NoSeState {
  return {
    step: 'play_answer',
    answer: args.answer,
    key: args.key,
    skippedAt: args.at,
    slower: false,
    repeats: 0,
    last: null,
    landed: false,
    events: [{ type: 'cliff_skip', key: args.key, at: args.at }],
    ui: null,
  };
}

/**
 * One step of the no-sé flow (see the module comment). Pure: returns a new state, or the
 * same state when the input does not apply (anything after done; 'played' outside
 * play_answer). A repeat is accepted while playing too (the learner may talk over).
 */
export function advanceNoSe(
  state: NoSeState,
  input: NoSeInput,
  pack: Pick<LanguagePack, 'code' | 'segment' | 'normalize' | 'foldAccents' | 'registers'>,
  opts: Partial<NoSeOptions> = {},
): NoSeState {
  const o: NoSeOptions = { ...DEFAULT_NO_SE_OPTIONS, ...opts };
  if (state.step === 'done') return state;
  switch (input.type) {
    case 'played':
      return state.step === 'play_answer' ? { ...state, step: 'prompt_repeat', ui: { key: o.repeatKey } } : state;
    case 'replay':
      return { ...state, step: 'play_answer', slower: input.slower === true, ui: null };
    case 'skip':
      return { ...state, step: 'done', ui: null };
    case 'repeat': {
      const last = alignTranscript(state.answer, input.transcript, pack, { register: o.register, regions: o.regions });
      const repeats = state.repeats + 1;
      const landed = last.total > 0 && last.share >= o.landedShare - 1e-9;
      if (landed) {
        return {
          ...state, step: 'done', repeats, last, landed: true, ui: null,
          events: [...state.events, { type: 'spoke_correct', key: state.key, at: input.at }],
        };
      }
      const done = repeats >= o.maxRepeats;
      return { ...state, step: done ? 'done' : 'prompt_repeat', repeats, last, ui: done ? null : { key: o.repeatKey } };
    }
  }
}
