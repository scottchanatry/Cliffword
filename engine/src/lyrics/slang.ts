/**
 * Slang in lyrics and brought text: notes for the words of a line (meaning, region,
 * formality, explicit flag), the neutral paraphrase of a street line for the "Neutral |
 * Street" side by side, and the clipped/full equivalences that sing-back and answer
 * scoring tolerate.
 *
 * Detection reuses scoring/context.ts: slangIn() decides which slang forms of the
 * applicable register packs occur in the text (the same packs scoringPrefix names and
 * slangExemption exempts), so a word noted here is a word street scoring never shades.
 * This module only locates every occurrence, resolves overlaps (phrases before single
 * words) and attaches the entry data. Everything comes from the register packs; there
 * is no language data in this file.
 */
import type { Formality, LanguagePack, SlangEntry } from '../lang/types';
import type { PairPack } from '../pair/types';
import { lexemeKey } from '../learner/types';
import { slangIn } from '../scoring/context';
import { matchCase } from '../corrections/variants';
import type { Lyrics } from './parse';
import { applicableRegisters, looseKey, normOf } from './text';

/** One occurrence of a slang entry in a text. */
export interface SlangMatch {
  /** The entry shown: the first applicable entry with this form, in register-pack order. */
  entry: SlangEntry;
  /** Every applicable entry with this form (other regions or senses), the shown one first. */
  entries: SlangEntry[];
  /** The words as written in the text. */
  text: string;
  /** Character span in the text. */
  start: number;
  end: number;
  /** Index of the first word among the text's word segments, and the number of words. */
  wordIndex: number;
  wordCount: number;
  /** Matched without accents or apostrophes ("pa" for "pa'", "ta" for "'tá"). */
  loose: boolean;
}

export interface SlangMatchOptions {
  /**
   * Region codes of the register packs that apply, as in scoring/context.ts; [] means
   * every register pack the language pack holds. A pack built for some regions already
   * holds only those (createDefaultSpanishPack({ regions: ['PR'] }) loads PR and the
   * shared Caribbean pack), so [] is right for it.
   */
  regions: readonly string[];
  /**
   * Also match single words written without their accents or apostrophes ("pa", "ta",
   * "na"): pasted lyrics and speech recognition drop them. Only words the language pack
   * does not know as a standard word qualify (no analysis, or only slang lemmas), so a
   * standard word that loses its marks to a clipped form ("tan" for "'tán") is left
   * alone.
   */
  loose: boolean;
  /**
   * Include entries marked alsoStandard (forms that are also standard words: "dale",
   * "de una"). Notes include them; neutral paraphrases leave them out by default,
   * because rewriting a standard word ("Pon la música") changes the line.
   */
  alsoStandard: boolean;
  /** Only entries of these kinds; every kind when omitted. */
  kinds?: readonly SlangEntry['kind'][];
}

export const DEFAULT_SLANG_MATCH_OPTIONS: Readonly<SlangMatchOptions> = {
  regions: [],
  loose: true,
  alsoStandard: true,
};

/** Normalized words of a form, through the pack's segmenter (never by spaces). */
function formWords(pack: LanguagePack, form: string): string[] {
  return pack
    .segment(form)
    .filter((s) => s.kind === 'word')
    .map((s) => normOf(pack, s))
    .filter(Boolean);
}

/** The entries of the applicable register packs, indexed for findSlangMatches. */
interface MatchIndex {
  byForm: Map<string, SlangEntry[]>;
  /** Normalized words of each indexed form. */
  wordsOf: Map<string, string[]>;
  slangLemmas: Set<string>;
  looseIndex: Map<string, SlangEntry[]>;
  exactSingles: Set<string>;
}

/**
 * The index depends only on the pack, its register packs and the options that select
 * entries, so it is built once per combination (findSlangMatches runs on every sentence
 * view, selection candidate and answer; rebuilding it segmented every entry each time).
 */
const matchIndexCache = new WeakMap<LanguagePack, { registers: readonly unknown[]; byKey: Map<string, MatchIndex> }>();

