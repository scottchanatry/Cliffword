/**
 * Sentence views: the words of a story sentence as the app draws them, with text fading
 * per word (BRIEF "Levels"): a word is text until the learner knows it by ear, then a
 * blank tile sized by its spoken length; the learner can force all text or all tiles.
 *
 * Words come from LanguagePack.segment() (never split on spaces). Punctuation is attached
 * to the word it belongs to: after a word up to whitespace (trail), after whitespace up
 * to the next word (lead), so "¿Qué" keeps its "¿" and "cerrado." its ".".
 */
import type { LanguagePack, Pos, Register } from '../lang/types';
import type { PairPack } from '../pair/types';
import type { DifficultyParams, LearnerView } from '../learner/types';
import { showText } from '../learner/difficulty';
import { chooseAnalysesInText, firstLetterUpper } from '../lang/choose';
import { sentenceStartFlags } from '../story/text';
import { findSlangMatches } from '../lyrics/slang';
import { estimateDurationMs, type DurationOptions } from '../speaking/duration';
import { keyFor } from './common';
import type { SentenceView, SessionSettings, ViewWord, WordDisplay } from './types';

/** One word or number of a sentence with its analysis and slang flags (no learner state). */
export interface SentenceWord {
  index: number;
  text: string;
  lead: string;
  trail: string;
  spaceAfter: boolean;
  /** Character span in the sentence. */
  start: number;
  end: number;
  norm: string;
  lemma: string | null;
  pos: Pos | null;
  key: string;
  kind: 'word' | 'number';
  slang: boolean;
  explicit: boolean;
}

/** Tunable numbers of sentence views. */
export interface ViewOptions {
  /** A word is new (gets a gloss chip) while pKnown(meaning) is below this. */
  newBelow: number;
  /** Parts of speech that are never new words (names and numbers carry no vocabulary). */
  neverNewPos: readonly Pos[];
  /** Duration estimates (tile widths). */
  duration: Partial<DurationOptions>;
}

/**
 * Defaults. newBelow 0.5 is the story selector's unknownBelow (DEFAULT_SELECT_OPTIONS):
 * the words selection counts as new are the words that get a gloss. Names and numbers
 * are never new, as selection leaves them out of the known-word share.
 */
export const DEFAULT_VIEW_OPTIONS: Readonly<ViewOptions> = {
  newBelow: 0.5,
  neverNewPos: ['PROPN', 'NUM'],
  duration: {},
};

/**
 * The words of `text` with lead and trail punctuation, learner keys (lexemeKey of the
 * analysis chosen in context, as story selection keys them; a capitalized word the pack
 * does not know is a name, keyed by its normalized form) and slang flags
 * from the applicable register packs (forms that are also standard words count as slang
 * only in street register).
 */
export function sentenceWords(pack: LanguagePack, text: string, opts: { register: Register; regions: readonly string[] }): SentenceWord[] {
  const segments = pack.segment(text);
  const starts = sentenceStartFlags(segments);
  const chosen = new Map(chooseAnalysesInText(pack, segments, starts).map((c) => [c.segIndex, c]));
  const matches = findSlangMatches(pack, text, { regions: opts.regions, alsoStandard: opts.register === 'street' });
  const out: SentenceWord[] = [];
  let pendingLead = '';
  let afterWord = false;
  segments.forEach((seg, i) => {
    if (seg.kind === 'space') {
      const last = out[out.length - 1];
      if (afterWord && last) last.spaceAfter = true;
      afterWord = false;
      return;
    }
    if (seg.kind === 'punct') {
      const last = out[out.length - 1];
      if (afterWord && last) last.trail += seg.text;
      else pendingLead += seg.text;
      return;
    }
    const c = chosen.get(i);
    const norm = c?.norm ?? (seg.norm || pack.normalize(seg.text));
    // A capitalized word the pack does not know is a name, at a sentence start too: function
    // words are all in a pack's lexicon, so "Marta" opening a sentence is a name, not a new word.
    const unknownCapital = !c?.chosen && firstLetterUpper(seg.text);
    const pos: Pos | null = seg.kind === 'number' ? 'NUM' : c?.chosen?.pos ?? (unknownCapital ? 'PROPN' : null);
    const lemma = seg.kind === 'number' ? null : c?.chosen?.lemma ?? null;
    const m = matches.find((x) => x.start < seg.end && seg.start < x.end);
    out.push({
      index: out.length,
      text: seg.text,
      lead: pendingLead,
      trail: '',
      spaceAfter: false,
      start: seg.start,
      end: seg.end,
      norm,
      lemma,
      pos,
      key: keyFor(pack, lemma ?? undefined, norm),
      kind: seg.kind === 'number' ? 'number' : 'word',
      slang: m !== undefined,
      explicit: m?.entry.explicit === true,
    });
    pendingLead = '';
    afterWord = true;
  });
  // Punctuation after the last space with no word after it belongs to the last word.
  const last = out[out.length - 1];
  if (last && pendingLead) last.trail += pendingLead;
  return out;
}

