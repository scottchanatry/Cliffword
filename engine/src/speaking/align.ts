/**
 * Align what the learner said (a speech-recognition transcript) with what they were
 * meant to say, word by word, for "Understood N of M words" and for the landed and
 * hollow tiles of the echo and repeat screens. There is no accent score: a word either
 * landed (the recognizer understood it), was missed, or was replaced by another word.
 *
 * Method
 * ------
 * 1. Both texts are segmented with the pack (never split on spaces); words and numbers
 *    are kept, punctuation and spaces dropped.
 * 2. Two words are the same word when their normalized forms are equal ('exact') or their
 *    loose keys are (case, accents and apostrophes ignored: 'loose'). In street register
 *    also:
 *    - 'register': a clipped form of an applicable register pack and its full form, both
 *      ways ("'tá" ~ "está", "pa'" ~ "para", "'toy" ~ "estoy"). Only entries of kind
 *      'clipped' whose loose form is a subsequence of their neutral form count: a
 *      clipping only drops sounds, so "mai" (neutral "mamá") or "klk" (neutral "qué
 *      tal") are other words, not shortened ones;
 *    - 'suffix': a regular street ending (options.streetSuffixes, by default
 *      LanguagePack.streetEndings: Spanish -ado ~ -ao, "cansado" ~ "cansao").
 * 3. Spans of up to maxSpan words on either side may match as a unit: when their keys
 *    concatenate to the same string (the recognizer split or joined a word: "pa lante"
 *    for "pa'lante") or, in street register, through a multi-word clipped form ("pa'l" ~
 *    "para el"). Every expected word of such a span landed.
 * 4. Word-level edit distance over the loose keys with lyrics/align.ts alignWords (the
 *    shared aligner; ties resolve as it documents, so the result is deterministic): a
 *    landed pair or span costs 0, a missed or extra word 1, a substitution 0.5 + 0.5 x
 *    (character distance / longer length), so a near miss lines up with its own word
 *    rather than a neighbour, and a substitution (at most 1) is always cheaper than a
 *    miss plus an extra (2). Steps 2 and 3 become its substitution cost (0 for
 *    equivalent words) and its multi-word equivalences.
 */
import type { LanguagePack, Register } from '../lang/types';
import { alignWords } from '../lyrics/align';
import type { WordEquivalent } from '../lyrics/align';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import type { SpokenWord, UiText } from './text';
import { applicableRegisters, charDistance, codeLength, isSubsequence, phraseKeys, spokenWords } from './text';

export type WordOutcome = 'landed' | 'missed' | 'substituted';

/** How a landed word matched (see the module comment). */
export type MatchKind = 'exact' | 'loose' | 'register' | 'suffix';

/** Tunable numbers and data of transcript alignment. */
export interface AlignTranscriptOptions {
  /** Street register also matches clipped forms and street endings with their full forms. */
  register: Register;
  /**
   * Region codes whose register packs apply in street register, chosen exactly as
   * scoring/context.ts does: the packs whose region is listed; [] means every register
   * pack of the language pack.
   */
  regions: readonly string[];
  /** Regular street endings [full, street]; undefined: LanguagePack.streetEndings (none when absent). */
  streetSuffixes: readonly (readonly [string, string])[] | undefined;
  /** Longest span (in words, either side) that may match as a unit. */
  maxSpan: number;
  /** Combining marks folded when the pack has no foldAccents. */
  marks: string;
  /** PairPack.ui key for "Understood {n} of {m} words". */
  uiKey: string;
}

/**
 * Defaults. maxSpan 3 covers the longest clipped phrase in the Spanish packs ("pa'l" =
 * "para el", 1 against 2 words) and a recognizer splitting a word in three; longer spans
 * only add work. uiKey is the en-es pair pack's 'stats.understood'.
 */
export const DEFAULT_ALIGN_TRANSCRIPT_OPTIONS: Readonly<AlignTranscriptOptions> = {
  register: 'neutral',
  regions: [],
  streetSuffixes: undefined,
  maxSpan: 3,
  marks: DEFAULT_ACCENT_MARKS,
  uiKey: 'stats.understood',
};

/** A heard word (from the transcript). */
export interface HeardWord {
  /** Index among the heard words and numbers. */
  index: number;
  text: string;
  norm: string;
  start: number;
  end: number;
}

/** One expected word and what happened to it. */
export interface AlignedWord {
  /** Index among the expected words and numbers. */
  index: number;
  text: string;
  norm: string;
  /** Character span in the expected text. */
  start: number;
  end: number;
  outcome: WordOutcome;
  /** The heard text aligned to this word, exactly as in the transcript; '' when missed. */
  heard: string;
  /** Indices of the heard words aligned to it; [] when missed. */
  heardIndices: number[];
  /** How it matched when landed; null otherwise. */
  match: MatchKind | null;
}

