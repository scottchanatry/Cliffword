/**
 * Lyric cliffs and brought-text cliffs: where the track (or the text) stops and the
 * learner says or sings what comes next, and how much credit the answer earns.
 *
 * The model only rates positions and scores answers through the public scoring API
 * (cliffPositions, scoreCliffAnswer) after the scoring prefix of the register
 * (scoringPrefix with the slang found by slangIn). Two proof-test results shape the
 * rest (proof/RESULTS.md):
 * - Slang scores about 4.5 nats per word worse than neutral Spanish and next-word lists
 *   after slang are useless (top-10 mass 0.12). So a cliff on a slang word is never
 *   excluded or ranked by the model's probability, and its accepted answers come from
 *   the lyrics (the actual words) and the register pack (their neutral equivalent).
 * - Standard text scores well (97% minimal-pair accuracy), so other answers are judged
 *   by the model, in neutral form when slang is involved.
 *
 * Language-neutral: words come from LanguagePack.segment(); slang, neutral equivalents
 * and labels come from the packs.
 */
import type { LanguagePack, Pos, Register, Segment } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { CliffPosition, CliffResult, Credit, NextWord } from '../scoring/types';
import type { LearnerView } from '../learner/types';
import { lexemeKey, lexemeOf } from '../learner/types';
import { chooseAnalysesInText } from '../lang/choose';
import { cliffPositions, scoreCliffAnswer, type CliffOptions, type CreditOptions } from '../scoring/cliff';
import { scoringPrefix, slangIn } from '../scoring/context';
import { DEFAULT_ACCENT_MARKS, needsLeadingSpace } from '../scoring/text';
import { clamp01, isCapitalized, sentenceStartFlags } from '../story/text';
import type { Lyrics } from './parse';
import { findSlangMatches, registerPairs, type SlangMatch } from './slang';
import { contentSegmentsOf, looseKey, normOf, type UiText } from './text';
import { lyricUnits, splitTextUnits, unitsBefore, type SplitTextOptions, type TextUnit } from './units';

/** Weights of the cliff score (see DEFAULT_TEXT_CLIFF_WEIGHTS for the reasoning). */
export interface TextCliffWeights {
  /** The hidden span ends at the end of the line (or sentence). */
  unitEnd: number;
  /** The hidden span ends at a clause mark inside the line (comma, colon...). */
  clauseEnd: number;
  /** Times (words - 1) / (cliffWords - 1): longer chunks, up to the learner's cliff length. */
  chunk: number;
  /** Street register: the span holds slang. */
  slang: number;
  /** A hidden word's lexeme is one of opts.targets. */
  target: number;
  /** Times pKnown(meaning) x (1 - pKnown(speaking)) of the first hidden word. */
  meaningNotSpeaking: number;
  /** Times P(actual first word); not used when that word is slang. */
  prob: number;
  /** The line repeats an earlier line (a chorus): the learner has heard it. */
  repeat: number;
}

export const DEFAULT_TEXT_CLIFF_WEIGHTS: Readonly<TextCliffWeights> = {
  // target, meaningNotSpeaking and prob are the story's cliff weights
  // (DEFAULT_CLIFF_PICK_OPTIONS), so a word weighs the same in a story and in a song.
  target: 2,
  meaningNotSpeaking: 1.5,
  prob: 0.5,
  // Judgement: the end of a lyric line carries the rhyme and the beat, and the track can
  // stop at its natural pause (the C1 and A3 screens stop there). Worth less than a
  // target word, more than the whole probability term.
  unitEnd: 1,
  // A comma inside a line is a smaller pause: between the story's context weight (0.3)
  // and a line end.
  clauseEnd: 0.4,
  // Multi-word chunks practise phrases (BRIEF, advanced: cliffs span several words).
  // Half a line end, so a one-word cliff at the line end still beats a full-length
  // chunk that ends nowhere.
  chunk: 0.5,
  // Street mode exists to practise the register; just below the learner-gap maximum.
  slang: 1.5,
  // A repeated line (chorus) has been heard: recalling it is fair and fun.
  repeat: 0.5,
};