/** Where the cliff is while the view is built, and which words are already revealed. */
export interface ViewState {
  /** The hidden span (word indices) and whether the learner has answered (landing). */
  cliff: { wordIndex: number; length: number; answered: boolean } | null;
  /** Words the learner held to see (shown as text for the rest of the sentence). */
  revealed: readonly number[];
}

export interface ViewContext {
  pack: LanguagePack;
  pair: PairPack;
  learner: LearnerView;
  now: number;
  params: Pick<DifficultyParams, 'tileThreshold'>;
  settings: Pick<SessionSettings, 'textMode' | 'showExplicit'>;
  /** The rate the sentence is played at. */
  rate: number;
  options?: Partial<ViewOptions>;
}

/**
 * The view of a sentence. Display per word:
 * - masked: explicit slang while showExplicit is off;
 * - gap: hidden by an unanswered cliff; future: after an unanswered cliff (not heard yet);
 * - text or tile: textMode all_text / all_tiles, else showText (pKnown(sound) below the
 *   tile threshold shows text); a word the learner held to see stays text; once the
 *   cliff is answered its words are text (the answer is revealed).
 * New words (pKnown(meaning) below newBelow, not names or numbers) carry their gloss and
 * any false-friend warning; the gloss chip lists those the learner can see.
 */
export function buildSentenceView(text: string, words: readonly SentenceWord[], state: ViewState, ctx: ViewContext): SentenceView {
  const o: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, ...ctx.options };
  const revealed = new Set(state.revealed);
  const cliff = state.cliff;
  const out: ViewWord[] = [];
  const glosses: SentenceView['glosses'] = [];
  let total = 0;
  for (const w of words) {
    const inCliff = cliff !== null && w.index >= cliff.wordIndex && w.index < cliff.wordIndex + cliff.length;
    const afterCliff = cliff !== null && w.index >= cliff.wordIndex + cliff.length;
    let shown: boolean;
    if (ctx.settings.textMode === 'all_text') shown = true;
    else if (ctx.settings.textMode === 'all_tiles') shown = false;
    else shown = showText(ctx.learner, w.key, ctx.now, ctx.params);
    if (revealed.has(w.index)) shown = true;
    let display: WordDisplay = shown ? 'text' : 'tile';
    if (cliff && !cliff.answered && inCliff) display = 'gap';
    else if (cliff && !cliff.answered && afterCliff) display = 'future';
    else if (cliff && cliff.answered && inCliff) display = 'text';
    if (w.explicit && !ctx.settings.showExplicit) display = 'masked';
    const counted = w.kind === 'word' && (w.pos === null || !o.neverNewPos.includes(w.pos));
    const isNew = counted && ctx.learner.pKnown(w.key, 'meaning', ctx.now) < o.newBelow;
    const durationMs = estimateDurationMs(w.norm, ctx.pack, ctx.rate, o.duration);
    total += durationMs;
    const v: ViewWord = {
      index: w.index,
      text: w.text,
      lead: w.lead,
      trail: w.trail,
      spaceAfter: w.spaceAfter,
      key: w.key,
      display,
      durationMs,
      isNew,
      slang: w.slang,
      explicit: w.explicit,
    };
    if (isNew) {
      const gloss = ctx.pair.gloss(w.lemma ?? w.norm);
      if (gloss !== undefined) v.gloss = gloss;
      const ff = ctx.pair.falseFriends?.[w.lemma ?? w.norm];
      if (ff !== undefined) v.falseFriend = ff;
      if (gloss !== undefined && (display === 'text' || display === 'tile')) glosses.push({ index: w.index, word: w.text, gloss });
    }
    out.push(v);
  }
  return { text, words: out, speechRate: ctx.rate, durationMs: total, glosses, slang: words.some((w) => w.slang) };
}