function matchIndex(pack: LanguagePack, o: SlangMatchOptions): MatchIndex {
  let hit = matchIndexCache.get(pack);
  if (!hit || hit.registers !== pack.registers) {
    hit = { registers: pack.registers, byKey: new Map() };
    matchIndexCache.set(pack, hit);
  }
  const key = JSON.stringify([o.regions, o.alsoStandard, o.kinds ?? null]);
  const cached = hit.byKey.get(key);
  if (cached) return cached;
  const kinds = o.kinds ? new Set(o.kinds) : undefined;
  const usable = (e: SlangEntry): boolean => (o.alsoStandard || !e.alsoStandard) && (!kinds || kinds.has(e.kind));
  const idx: MatchIndex = { byForm: new Map(), wordsOf: new Map(), slangLemmas: new Set(), looseIndex: new Map(), exactSingles: new Set() };
  for (const reg of applicableRegisters(pack, o.regions)) {
    for (const e of reg.entries) {
      idx.slangLemmas.add(e.lemma);
      if (!usable(e)) continue;
      const list = idx.byForm.get(e.form);
      if (list) list.push(e);
      else idx.byForm.set(e.form, [e]);
      let fw = idx.wordsOf.get(e.form);
      if (!fw) idx.wordsOf.set(e.form, (fw = formWords(pack, e.form)));
      if (fw.length === 1) {
        idx.exactSingles.add(fw[0] as string);
        const k = looseKey(pack, fw[0] as string);
        const ll = idx.looseIndex.get(k);
        if (ll) ll.push(e);
        else idx.looseIndex.set(k, [e]);
      }
    }
  }
  hit.byKey.set(key, idx);
  return idx;
}

/**
 * Every slang occurrence in `text`, in text order, without overlaps.
 *
 * Method: slangIn(pack, text, regions) gives the forms that occur (single words by
 * normalized form, phrases as runs of words); each occurrence of those forms is located
 * among the text's word segments. With `loose`, single words that match no form exactly
 * are compared by looseKey (accents and apostrophes removed), guarded as described in
 * SlangMatchOptions.loose. Overlaps are resolved longest first (phrases before single
 * words), then leftmost, exact before loose.
 */
export function findSlangMatches(pack: LanguagePack, text: string, opts: Partial<SlangMatchOptions> = {}): SlangMatch[] {
  const o: SlangMatchOptions = { ...DEFAULT_SLANG_MATCH_OPTIONS, ...opts };
  const words = pack.segment(text).filter((s) => s.kind === 'word');
  if (words.length === 0) return [];
  const norms = words.map((w) => normOf(pack, w));
  const { byForm, wordsOf, slangLemmas, looseIndex, exactSingles } = matchIndex(pack, o);

  interface Candidate {
    entries: SlangEntry[];
    wordIndex: number;
    wordCount: number;
    loose: boolean;
  }
  const candidates: Candidate[] = [];
  for (const form of slangIn(pack, text, o.regions)) {
    const entries = byForm.get(form);
    if (!entries) continue;
    const fw = wordsOf.get(form) ?? formWords(pack, form);
    for (let i = 0; i + fw.length <= norms.length; i++) {
      if (fw.every((w, j) => norms[i + j] === w)) candidates.push({ entries, wordIndex: i, wordCount: fw.length, loose: false });
    }
  }
  if (o.loose) {
    norms.forEach((n, i) => {
      if (exactSingles.has(n)) return;
      const entries = looseIndex.get(looseKey(pack, n));
      if (!entries) return;
      const analyses = pack.analyze(n);
      if (analyses.length > 0 && !analyses.every((a) => slangLemmas.has(a.lemma))) return;
      candidates.push({ entries, wordIndex: i, wordCount: 1, loose: true });
    });
  }

  candidates.sort(
    (a, b) => b.wordCount - a.wordCount || a.wordIndex - b.wordIndex || Number(a.loose) - Number(b.loose),
  );
  const taken = new Array<boolean>(norms.length).fill(false);
  const out: SlangMatch[] = [];
  for (const c of candidates) {
    let free = true;
    for (let j = 0; j < c.wordCount; j++) if (taken[c.wordIndex + j]) free = false;
    if (!free) continue;
    for (let j = 0; j < c.wordCount; j++) taken[c.wordIndex + j] = true;
    const first = words[c.wordIndex];
    const last = words[c.wordIndex + c.wordCount - 1];
    if (!first || !last) continue;
    out.push({
      entry: c.entries[0] as SlangEntry,
      entries: [...c.entries],
      text: text.slice(first.start, last.end),
      start: first.start,
      end: last.end,
      wordIndex: c.wordIndex,
      wordCount: c.wordCount,
      loose: c.loose,
    });
  }
  return out.sort((a, b) => a.wordIndex - b.wordIndex);
}