export interface TextCliffOptions {
  register: Register;
  /** Register-pack regions as in scoring/context.ts; [] = every pack the language pack holds. */
  regions: readonly string[];
  learner?: LearnerView;
  /** Time for pKnown, ms since epoch. */
  now: number;
  /** Lexeme keys being practised ("es:salir"). */
  targets: readonly string[];
  /** Most words hidden at once (the learner's DifficultyParams.cliffWords). */
  cliffWords: number;
  /** Earlier units (lines, sentences) put before the unit as context. */
  contextUnits: number;
  /**
   * Most start positions analysed per unit. Each costs a next-word search (up to 50
   * model calls with the default search), so this bounds the cost of a unit to about
   * 1 + 50 x maxPositions calls. Line-end positions are analysed first, then slang, then
   * clause ends, then chunks that stop before a name or number.
   */
  maxPositions: number;
  /** Cliffs returned per unit, best first. */
  limit: number;
  /**
   * A cliff whose first hidden word has P(actual) below this is excluded, unless that
   * word is slang (the model cannot judge slang) or the unit repeats an earlier one (the
   * learner has heard it). Same value as the story's DEFAULT_CLIFF_PICK_OPTIONS.probFloor.
   */
  probFloor: number;
  /** When false, spans holding explicit slang are not used as cliffs. */
  showExplicit: boolean;
  /** Match slang written without accents or apostrophes (see SlangMatchOptions.loose). */
  loose: boolean;
  /** Characters of a punctuation segment that end a clause (Latin and CJK). */
  clauseMarks: string;
  /** Parts of speech never hidden (names, numbers). */
  excludePos: readonly Pos[];
  /** A capitalized word the pack does not know, away from the start of its unit, is a name. */
  capitalizedUnknownAsPropn: boolean;
  weights: TextCliffWeights;
  /** Passed to cliffPositions (positions is set here). */
  cliff: Partial<CliffOptions>;
}

const BASE_TEXT_CLIFF_OPTIONS: Readonly<Omit<TextCliffOptions, 'register' | 'cliffWords' | 'contextUnits'>> = {
  regions: [],
  now: 0,
  targets: [],
  // Enough for the line-end chunks at the default cliff length plus one or two slang or
  // clause positions, at about 200 model calls per unit (1.9 s for 1 + 6 scorings on 4
  // CPU cores in the proof test; measure on a phone).
  maxPositions: 4,
  // The best cliff plus two fallbacks, for when the learner has just practised the best
  // one or skips it.
  limit: 3,
  probFloor: 0.02,
  showExplicit: true,
  loose: true,
  clauseMarks: ',;:—–…、，；：.!?。！？',
  excludePos: ['PROPN', 'NUM'],
  capitalizedUnknownAsPropn: true,
  weights: DEFAULT_TEXT_CLIFF_WEIGHTS,
  cliff: {},
};

export interface LyricCliffOptions extends TextCliffOptions {
  /** Line indices to analyse (every line when omitted); the app asks for the lines coming up. */
  lines?: readonly number[];
  /** Leave ad-lib lines (whole line in parentheses) out of cliffs and context. */
  skipAdlibs: boolean;
}

export const DEFAULT_LYRIC_CLIFF_OPTIONS: Readonly<Omit<LyricCliffOptions, 'register'>> = {
  ...BASE_TEXT_CLIFF_OPTIONS,
  // Judgement: a two-word line ending ("pa' bailar") is the typical lyric hook; the
  // learner model's cliffWords (1 to 4) overrides it.
  cliffWords: 2,
  // A couplet: rhyme and phrase continuity usually span the previous one or two lines.
  contextUnits: 2,
  skipAdlibs: true,
};

export interface BroughtTextCliffOptions extends TextCliffOptions, SplitTextOptions {
  /** Sentence indices to analyse (every sentence when omitted). */
  sentences?: readonly number[];
}

export const DEFAULT_BROUGHT_TEXT_CLIFF_OPTIONS: Readonly<Omit<BroughtTextCliffOptions, 'register'>> = {
  ...BASE_TEXT_CLIFF_OPTIONS,
  splitLines: true,
  // Brought text is the advanced feature: cliffs span several words and idioms.
  cliffWords: 3,
  contextUnits: 2,
};