/** A heard word aligned to no expected word. */
export interface ExtraWord extends HeardWord {
  /** Index of the expected word it follows; -1 when it comes before the first one. */
  after: number;
}

export interface Alignment {
  /** One entry per expected word or number, in order. */
  words: AlignedWord[];
  /** Heard words aligned to nothing, in order. */
  extra: ExtraWord[];
  /** Expected words that landed. */
  understood: number;
  /** Expected words and numbers. */
  total: number;
  /** understood / total; 0 when there is no expected word. */
  share: number;
  /** "Understood {n} of {m} words": { key: options.uiKey, params: { n, m } }. */
  ui: UiText;
}

/** Joins word keys inside a span key; never part of a key. */
const SEP = '\u0001';

type Equivalences = Map<string, Set<string>>;

const registerCache = new WeakMap<object, Map<string, Equivalences>>();

function addPair(map: Equivalences, a: string, b: string): void {
  if (!a || !b || a === b) return;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const set = map.get(x);
    if (set) set.add(y);
    else map.set(x, new Set([y]));
  }
}

/**
 * Clipped-form equivalences of the applicable register packs, keyed by span key (word
 * keys joined by SEP): "ta" <-> "esta", "pal" <-> "para SEP el". Cached per pack,
 * regions and marks.
 */
export function clippedEquivalences(
  pack: Pick<LanguagePack, 'segment' | 'normalize' | 'foldAccents' | 'registers'>,
  regions: readonly string[] = [],
  marks: string = DEFAULT_ACCENT_MARKS,
): ReadonlyMap<string, ReadonlySet<string>> {
  const id = `${regions.join(',')}|${marks}`;
  let perPack = registerCache.get(pack);
  if (!perPack) {
    perPack = new Map();
    registerCache.set(pack, perPack);
  }
  const hit = perPack.get(id);
  if (hit) return hit;
  const map: Equivalences = new Map();
  for (const reg of applicableRegisters(pack, regions)) {
    for (const e of reg.entries) {
      if (e.kind !== 'clipped') continue;
      const full = phraseKeys(pack, e.neutral, marks);
      if (full.length === 0) continue;
      for (const f of new Set([e.form, e.norm])) {
        const clipped = phraseKeys(pack, f, marks);
        if (clipped.length === 0) continue;
        if (!isSubsequence(clipped.join(''), full.join(''))) continue;
        addPair(map, clipped.join(SEP), full.join(SEP));
      }
    }
  }
  perPack.set(id, map);
  return map;
}

/** True when one key ends with `full` and the other with `street`, on the same non-empty stem. */
function suffixMatch(a: string, b: string, pairs: readonly (readonly [string, string])[]): boolean {
  for (const [full, street] of pairs) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.length > full.length && x.endsWith(full) && y.endsWith(street) && x.slice(0, -full.length) === y.slice(0, y.length - street.length)) {
        return true;
      }
    }
  }
  return false;
}

interface MatchContext {
  street: boolean;
  clipped: ReadonlyMap<string, ReadonlySet<string>>;
  suffixes: readonly (readonly [string, string])[];
}

function wordMatch(e: SpokenWord, h: SpokenWord, ctx: MatchContext): MatchKind | null {
  if (e.norm === h.norm) return 'exact';
  if (e.key === h.key) return 'loose';
  if (!ctx.street) return null;
  if (ctx.clipped.get(e.key)?.has(h.key)) return 'register';
  if (suffixMatch(e.key, h.key, ctx.suffixes)) return 'suffix';
  return null;
}

function spanMatch(e: readonly SpokenWord[], h: readonly SpokenWord[], ctx: MatchContext): MatchKind | null {
  if (e.map((w) => w.key).join('') === h.map((w) => w.key).join('')) return 'loose';
  if (!ctx.street) return null;
  const ek = e.map((w) => w.key).join(SEP);
  const hk = h.map((w) => w.key).join(SEP);
  return ctx.clipped.get(ek)?.has(hk) ? 'register' : null;
}

function substitutionCost(e: string, h: string): number {
  const longer = Math.max(codeLength(e), codeLength(h), 1);
  return 0.5 + (0.5 * Math.min(charDistance(e, h), longer)) / longer;
}

/** True when two loose keys are the same word for alignment (step 2 of the module comment). */
function sameWord(e: string, h: string, ctx: MatchContext): boolean {
  if (e === h) return true;
  return ctx.street && (ctx.clipped.get(e)?.has(h) === true || suffixMatch(e, h, ctx.suffixes));
}

/**
 * Multi-word equivalences for this pair of texts (step 3): runs whose keys concatenate to
 * the same string, and in street register the multi-word clipped forms.
 */