/** A slang note for display. Text to show comes from PairPack.ui through the label keys. */
export interface SlangNote {
  /** The entry's form ("'tá"). */
  form: string;
  /** As written in the line ("'Tá"). */
  text: string;
  /** Neutral equivalent ("está"). */
  neutral: string;
  /** Meaning in the learner's language: pair.gloss(lemma), else the entry's own gloss. */
  gloss?: string;
  lemma: string;
  /** Learner key of the slang lexeme ("es:janguear"). */
  key: string;
  /** Regions of the entry (and of other applicable entries with the same lemma). */
  regions: string[];
  formality: Formality;
  explicit: boolean;
  kind: SlangEntry['kind'];
  /** The form is also a standard word ("dale", "de una"): the note may not apply. */
  alsoStandard: boolean;
  /** Matched without accents or apostrophes. */
  loose: boolean;
  span: { start: number; end: number; wordIndex: number; wordCount: number };
  /**
   * PairPack.ui keys for the labels: "slang.formality.casual", one "region.PR" per region
   * (shown through "slang.region"), and "slang.explicit" for explicit entries.
   */
  labels: { formality: string; regions: string[]; explicit?: string };
}

export interface SlangNoteOptions extends SlangMatchOptions {
  /**
   * Show notes for explicit entries. On by default: the brief has explicit lyrics on by
   * default, and a learner who turns them off gets no explicit notes.
   */
  showExplicit: boolean;
}

export const DEFAULT_SLANG_NOTE_OPTIONS: Readonly<SlangNoteOptions> = {
  ...DEFAULT_SLANG_MATCH_OPTIONS,
  showExplicit: true,
};

/** A note for one match. */
export function noteFor(match: SlangMatch, pack: LanguagePack, pair: PairPack): SlangNote {
  const e = match.entry;
  const regions: string[] = [];
  for (const x of match.entries) {
    if (x.lemma !== e.lemma) continue;
    for (const r of x.regions) if (!regions.includes(r)) regions.push(r);
  }
  const gloss = pair.gloss(e.lemma) ?? e.gloss[pair.native];
  const labels: SlangNote['labels'] = {
    formality: `slang.formality.${e.formality}`,
    regions: regions.map((r) => `region.${r}`),
  };
  if (e.explicit) labels.explicit = 'slang.explicit';
  const note: SlangNote = {
    form: e.form,
    text: match.text,
    neutral: e.neutral,
    lemma: e.lemma,
    key: lexemeKey(pack.code, e.lemma),
    regions,
    formality: e.formality,
    explicit: e.explicit,
    kind: e.kind,
    alsoStandard: e.alsoStandard === true,
    loose: match.loose,
    span: { start: match.start, end: match.end, wordIndex: match.wordIndex, wordCount: match.wordCount },
    labels,
  };
  if (gloss !== undefined) note.gloss = gloss;
  return note;
}

/**
 * Slang notes for a line, in line order: one per occurrence, phrases matched before
 * single words (see findSlangMatches). With showExplicit false, explicit entries get no note.
 */
export function slangNotes(
  line: string,
  pack: LanguagePack,
  pair: PairPack,
  opts: Partial<SlangNoteOptions> = {},
): SlangNote[] {
  const o: SlangNoteOptions = { ...DEFAULT_SLANG_NOTE_OPTIONS, ...opts };
  return findSlangMatches(pack, line, o)
    .filter((m) => o.showExplicit || !m.entry.explicit)
    .map((m) => noteFor(m, pack, pair));
}

/** A slang lexeme of a song, with where it first occurs. */
export interface SongSlangNote {
  note: SlangNote;
  /** Id of the line where it first occurs. */
  lineId: string;
  /** Occurrences in the song. */
  count: number;
}

/**
 * The song's slang, one entry per slang lexeme in order of first occurrence (for the
 * song page's slang list). Repeated lines count every time they are sung.
 */