export type CliffBoundary = 'unit' | 'clause' | 'none';

/** One ranked cliff choice in a line or sentence. */
export interface TextCliff {
  /** Line id ("l3") or sentence id ("s3"). */
  unitId: string;
  unitIndex: number;
  /** Index of the first hidden word among the unit's word segments. */
  wordIndex: number;
  wordCount: number;
  /** The hidden words as written. */
  words: string[];
  /** Character span of the hidden words in the unit text. */
  start: number;
  end: number;
  /** The hidden text as written (the lyric's own words). */
  answer: string;
  /**
   * Answers taken from the lyrics and the pack, not the model: the actual words, then
   * their neutral paraphrase when the span holds slang ("'tá listo" -> "está listo").
   */
  accepted: string[];
  /** The full scoring context before the cliff; pass the cliff to scoreLyricAnswer. */
  context: string;
  /** The context without the scoring prefix: earlier units and the unit up to the cliff. */
  before: string;
  /** Learner key of the first hidden word (the slang lexeme for slang). */
  key: string;
  /** Learner keys of every hidden word. */
  keys: string[];
  /** Slang inside the span (offsets in the unit text). */
  slang: SlangMatch[];
  boundary: CliffBoundary;
  /** The unit repeats an earlier one. */
  repeat: boolean;
  /** The model's rating of the first hidden word (its segment in unit-text offsets). */
  position: CliffPosition;
  /** P(actual first word). */
  prob: number;
  score: number;
  /** How the score was made (for debugging and tuning; not display text). */
  reasons: string[];
  /** Start time of the line, for timed lyrics. */
  startMs?: number;
}

/** The ranked cliffs of one line or sentence. */
export interface UnitCliffs {
  id: string;
  index: number;
  text: string;
  /** Offset of the unit in the brought text (0 for lyric lines). */
  start: number;
  cliffs: TextCliff[];
}

interface Span {
  start: number;
  len: number;
  boundary: CliffBoundary;
}

const fmt = (x: number) => (Math.round(x * 1000) / 1000).toString();

/** Rank cliffs in the given units (shared by lyricCliffs and broughtTextCliffs). */
async function rankUnits(
  model: LanguageModel,
  pack: LanguagePack,
  units: readonly TextUnit[],
  wanted: readonly number[] | undefined,
  o: TextCliffOptions,
): Promise<UnitCliffs[]> {
  const select = wanted === undefined ? units.map((_, i) => i) : [...new Set(wanted)].filter((i) => i >= 0 && i < units.length).sort((a, b) => a - b);
  const out: UnitCliffs[] = [];
  for (const u of select) {
    const unit = units[u] as TextUnit;
    out.push({ id: unit.id, index: unit.index, text: unit.text, start: unit.start, cliffs: unit.skip ? [] : await rankUnit(model, pack, units, u, o) });
  }
  return out;
}