function spanEquivalents(E: readonly SpokenWord[], H: readonly SpokenWord[], ctx: MatchContext, maxSpan: number): WordEquivalent[] {
  const out: WordEquivalent[] = [];
  const seen = new Set<string>();
  const add = (a: readonly string[], b: readonly string[]) => {
    const id = `${a.join(SEP)}\u0002${b.join(SEP)}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push([a, b]);
  };
  const runs = (words: readonly SpokenWord[]) => {
    const list: string[][] = [];
    for (let i = 0; i < words.length; i++) {
      for (let len = 1; len <= maxSpan && i + len <= words.length; len++) list.push(words.slice(i, i + len).map((w) => w.key));
    }
    return list;
  };
  const hRuns = runs(H);
  for (const e of runs(E)) {
    const joined = e.join('');
    for (const h of hRuns) {
      if (e.length === 1 && h.length === 1) continue;
      // Minimal runs only: a run that starts or ends with the same word on both sides
      // ("vamos pa'lante" / "vamos pa lante") is a word pair plus a shorter run, and
      // alignWords tries equivalences first, so it would swallow plain pairs.
      if (e[0] === h[0] || e[e.length - 1] === h[h.length - 1]) continue;
      if (h.join('') === joined) add(e, h);
    }
  }
  if (ctx.street) {
    for (const [a, bs] of ctx.clipped) {
      for (const b of bs) {
        if (a.includes(SEP) || b.includes(SEP)) {
          const x = a.split(SEP);
          const y = b.split(SEP);
          if (x.length <= maxSpan && y.length <= maxSpan) add(x, y);
        }
      }
    }
  }
  return out;
}

/**
 * Align a transcript with the expected text (see the module comment). Returns one entry
 * per expected word (landed, missed or substituted, with the heard text), the extra
 * heard words, and understood / total for "Understood N of M words" (options.uiKey).
 */
export function alignTranscript(
  expected: string,
  heard: string,
  pack: Pick<LanguagePack, 'code' | 'segment' | 'normalize' | 'foldAccents' | 'registers' | 'streetEndings'>,
  opts: Partial<AlignTranscriptOptions> = {},
): Alignment {
  const o: AlignTranscriptOptions = { ...DEFAULT_ALIGN_TRANSCRIPT_OPTIONS, ...opts };
  const E = spokenWords(pack, expected, o.marks);
  const H = spokenWords(pack, heard, o.marks);
  const street = o.register === 'street';
  const ctx: MatchContext = {
    street,
    clipped: street ? clippedEquivalences(pack, o.regions, o.marks) : new Map(),
    suffixes: street ? (o.streetSuffixes ?? pack.streetEndings ?? []) : [],
  };
  const maxSpan = Math.max(1, Math.floor(o.maxSpan));
  const steps = alignWords(
    E.map((w) => w.key),
    H.map((w) => w.key),
    {
      substituteCost: (e, h) => (sameWord(e, h, ctx) ? 0 : substitutionCost(e, h)),
      deleteCost: 1,
      insertCost: 1,
      equivalents: spanEquivalents(E, H, ctx, maxSpan),
    },
  );

  const heardWord = (w: SpokenWord): HeardWord => ({ index: w.index, text: w.text, norm: w.norm, start: w.start, end: w.end });
  const words: AlignedWord[] = [];
  const extra: ExtraWord[] = [];
  for (const step of steps) {
    const es = step.expected.map((i) => E[i] as SpokenWord);
    const hs = step.heard.map((j) => H[j] as SpokenWord);
    if (es.length === 0) {
      for (const h of hs) extra.push({ ...heardWord(h), after: words.length - 1 });
      continue;
    }
    let match: MatchKind | null = null;
    if (step.op === 'match') {
      const single = es.length === 1 && hs.length === 1 && !step.equivalent;
      match = single
        ? (wordMatch(es[0] as SpokenWord, hs[0] as SpokenWord, ctx) ?? 'loose')
        : (spanMatch(es, hs, ctx) ?? 'loose');
    }
    const heardText = hs.length ? heard.slice((hs[0] as SpokenWord).start, (hs[hs.length - 1] as SpokenWord).end) : '';
    for (const e of es) {
      words.push({
        index: e.index,
        text: e.text,
        norm: e.norm,
        start: e.start,
        end: e.end,
        outcome: step.op === 'delete' ? 'missed' : match ? 'landed' : 'substituted',
        heard: heardText,
        heardIndices: hs.map((h) => h.index),
        match,
      });
    }
  }
  const n = E.length;
  const understood = words.filter((w) => w.outcome === 'landed').length;
  return {
    words,
    extra,
    understood,
    total: n,
    share: n > 0 ? understood / n : 0,
    ui: { key: o.uiKey, params: { n: understood, m: n } },
  };
}