export function songSlangNotes(
  lyrics: Lyrics,
  pack: LanguagePack,
  pair: PairPack,
  opts: Partial<SlangNoteOptions> = {},
): SongSlangNote[] {
  const out: SongSlangNote[] = [];
  const byKey = new Map<string, SongSlangNote>();
  for (const line of lyrics.lines) {
    for (const note of slangNotes(line.text, pack, pair, opts)) {
      const hit = byKey.get(note.key);
      if (hit) hit.count += Math.max(1, line.repeatCount);
      else {
        const s = { note, lineId: line.id, count: Math.max(1, line.repeatCount) };
        byKey.set(note.key, s);
        out.push(s);
      }
    }
  }
  return out;
}

/** One street form replaced by its neutral equivalent. */
export interface RegisterSubstitution {
  /** The entry's form ("'tá"). */
  form: string;
  /** As written in the street line ("'Tá"). */
  street: string;
  /** As written in the neutral line, case matched ("Está"). */
  neutral: string;
  /** Span in the street line. */
  start: number;
  end: number;
  /** Span in the neutral line. */
  neutralStart: number;
  neutralEnd: number;
  kind: SlangEntry['kind'];
  lemma: string;
}

/** A line in street and neutral register, side by side. */
export interface RegisterPair {
  street: string;
  neutral: string;
  substitutions: RegisterSubstitution[];
}

export const DEFAULT_REGISTER_PAIR_OPTIONS: Readonly<Omit<SlangMatchOptions, 'regions'>> = {
  loose: true,
  // A form that is also a standard word is left as it is: "Pon la música" is standard.
  alsoStandard: false,
};

/**
 * The neutral paraphrase of a street line: every slang occurrence (findSlangMatches: phrases
 * first, then single words) is replaced by its entry's neutral field, with the case of
 * the street form ("'Tá" -> "Está", "PA'" -> "PARA"), and the substitutions are listed
 * with their spans in both lines. Only the listed words change; agreement around them
 * is not adjusted ("el corillo" becomes "el grupo"), which is exactly what the pack
 * data supports. A line without slang comes back unchanged.
 */
export function registerPairs(
  line: string,
  pack: LanguagePack,
  regions: readonly string[] = [],
  opts: Partial<Omit<SlangMatchOptions, 'regions'>> = {},
): RegisterPair {
  const o = { ...DEFAULT_REGISTER_PAIR_OPTIONS, ...opts, regions };
  let neutral = '';
  let cursor = 0;
  const substitutions: RegisterSubstitution[] = [];
  for (const m of findSlangMatches(pack, line, o)) {
    neutral += line.slice(cursor, m.start);
    const replacement = matchCase(m.text, m.entry.neutral);
    const neutralStart = neutral.length;
    neutral += replacement;
    substitutions.push({
      form: m.entry.form,
      street: m.text,
      neutral: replacement,
      start: m.start,
      end: m.end,
      neutralStart,
      neutralEnd: neutral.length,
      kind: m.entry.kind,
      lemma: m.entry.lemma,
    });
    cursor = m.end;
  }
  neutral += line.slice(cursor);
  return { street: line, neutral, substitutions };
}

/** A street form and its neutral equivalent as normalized word sequences. */
export interface RegisterEquivalent {
  street: string[];
  neutral: string[];
  entry: SlangEntry;
}

/**
 * Street/neutral equivalences of the applicable register packs as normalized word
 * sequences ("pa'l" = "para el"), for tolerant comparison. `kinds` limits the entries:
 * sing-back passes ['clipped'] (saying "está" for "'tá" is the same word, saying "grupo"
 * for "corillo" is not).
 */
export function registerEquivalents(
  pack: LanguagePack,
  regions: readonly string[] = [],
  kinds?: readonly SlangEntry['kind'][],
): RegisterEquivalent[] {
  const allowed = kinds ? new Set(kinds) : undefined;
  const out: RegisterEquivalent[] = [];
  for (const reg of applicableRegisters(pack, regions)) {
    for (const e of reg.entries) {
      if (allowed && !allowed.has(e.kind)) continue;
      const street = formWords(pack, e.form);
      const neutral = formWords(pack, e.neutral);
      if (street.length === 0 || neutral.length === 0) continue;
      out.push({ street, neutral, entry: e });
    }
  }
  return out;
}