async function rankUnit(
  model: LanguageModel,
  pack: LanguagePack,
  units: readonly TextUnit[],
  u: number,
  o: TextCliffOptions,
): Promise<TextCliff[]> {
  const unit = units[u] as TextUnit;
  const segs = pack.segment(unit.text);
  const words = segs.filter((s) => s.kind === 'word');
  const n = words.length;
  const maxLen = Math.max(1, Math.round(o.cliffWords));
  if (n < 2) return [];

  // Clause marks after each word (before the next word or the end).
  const segIndexOfWord: number[] = [];
  segs.forEach((s, i) => {
    if (s.kind === 'word') segIndexOfWord.push(i);
  });
  const marks = new Set(Array.from(o.clauseMarks));
  const clauseAfter = words.map((_, w) => {
    const from = (segIndexOfWord[w] as number) + 1;
    const to = w + 1 < n ? (segIndexOfWord[w + 1] as number) : segs.length;
    for (let i = from; i < to; i++) {
      const s = segs[i] as Segment;
      if (s.kind === 'punct' && Array.from(s.text).some((ch) => marks.has(ch))) return true;
    }
    return false;
  });
  // A number between two words breaks a span too (numbers are not word segments).
  const numberAfter = words.map((_, w) => {
    const from = (segIndexOfWord[w] as number) + 1;
    const to = w + 1 < n ? (segIndexOfWord[w + 1] as number) : segs.length;
    for (let i = from; i < to; i++) if ((segs[i] as Segment).kind === 'number') return true;
    return false;
  });
  const boundaryAt = (last: number): CliffBoundary => (last === n - 1 ? 'unit' : clauseAfter[last] ? 'clause' : 'none');

  const matches = findSlangMatches(pack, unit.text, { regions: o.regions, loose: o.loose, alsoStandard: o.register === 'street' });
  const slangAt = new Map<number, SlangMatch>();
  for (const m of matches) for (let j = 0; j < m.wordCount; j++) slangAt.set(m.wordIndex + j, m);

  // One analysis per word in context, for names, numbers and learner keys.
  const choices = new Map(chooseAnalysesInText(pack, segs, sentenceStartFlags(segs)).map((c) => [c.segIndex, c]));
  const excludedPos = new Set(o.excludePos);
  const keyOf = (w: number): string => {
    const m = slangAt.get(w);
    if (m) return lexemeKey(pack.code, m.entry.lemma);
    const c = choices.get(segIndexOfWord[w] as number);
    return lexemeKey(pack.code, c?.chosen?.lemma ?? normOf(pack, words[w] as Segment));
  };
  /** A name or number (by its chosen analysis, or a capitalized unknown word away from the start). */
  const isNameOrNumber = (w: number): boolean => {
    const c = choices.get(segIndexOfWord[w] as number);
    if (c?.chosen) return excludedPos.has(c.chosen.pos);
    if (slangAt.has(w)) return false;
    return o.capitalizedUnknownAsPropn && w > 0 && isCapitalized((words[w] as Segment).text) && excludedPos.has('PROPN');
  };

  /**
   * Why a span can never be a cliff, before asking the model: it would cross a clause
   * mark or a number, hold a name or number, cut a slang phrase, or hold explicit slang
   * with explicit lyrics off. Returns the slang inside the span otherwise.
   */
  const check = (start: number, len: number): SlangMatch[] | undefined => {
    const last = start + len - 1;
    for (let w = start; w < last; w++) if (clauseAfter[w] || numberAfter[w]) return undefined;
    for (let w = start; w <= last; w++) if (isNameOrNumber(w)) return undefined;
    const inside: SlangMatch[] = [];
    for (const m of matches) {
      const mEnd = m.wordIndex + m.wordCount - 1;
      if (m.wordIndex > last || mEnd < start) continue;
      if (m.wordIndex < start || mEnd > last) return undefined;
      inside.push(m);
    }
    if (!o.showExplicit && inside.some((m) => m.entry.explicit)) return undefined;
    return inside;
  };

  // Candidate spans, in priority order: line-end chunks, slang spans, clause-end chunks,
  // and chunks that stop before a name or a number (as the story's cliffSpan does).
  const spans: (Span & { inside: SlangMatch[] })[] = [];
  const add = (start: number, len: number) => {
    if (start < 1 || len < 1 || len > maxLen || start + len > n) return;
    if (spans.some((s) => s.start === start && s.len === len)) return;
    const inside = check(start, len);
    if (inside) spans.push({ start, len, boundary: boundaryAt(start + len - 1), inside });
  };
  for (let k = 1; k <= maxLen; k++) add(n - k, k);
  for (const m of matches) add(m.wordIndex, m.wordCount);
  for (let w = 0; w < n - 1; w++) if (clauseAfter[w]) for (let k = 1; k <= maxLen; k++) add(w - k + 1, k);
  for (let w = 0; w < n - 1; w++) {
    if (numberAfter[w] || isNameOrNumber(w + 1)) for (let k = 1; k <= maxLen; k++) add(w - k + 1, k);
  }

  const starts: number[] = [];
  for (const s of spans) if (!starts.includes(s.start) && starts.length < Math.max(1, o.maxPositions)) starts.push(s.start);
  const usable = spans.filter((s) => starts.includes(s.start));
  if (usable.length === 0) return [];

  // Context: scoring prefix (naming the slang of the context and the unit) + earlier units.
  const before = unitsBefore(units, u, o.contextUnits);
  const prefix = scoringPrefix(pack, {
    register: o.register,
    regions: o.regions,
    words: slangIn(pack, before + unit.separator + unit.text, o.regions),
  });
  const context = prefix + before;
  const lead = needsLeadingSpace(context) ? ' ' : '';
  const positions = await cliffPositions(model, pack, context, lead + unit.text, { ...o.cliff, positions: starts });
  // Report each position's segment in unit-text offsets (the scored string has the lead).
  const posByWord = new Map(
    positions.map((p) => [
      p.wordIndex,
      { ...p, segment: { ...p.segment, start: p.segment.start - lead.length, end: p.segment.end - lead.length } },
    ]),
  );
  const targets = new Set(o.targets.map(lexemeOf));

  const cliffs: TextCliff[] = [];
  for (const span of usable) {
    const position = posByWord.get(span.start);
    if (!position) continue;
    const last = span.start + span.len - 1;
    const inside = span.inside;
    const slangStart = slangAt.has(span.start);
    const prob = Number.isFinite(position.actualLogprob) ? Math.exp(position.actualLogprob) : 0;
    // The model cannot judge slang, and a repeated line has been heard.
    if (prob < o.probFloor && !slangStart && !unit.repeat) continue;

    const keys = Array.from({ length: span.len }, (_, k) => keyOf(span.start + k));
    const key = keys[0] as string;
    const w = o.weights;
    const reasons: string[] = [];
    let score = 0;
    const part = (value: number, why: string) => {
      if (value === 0) return;
      score += value;
      reasons.push(`${why} (+${fmt(value)})`);
    };
    if (span.boundary === 'unit') part(w.unitEnd, 'ends the line');
    else if (span.boundary === 'clause') part(w.clauseEnd, 'ends a clause');
    if (maxLen > 1) part((w.chunk * (span.len - 1)) / (maxLen - 1), `${span.len} of ${maxLen} words`);
    if (o.register === 'street' && inside.length > 0) part(w.slang, `slang ${inside.map((m) => m.entry.form).join(', ')}`);
    if (keys.some((k) => targets.has(k))) part(w.target, 'target word');
    if (o.learner) {
      const pM = clamp01(o.learner.pKnown(key, 'meaning', o.now));
      const pS = clamp01(o.learner.pKnown(key, 'speaking', o.now));
      part(w.meaningNotSpeaking * pM * (1 - pS), `meaning ${fmt(pM)}, speaking ${fmt(pS)}`);
    }
    if (!slangStart) part(w.prob * prob, `P(actual) ${fmt(prob)}`);
    else reasons.push('slang: answers from the lyrics and the pack');
    if (unit.repeat) part(w.repeat, 'heard before');

    const first = words[span.start] as Segment;
    const lastSeg = words[last] as Segment;
    const answer = unit.text.slice(first.start, lastSeg.end);
    const neutral = registerPairs(answer, pack, o.regions, { loose: o.loose, alsoStandard: o.register === 'street' }).neutral;
    const accepted = [answer];
    if (neutral !== answer) accepted.push(neutral);
    const beforeCliff = before + lead + unit.text.slice(0, first.start);
    const cliff: TextCliff = {
      unitId: unit.id,
      unitIndex: unit.index,
      wordIndex: span.start,
      wordCount: span.len,
      words: words.slice(span.start, last + 1).map((s) => s.text),
      start: first.start,
      end: lastSeg.end,
      answer,
      accepted,
      context: prefix + beforeCliff,
      before: beforeCliff,
      key,
      keys,
      slang: inside,
      boundary: span.boundary,
      repeat: unit.repeat,
      position,
      prob,
      score,
      reasons,
    };
    if (unit.startMs !== undefined) cliff.startMs = unit.startMs;
    cliffs.push(cliff);
  }
  cliffs.sort((a, b) => b.score - a.score || b.prob - a.prob || b.wordIndex - a.wordIndex || b.wordCount - a.wordCount);
  return cliffs.slice(0, Math.max(0, o.limit));
}

/**
 * Ranked cliff choices for each line of the lyrics (or the lines in opts.lines).
 *
 * Method, per line (ad-libs skipped when skipAdlibs):
 * 1. Candidate spans: chunks of 1 to cliffWords words that end the line, the slang spans
 *    of the line (findSlangMatches; phrases whole), chunks that end at a clause mark
 *    inside the line, and chunks that stop before a name or a number. Never the line's
 *    first word; a span never crosses a clause mark or a number, never cuts a slang
 *    phrase, and holds no name or number (pickCliff's rules), nor explicit slang when
 *    showExplicit is false. These checks need no model call, so maxPositions is spent
 *    on usable spans only.
 * 2. Rating: cliffPositions on the line after the context (scoringPrefix of the register,
 *    naming the slang of the context and the line, then the previous contextUnits lines,
 *    one per line), for the first word of each span (at most maxPositions starts).
 * 3. Exclusion: a first word with P(actual) below probFloor, unless it is slang or the
 *    line repeats an earlier one.
 * 4. Score: the weights of TextCliffWeights (line end, clause end, chunk length, slang in
 *    street register, targets, the learner's meaning-not-speaking gap, P(actual), a
 *    repeated line). Ties: higher P(actual), then later, then longer.
 * Each cliff carries its scoring context, so scoreLyricAnswer needs no other input, and
 * the answers taken from the lyrics and the pack (accepted).
 */
export async function lyricCliffs(
  model: LanguageModel,
  pack: LanguagePack,
  lyrics: Lyrics,
  opts: Partial<LyricCliffOptions> & { register: Register },
): Promise<UnitCliffs[]> {
  const o: LyricCliffOptions = { ...DEFAULT_LYRIC_CLIFF_OPTIONS, ...opts };
  return rankUnits(model, pack, lyricUnits(lyrics, o.skipAdlibs), o.lines, o);
}

/**
 * Ranked multi-word cliff choices in a text the learner brings (an article, a
 * transcript, lyrics as prose): the text is split into sentences (splitTextUnits: line
 * breaks, then story/text.ts splitSentences) and each sentence is handled like a lyric
 * line, after the previous contextUnits sentences. A sentence-final chunk takes the
 * line-end weight. Idioms come in as phrase entries of the register packs (kept whole).
 */
export async function broughtTextCliffs(
  model: LanguageModel,
  pack: LanguagePack,
  text: string,
  opts: Partial<BroughtTextCliffOptions> & { register: Register },
): Promise<UnitCliffs[]> {
  const o: BroughtTextCliffOptions = { ...DEFAULT_BROUGHT_TEXT_CLIFF_OPTIONS, ...opts };
  const split: Partial<SplitTextOptions> = { splitLines: o.splitLines };
  if (o.abbreviations) split.abbreviations = o.abbreviations;
  return rankUnits(model, pack, splitTextUnits(pack, text, split), o.sentences, o);
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/**
 * Why an answer that is not the lyric's own words still earned credit:
 * - spelling: the lyric's words without accents, apostrophes or case ("pa" for "pa'");
 * - neutral_for_street: the neutral equivalent of the slang in the lyric ("está" for "'tá");
 * - street_for_neutral: a slang form where the lyric has the neutral word ("pa'" for "para");
 * - street_variant: other slang with the same neutral meaning;
 * - judged_neutral: no equivalence, but the model accepted the answer once both were put
 *   in neutral form (the model cannot judge slang, it can judge standard text).
 */
export type LyricEquivalenceKind = 'spelling' | 'neutral_for_street' | 'street_for_neutral' | 'street_variant' | 'judged_neutral';

export interface LyricEquivalence {
  kind: LyricEquivalenceKind;
  /** The street forms and neutral forms involved, as written. */
  pairs: { street: string; neutral: string }[];
  /**
   * Why, as a PairPack.ui key: "lyrics.answer.<kind in camelCase>", with params answer
   * (the learner's words), lyric (the actual words), street and neutral (the pairs, joined
   * by ", ").
   */
  explain: UiText;
}

export interface LyricAnswerResult extends CliffResult {
  /** Set when credit came from (or is explained by) an equivalence. */
  equivalence?: LyricEquivalence;
  /** scoreCliffAnswer's result for the answer as given, before any tolerance. */
  model: CliffResult;
}

export interface LyricAnswerOptions {
  register: Register;
  regions: readonly string[];
  /** Options for scoreCliffAnswer. */
  credit: Partial<CreditOptions>;
  /**
   * Credit for the neutral equivalent of a slang target, in any register. Full: it is
   * natural standard text with the lyric's meaning, which is exactly what neutral mode
   * teaches and what street mode teaches side by side.
   */
  neutralCredit: Credit;
  /**
   * Credit for slang where the lyric has the neutral form, in neutral register (street
   * register always gives full). Partial: the meaning is right but the learner asked to
   * practise neutral speech.
   */
  streetCreditInNeutral: Credit;
  /** Match slang written without accents or apostrophes. */
  loose: boolean;
  /** Combining marks folded when the pack has no foldAccents. */
  accentMarks: string;
}

export const DEFAULT_LYRIC_ANSWER_OPTIONS: Readonly<Omit<LyricAnswerOptions, 'register'>> = {
  regions: [],
  credit: {},
  neutralCredit: 'full',
  streetCreditInNeutral: 'partial',
  loose: true,
  accentMarks: DEFAULT_ACCENT_MARKS,
};

const CREDIT_RANK: Record<Credit, number> = { none: 0, partial: 1, full: 2 };

const EXPLAIN_KEYS: Record<LyricEquivalenceKind, string> = {
  spelling: 'lyrics.answer.spelling',
  neutral_for_street: 'lyrics.answer.neutralForStreet',
  street_for_neutral: 'lyrics.answer.streetForNeutral',
  street_variant: 'lyrics.answer.streetVariant',
  judged_neutral: 'lyrics.answer.judgedNeutral',
};

/** The cliff fields scoreLyricAnswer needs (a TextCliff has them). */
export interface LyricAnswerTarget {
  /** Scoring context before the cliff. */
  context: string;
  /** The actual words. */
  answer: string;
  /** The context without its scoring prefix, used to rescore in neutral form. */
  before?: string;
  /**
   * Precomputed next words at `context` (TextCliff.position.alternatives, when the cliff
   * options and the credit options search alike: alternativesReusable). Passed to
   * scoreCliffAnswer as CreditOptions.alternatives for the answer as given, so it makes
   * no next-word search; the neutral rescoring has another context and searches as usual.
   */
  alternatives?: readonly NextWord[];
  /** Precomputed log P(answer words) at `context` (CreditOptions.actualLogprob), for the answer as given. */
  actualLogprob?: number;
}

/**
 * Credit for an answer at a lyric or brought-text cliff, with street tolerance.
 *
 * Method:
 * 1. scoreCliffAnswer(model, pack, cliff.context, answer, cliff.answer) as usual, with
 *    cliff.alternatives and cliff.actualLogprob when the caller has them (no next-word
 *    search then); the lyric's own words are full 'actual'.
 * 2. Same words as the lyric once accents, apostrophes and case are ignored (looseKey):
 *    full 'actual', equivalence spelling ("pa" for "pa'": recognition drops the mark).
 * 3. Both sides are put in neutral form with registerPairs (in street register, forms
 *    that are also standard words count as slang). Equal neutral forms: the answer is a
 *    register equivalent: neutral_for_street (neutralCredit), street_for_neutral or
 *    street_variant (full in street register, streetCreditInNeutral in neutral); reason
 *    'likely' for full, 'plausible' for partial. Credit never drops below step 1's.
 * 4. Otherwise, when slang is involved and step 1 gave less than full: the neutral
 *    answer is scored against the neutral lyric after a neutral context (the neutral
 *    scoring prefix and the neutral paraphrase of cliff.before), and the better result
 *    wins (judged_neutral).
 * `model` always holds step 1's result.
 */
export async function scoreLyricAnswer(
  model: LanguageModel,
  pack: LanguagePack,
  cliff: LyricAnswerTarget,
  answer: string,
  opts: Partial<LyricAnswerOptions> & { register: Register },
): Promise<LyricAnswerResult> {
  const o: LyricAnswerOptions = { ...DEFAULT_LYRIC_ANSWER_OPTIONS, ...opts };
  // Precomputed values belong to cliff.context: never to the neutral rescoring below.
  const { alternatives: _alternatives, actualLogprob: _actualLogprob, ...credit } = o.credit;
  const pre: Partial<CreditOptions> = { ...o.credit };
  if (cliff.alternatives !== undefined) pre.alternatives = cliff.alternatives;
  if (cliff.actualLogprob !== undefined) pre.actualLogprob = cliff.actualLogprob;
  const raw = await scoreCliffAnswer(model, pack, cliff.context, answer, cliff.answer, pre);
  if (raw.reason === 'actual') return { ...raw, model: raw };

  const keysOf = (text: string): string =>
    contentSegmentsOf(pack, text)
      .map((s) => looseKey(pack, normOf(pack, s), o.accentMarks))
      .join(' ');
  const answerKeys = keysOf(answer);
  if (answerKeys === '') return { ...raw, model: raw };
  const explain = (kind: LyricEquivalenceKind, pairs: { street: string; neutral: string }[]): UiText => ({
    key: EXPLAIN_KEYS[kind],
    params: {
      answer: answer.trim(),
      lyric: cliff.answer,
      street: pairs.map((p) => p.street).join(', '),
      neutral: pairs.map((p) => p.neutral).join(', '),
    },
  });

  if (answerKeys === keysOf(cliff.answer)) {
    return {
      ...raw,
      scored: cliff.answer,
      credit: 'full',
      reason: 'actual',
      equivalence: { kind: 'spelling', pairs: [], explain: explain('spelling', []) },
      model: raw,
    };
  }

  const pairOpts = { loose: o.loose, alsoStandard: o.register === 'street' };
  const pa = registerPairs(answer, pack, o.regions, pairOpts);
  const pc = registerPairs(cliff.answer, pack, o.regions, pairOpts);
  const slangInvolved = pa.substitutions.length > 0 || pc.substitutions.length > 0;
  if (!slangInvolved) return { ...raw, model: raw };
  const toPairs = (subs: typeof pa.substitutions) => subs.map((s) => ({ street: s.street, neutral: s.neutral }));

  if (keysOf(pa.neutral) === keysOf(pc.neutral)) {
    let kind: LyricEquivalenceKind;
    let credit: Credit;
    let pairs: { street: string; neutral: string }[];
    if (pa.substitutions.length === 0) {
      kind = 'neutral_for_street';
      credit = o.neutralCredit;
      pairs = toPairs(pc.substitutions);
    } else {
      kind = pc.substitutions.length === 0 ? 'street_for_neutral' : 'street_variant';
      credit = o.register === 'street' ? 'full' : o.streetCreditInNeutral;
      pairs = kind === 'street_for_neutral' ? toPairs(pa.substitutions) : [...toPairs(pc.substitutions), ...toPairs(pa.substitutions)];
    }
    const equivalence: LyricEquivalence = { kind, pairs, explain: explain(kind, pairs) };
    if (CREDIT_RANK[credit] <= CREDIT_RANK[raw.credit]) return { ...raw, equivalence, model: raw };
    return { ...raw, credit, reason: credit === 'full' ? 'likely' : 'plausible', equivalence, model: raw };
  }

  if (raw.credit === 'full') return { ...raw, model: raw };
  const neutralBefore = cliff.before === undefined ? undefined : registerPairs(cliff.before, pack, o.regions, pairOpts).neutral;
  const context = neutralBefore === undefined ? cliff.context : scoringPrefix(pack) + neutralBefore;
  const rescored = await scoreCliffAnswer(model, pack, context, pa.neutral, pc.neutral, credit);
  if (CREDIT_RANK[rescored.credit] <= CREDIT_RANK[raw.credit]) return { ...raw, model: raw };
  const pairs = [...toPairs(pc.substitutions), ...toPairs(pa.substitutions)];
  return {
    ...rescored,
    answer,
    equivalence: { kind: 'judged_neutral', pairs, explain: explain('judged_neutral', pairs) },
    model: raw,
  };
}
