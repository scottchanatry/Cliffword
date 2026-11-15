/**
 * Parse lyrics the learner pastes (or, later, licensed timed lyrics) into lines with ids,
 * stanzas, sections and repeats.
 *
 * Pasted lyrics come from lyric sites and apps and carry more than the words: section
 * labels ([Chorus], [Coro: Artist], "Verse 1:"), repeat marks ((x2)), LRC timestamps
 * ([01:02.50]), site boilerplate, curly quotes. The parser keeps the words, removes the
 * rest from the line text and keeps it as metadata.
 *
 * Everything here is language-neutral: labels are recognized by their shape (brackets,
 * a short line ending in a colon), never by a word list built into the code. Words that
 * mark a label in some language (Coro, Chorus, Estribillo...) can be passed as
 * `sectionWords`; they only widen what counts as a label.
 */
import type { LanguagePack } from '../lang/types';
import { accentFolder, contentSegmentsOf, normalizeQuotes, normOf, wordSegmentsOf } from './text';

/** A character offset in a line's text and the time its word starts (enhanced LRC <mm:ss.xx>). */
export interface WordMark {
  /** Character offset in LyricLine.text. */
  at: number;
  ms: number;
}

export interface LyricLine {
  /** Stable id within this parse: idPrefix + index ("l0", "l1", ...). */
  id: string;
  /** Position among the lyric lines, from 0. */
  index: number;
  /** The words of the line: quotes normalized, labels, timestamps and repeat marks removed, trimmed. */
  text: string;
  /** The line as pasted (after splitting into lines). '' for a line made by expandRepeats. */
  source: string;
  /** 0-based line number in the pasted text (of the copied line, for an expanded copy). */
  sourceLine: number;
  /** Index into Lyrics.stanzas. */
  stanza: number;
  /** Index into Lyrics.sections, when the line follows a section label. */
  section?: number;
  /** LRC start time in ms, after the [offset:] tag. */
  startMs?: number;
  /** Start of the next timed line, or of a timed empty line (an instrumental break). */
  endMs?: number;
  /** Word start times from enhanced LRC, when present. */
  wordMarks?: WordMark[];
  /** Id of the first line with the same words (case, accents and punctuation ignored). */
  repeatOf?: string;
  /** Times the line is sung, from a repeat mark at its end ("Dale, dale (x2)"); 1 otherwise. */
  repeatCount: number;
  /** The whole line is in parentheses: a backing vocal or ad-lib, not the main line. */
  adlib: boolean;
  /** Number of word segments (LanguagePack.segment). */
  wordCount: number;
  /** For a copy made by expandRepeats: the id of the line it copies. */
  expandedFrom?: string;
}

export interface LyricSection {
  index: number;
  /** The label without brackets, colon, performer or repeat mark: "Coro", "Verse 1". */
  label: string;
  /** Text after a colon inside brackets: "[Coro: Bad Bunny]" -> "Bad Bunny". */
  performer?: string;
  /** The label line as pasted. */
  source: string;
  sourceLine: number;
  /** Ids of the lines under this label. */
  lines: string[];
  /**
   * A label with no lines of its own ("[Coro]" again at the end) that matches an earlier
   * label with lines: the index of that section (sing it again).
   */
  repeatOf?: number;
  /** From a repeat mark in the label ("[Coro x2]"); 1 otherwise. */
  repeatCount: number;
}

export interface LyricStanza {
  index: number;
  /** Ids of its lines, in order. */
  lines: string[];
  section?: number;
  /** Index of the first stanza with the same lines (a repeated chorus). */
  repeatOf?: number;
  /** From a repeat mark on a line of its own after it ("(x2)"); 1 otherwise. */
  repeatCount: number;
}

export type RemovedReason = 'junk' | 'label' | 'repeat' | 'tag';

export interface RemovedLine {
  sourceLine: number;
  text: string;
  reason: RemovedReason;
}

export interface Lyrics {
  lines: LyricLine[];
  stanzas: LyricStanza[];
  sections: LyricSection[];
  /** LRC id tags by lowercase key: ti (title), ar (artist), al (album), offset, length... */
  tags: Readonly<Record<string, string>>;
  /** True when at least one lyric line has an LRC timestamp. */
  timed: boolean;
  /** Pasted lines that are not lyric lines, and why. Blank lines are not listed. */
  removed: RemovedLine[];
}

export interface ParseLyricsOptions {
  /** A line matching any of these (after quote normalization and trimming) is dropped as junk. */
  junkPatterns: readonly RegExp[];
  /** Matches of these are cut from the end of a line (text glued to the last lyric by a site). */
  junkSuffixes: readonly RegExp[];
  /**
   * Words (compared after LanguagePack.normalize and accent folding) that mark a section
   * label in some language, such as the app's list for the learner's songs. With them,
   * "(Chorus)" or "Coro:" anywhere count as labels; without them, only shapes are used.
   */
  sectionWords: readonly string[];
  /**
   * A line ending in ":" with at most this many words is a label when it contains a digit
   * ("Verse 1:"), starts with a section word, or opens a stanza with at most two words
   * ("Coro:", "Bad Bunny:"). 0 turns colon labels off.
   */
  maxColonLabelWords: number;
  /** LRC id-tag keys ([ti:...], [ar:...]); a bracketed "key: value" line with another key is a section label. */
  lrcTags: readonly string[];
  /** Prefix of line ids. */
  idPrefix: string;
  /**
   * Copy repeated material into the line list: a line marked (xN) N times, a stanza
   * followed by an (xN) line N times, a section label marked xN, and a bare label that
   * repeats an earlier section. Off by default: copies have no timing and the app can
   * show "x2" instead; turn it on to practise every sung line in order.
   */
  expandRepeats: boolean;
  /** Repeat counts are capped at this, so "(x100)" cannot flood the line list. */
  maxRepeat: number;
}

/**
 * Whole-line junk recognized by shape alone: web addresses, lines with no letter at all
 * (decorations such as "* * *", "—", "(1409617498288)" ids) and copyright lines.
 */
export const SHAPE_JUNK_PATTERNS: readonly RegExp[] = [
  /^(?:https?:\/\/|www\.)\S+$/iu,
  /^[^\p{L}]*$/u,
  /^[©℗]/u,
  /\*{3,}/u,
];

/**
 * Lyric-site boilerplate that comes along when lyrics are copied from a web page: Genius
 * ("123 Contributors", "Translations", "You might also like", "Song Title Lyrics",
 * "Read More", ticket ads) and Musixmatch or LyricFind credit lines. These are the
 * sites' own interface text, not lyrics and not data about any language.
 */
export const SITE_JUNK_PATTERNS: readonly RegExp[] = [
  /^\d+\s*Contributors?\b/u,
  /^Translations\b/u,
  /^You might also like$/iu,
  /(?:^|\s)Lyrics$/u,
  /^Read More$/iu,
  /Get tickets as low as/iu,
  /^Writer\(s\):/iu,
  /^Lyrics (?:licensed|provided|powered) by\b/iu,
  /^Source:\s/iu,
];

/** Genius glues "Embed" (with a share count) to the last lyric line: "bailar42Embed". */
export const SITE_JUNK_SUFFIXES: readonly RegExp[] = [/(?<=\S)\d*Embed$/u];

/** Standard LRC id tags. */
export const DEFAULT_LRC_TAGS: readonly string[] = ['ti', 'ar', 'al', 'au', 'by', 'offset', 'length', 're', 've', 'tool', 'la', '#'];

export const DEFAULT_PARSE_LYRICS_OPTIONS: Readonly<ParseLyricsOptions> = {
  junkPatterns: [...SHAPE_JUNK_PATTERNS, ...SITE_JUNK_PATTERNS],
  junkSuffixes: SITE_JUNK_SUFFIXES,
  sectionWords: [],
  // Labels are short ("Verse 1", "Pre-Chorus", "Coro: Bad Bunny" is bracketed anyway);
  // three words leaves "Verso 2 final:" in and keeps most sung lines that end in a
  // colon ("Y entonces me dijo:") out.
  maxColonLabelWords: 3,
  lrcTags: DEFAULT_LRC_TAGS,
  idPrefix: 'l',
  expandRepeats: false,
  // Songs repeat a hook up to four or eight times; more is a typo or a joke.
  maxRepeat: 8,
};

const TIMESTAMP_RE = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/u;
const WORD_MARK_RE = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/gu;
const TAG_RE = /^\[([A-Za-z#]{1,10})\s*:(.*)\]$/u;
const REPEAT_RE = /(?:^|\s)[([]?\s*(?:[x×]\s*(\d{1,3})|(\d{1,3})\s*[x×])\s*[)\]]?\s*$/iu;
const BRACKET_RE = /^\[([^\]]*)\]$/u;
const BRACE_RE = /^\{([^}]*)\}$/u;
const PAREN_RE = /^\(([^()]*)\)$/u;
const DIGIT_RE = /\p{N}/u;
/** Private-use character standing in for an enhanced-LRC word mark while the line is cleaned. */
const MARK = '\uE000';

function timeMs(min: string, sec: string, frac: string | undefined): number {
  let ms = (Number(min) * 60 + Number(sec)) * 1000;
  // .5 = 500 ms, .50 = 500 ms (centiseconds), .500 = 500 ms
  if (frac) ms += Math.round(Number(frac) * 10 ** (3 - frac.length));
  return ms;
}

/** Remove a trailing repeat mark ("(x2)", "x3", "2x"); returns the rest and the count. */
function splitRepeat(text: string, max: number): { rest: string; count?: number } {
  const m = REPEAT_RE.exec(text);
  if (!m) return { rest: text };
  const n = Number(m[1] ?? m[2]);
  if (!Number.isFinite(n) || n < 1) return { rest: text };
  return { rest: text.slice(0, m.index).trim(), count: Math.min(n, max) };
}

type Item =
  | { type: 'blank'; sourceLine: number }
  | { type: 'break'; sourceLine: number; ms: number }
  | { type: 'label'; sourceLine: number; source: string; label: string; performer?: string; count: number }
  | { type: 'repeat'; sourceLine: number; source: string; count: number }
  | {
      type: 'lyric';
      sourceLine: number;
      source: string;
      text: string;
      time?: number;
      marks: WordMark[];
      count: number;
      adlib: boolean;
    };

interface DraftLine {
  text: string;
  source: string;
  sourceLine: number;
  startMs?: number;
  endMs?: number;
  marks: WordMark[];
  count: number;
  adlib: boolean;
  copyOf?: DraftLine;
}

interface DraftStanza {
  section?: number;
  lines: DraftLine[];
  count: number;
}

interface DraftSection {
  label: string;
  performer?: string;
  source: string;
  sourceLine: number;
  count: number;
}

/**
 * Clean one pasted line (quotes already normalized, timestamps removed): enhanced-LRC
 * word marks are taken out and kept with their character offsets, junk suffixes are
 * cut, runs of spaces collapse to one, and the line is trimmed.
 */
function cleanLine(s: string, o: ParseLyricsOptions): { text: string; marks: WordMark[] } {
  const times: number[] = [];
  let t = s.replace(WORD_MARK_RE, (_m, a: string, b: string, c: string | undefined) => {
    times.push(timeMs(a, b, c));
    return MARK;
  });
  t = t.trimEnd();
  for (const re of o.junkSuffixes) t = t.replace(re, '').trimEnd();
  let text = '';
  const marks: WordMark[] = [];
  let k = 0;
  for (const ch of t) {
    if (ch === MARK) marks.push({ at: text.length, ms: times[k++] as number });
    else if (ch === ' ' && (text === '' || text.endsWith(' '))) continue;
    else text += ch;
  }
  text = text.trimEnd();
  return { text, marks: marks.map((m) => ({ at: Math.min(m.at, text.length), ms: m.ms })) };
}

/**
 * Parse pasted lyrics.
 *
 * Method, line by line (the text is split at line breaks):
 * 1. Quotes are normalized (curly apostrophes to "'", curly double quotes to '"', odd
 *    spaces and invisible characters cleaned) and leading LRC timestamps
 *    ("[01:02.50][02:10.00]") are read; a bracketed line with an LRC tag key
 *    ("[ar: Artist]", "[offset: +200]") becomes a tag. Enhanced-LRC word marks
 *    ("<01:02.80>") are removed and kept as WordMarks. Junk suffixes are cut, inner
 *    spaces collapsed, the line trimmed.
 * 2. An empty line ends the stanza (with a timestamp, it also ends the previous line:
 *    an instrumental break). A junk line is dropped without ending the stanza.
 * 3. Labels: a whole line in [brackets] or {braces}; a whole line in (parentheses) that
 *    starts with a section word; a short line ending in a colon (see
 *    maxColonLabelWords). A label ends the stanza and opens a section; "[Coro x2]" gives
 *    the section a repeat count and "[Coro: Artist]" a performer.
 * 4. A line that is only a repeat mark ("(x2)", "x3") sets the repeat count of the
 *    stanza it closes. A repeat mark at the end of a lyric line sets the line's count.
 * 5. Anything else is a lyric line; a whole line in parentheses is marked adlib.
 *
 * Timed lyrics: a line with several timestamps is sung at each of them, so it becomes
 * one line per timestamp, and lines are put in time order (untimed lines stay after the
 * line before them). startMs is the timestamp minus the [offset:] tag (LRC: a positive
 * offset shows lyrics earlier); endMs is the next timed line's start or a timed break.
 *
 * Repeats: lines with the same words (normalized, accents folded, punctuation and case
 * ignored) get repeatOf = the first one's id; a stanza whose lines repeat an earlier
 * stanza's gets repeatOf = that stanza; a label with no lines that matches an earlier
 * label with lines gets repeatOf = that section. With expandRepeats, repeated material
 * is copied into the line list (see ParseLyricsOptions.expandRepeats).
 */
export function parseLyrics(raw: string, pack: LanguagePack, opts: Partial<ParseLyricsOptions> = {}): Lyrics {
  const o: ParseLyricsOptions = { ...DEFAULT_PARSE_LYRICS_OPTIONS, ...opts };
  const fold = accentFolder(pack);
  const sectionWords = new Set(o.sectionWords.map((w) => fold(pack.normalize(w))).filter(Boolean));
  const lrcTags = new Set(o.lrcTags.map((t) => t.toLowerCase()));
  const tags: Record<string, string> = {};
  const removed: RemovedLine[] = [];
  const items: Item[] = [];

  const firstWordIsSectionWord = (text: string): boolean => {
    const first = wordSegmentsOf(pack, text)[0];
    return first !== undefined && sectionWords.has(fold(normOf(pack, first)));
  };
  /** Split label text into label, performer and repeat count. */
  const labelParts = (inner: string): { label: string; performer?: string; count?: number } => {
    const { rest, count } = splitRepeat(inner.trim(), o.maxRepeat);
    const colon = rest.indexOf(':');
    const label = (colon >= 0 ? rest.slice(0, colon) : rest).trim();
    const performer = colon >= 0 ? rest.slice(colon + 1).trim() : '';
    const out: { label: string; performer?: string; count?: number } = { label };
    if (performer) out.performer = performer;
    if (count !== undefined) out.count = count;
    return out;
  };

  const sourceLines = raw.split(/\r\n|\r|\n/u);
  sourceLines.forEach((source, sourceLine) => {
    let s = normalizeQuotes(source);
    const times: number[] = [];
    for (;;) {
      const m = TIMESTAMP_RE.exec(s);
      if (!m) break;
      times.push(timeMs(m[1] as string, m[2] as string, m[3]));
      s = s.slice(m[0].length);
    }
    const trimmed = s.trim();
    if (times.length === 0) {
      const tag = TAG_RE.exec(trimmed);
      if (tag && lrcTags.has((tag[1] as string).toLowerCase())) {
        tags[(tag[1] as string).toLowerCase()] = (tag[2] as string).trim();
        removed.push({ sourceLine, text: source, reason: 'tag' });
        return;
      }
    }
    const { text, marks } = cleanLine(s.trimStart(), o);
    const prev = items[items.length - 1];
    if (text === '') {
      if (times.length > 0) items.push({ type: 'break', sourceLine, ms: times[0] as number });
      else items.push({ type: 'blank', sourceLine });
      return;
    }
    if (
      o.junkPatterns.some((re) => {
        re.lastIndex = 0; // a caller's pattern may carry the g or y flag
        return re.test(text);
      })
    ) {
      removed.push({ sourceLine, text: source, reason: 'junk' });
      return;
    }
    const atStanzaStart = !prev || prev.type === 'blank' || prev.type === 'break' || prev.type === 'label';
    const bracket = BRACKET_RE.exec(text) ?? BRACE_RE.exec(text);
    const paren = PAREN_RE.exec(text);
    let label: { label: string; performer?: string; count?: number } | undefined;
    if (bracket) label = labelParts(bracket[1] as string);
    else if (paren) {
      const inner = labelParts(paren[1] as string);
      if (inner.label === '' || firstWordIsSectionWord(inner.label)) label = inner;
    } else if (o.maxColonLabelWords > 0 && text.endsWith(':')) {
      const body = text.slice(0, -1).trim();
      const parts = labelParts(body);
      const words = wordSegmentsOf(pack, parts.label).length;
      if (
        words >= 1 &&
        words <= o.maxColonLabelWords &&
        (DIGIT_RE.test(parts.label) || firstWordIsSectionWord(parts.label) || (atStanzaStart && words <= 2))
      ) {
        label = parts;
      }
    }
    if (label) {
      if (label.label === '' && label.performer === undefined) {
        items.push({ type: 'repeat', sourceLine, source, count: label.count ?? 1 });
        removed.push({ sourceLine, text: source, reason: 'repeat' });
      } else {
        const item: Item = { type: 'label', sourceLine, source, label: label.label, count: label.count ?? 1 };
        if (label.performer !== undefined) item.performer = label.performer;
        items.push(item);
        removed.push({ sourceLine, text: source, reason: 'label' });
      }
      return;
    }
    const bare = splitRepeat(text, o.maxRepeat);
    if (bare.count !== undefined && (bare.rest === '' || !/\p{L}/u.test(bare.rest))) {
      // A line that is only a repeat mark ("x2", "2x") without brackets.
      items.push({ type: 'repeat', sourceLine, source, count: bare.count ?? 1 });
      removed.push({ sourceLine, text: source, reason: 'repeat' });
      return;
    }
    const lyricText = bare.rest;
    const lyricMarks = marks.filter((m) => m.at <= lyricText.length);
    const adlib = PAREN_RE.test(lyricText);
    const count = bare.count ?? 1;
    if (times.length === 0) {
      items.push({ type: 'lyric', sourceLine, source, text: lyricText, marks: lyricMarks, count, adlib });
    } else {
      for (const time of times) {
        items.push({ type: 'lyric', sourceLine, source, text: lyricText, time, marks: lyricMarks, count, adlib });
      }
    }
  });

  // Timed lyrics: put items in time order; untimed items keep the time of the item before.
  const timed = items.some((it) => it.type === 'lyric' && it.time !== undefined);
  let ordered = items;
  if (timed) {
    let carry = -1;
    const keyed = items.map((it, i) => {
      const own = it.type === 'lyric' ? it.time : it.type === 'break' ? it.ms : undefined;
      if (own !== undefined) carry = own;
      return { it, t: carry, i };
    });
    keyed.sort((a, b) => a.t - b.t || a.i - b.i);
    ordered = keyed.map((k) => k.it);
  }
  const offset = Number(tags['offset'] ?? 0);
  const shift = (ms: number): number => Math.max(0, ms - (Number.isFinite(offset) ? offset : 0));

  // Build draft stanzas and sections, keeping the order of stanzas and labels.
  const sections: DraftSection[] = [];
  const stanzas: DraftStanza[] = [];
  const sequence: ({ kind: 'stanza'; st: DraftStanza } | { kind: 'section'; si: number })[] = [];
  let open: DraftStanza | undefined;
  let currentSection: number | undefined;
  let lastTimed: DraftLine | undefined;
  for (const it of ordered) {
    if (it.type === 'blank') open = undefined;
    else if (it.type === 'break') {
      open = undefined;
      if (lastTimed && lastTimed.endMs === undefined) lastTimed.endMs = shift(it.ms);
    } else if (it.type === 'label') {
      open = undefined;
      const sec: DraftSection = { label: it.label, source: it.source, sourceLine: it.sourceLine, count: it.count };
      if (it.performer !== undefined) sec.performer = it.performer;
      sections.push(sec);
      currentSection = sections.length - 1;
      sequence.push({ kind: 'section', si: currentSection });
    } else if (it.type === 'repeat') {
      const target = open ?? stanzas[stanzas.length - 1];
      if (target) target.count = it.count;
      open = undefined;
    } else {
      if (!open) {
        open = { lines: [], count: 1 };
        if (currentSection !== undefined) open.section = currentSection;
        stanzas.push(open);
        sequence.push({ kind: 'stanza', st: open });
      }
      const line: DraftLine = {
        text: it.text,
        source: it.source,
        sourceLine: it.sourceLine,
        marks: it.marks.map((m) => ({ at: m.at, ms: shift(m.ms) })),
        count: it.count,
        adlib: it.adlib,
      };
      if (it.time !== undefined) {
        line.startMs = shift(it.time);
        if (lastTimed && lastTimed.endMs === undefined) lastTimed.endMs = line.startMs;
        lastTimed = line;
      }
      open.lines.push(line);
    }
  }

  const folded = (s: string): string =>
    contentSegmentsOf(pack, s)
      .map((seg) => fold(normOf(pack, seg)))
      .join(' ');
  const labelKey = (s: string): string => fold(s.toLowerCase()).replace(/\s+/gu, ' ').trim();

  // Bare labels that repeat an earlier section with lines.
  const sectionHasLines = sections.map((_, i) => stanzas.some((st) => st.section === i && st.lines.length > 0));
  const sectionRepeatOf: (number | undefined)[] = sections.map((sec, i) => {
    if (sectionHasLines[i]) return undefined;
    const key = labelKey(sec.label);
    for (let j = 0; j < i; j++) if (sectionHasLines[j] && labelKey((sections[j] as DraftSection).label) === key) return j;
    return undefined;
  });

  // Expand repeats: walk stanzas and labels in order and copy what is sung again.
  let finalStanzas: DraftStanza[] = stanzas;
  if (o.expandRepeats) {
    const copyLines = (lines: readonly DraftLine[]): DraftLine[] =>
      lines.map((l) => ({ text: l.text, source: '', sourceLine: l.sourceLine, marks: [], count: 1, adlib: l.adlib, copyOf: l.copyOf ?? l }));
    const withSection = (st: DraftStanza, section: number | undefined): DraftStanza =>
      section === undefined ? st : { ...st, section };
    /** A stanza with each (xN) line written out N times. */
    const expandLines = (st: DraftStanza): DraftStanza => {
      const lines: DraftLine[] = [];
      for (const l of st.lines) {
        lines.push(l);
        for (let k = 1; k < l.count; k++) lines.push(...copyLines([l]));
      }
      return withSection({ lines, count: 1 }, st.section);
    };
    const out: DraftStanza[] = [];
    let cur: number | undefined;
    let curStanzas: DraftStanza[] = [];
    /** Close the current section: a label marked xN sings its stanzas N times. */
    const endSection = () => {
      const sec = cur === undefined ? undefined : sections[cur];
      if (sec && sec.count > 1 && sectionHasLines[cur as number]) {
        const base = [...curStanzas];
        for (let k = 1; k < sec.count; k++) for (const st of base) out.push(withSection({ lines: copyLines(st.lines), count: 1 }, cur));
      }
      curStanzas = [];
    };
    for (const ev of sequence) {
      if (ev.kind === 'section') {
        endSection();
        cur = ev.si;
        const from = sectionRepeatOf[ev.si];
        if (from !== undefined) {
          // The chorus as it was sung: its own xN, times any xN on the bare label.
          const times = Math.max(1, (sections[ev.si] as DraftSection).count) * Math.max(1, (sections[from] as DraftSection).count);
          for (let k = 0; k < times; k++) {
            for (const st of stanzas) {
              if (st.section !== from) continue;
              const ex = expandLines(st);
              for (let r = 0; r < st.count; r++) out.push(withSection({ lines: copyLines(ex.lines), count: 1 }, ev.si));
            }
          }
        }
        continue;
      }
      const ex = expandLines(ev.st);
      out.push(ex);
      curStanzas.push(ex);
      for (let k = 1; k < ev.st.count; k++) {
        const copy = withSection({ lines: copyLines(ex.lines), count: 1 }, ev.st.section);
        out.push(copy);
        curStanzas.push(copy);
      }
    }
    endSection();
    finalStanzas = out;
  }

  // Assign ids and indices.
  const lines: LyricLine[] = [];
  const outStanzas: LyricStanza[] = [];
  const idOf = new Map<DraftLine, string>();
  const firstByKey = new Map<string, string>();
  const stanzaByKey = new Map<string, number>();
  const outSections: LyricSection[] = sections.map((sec, index) => {
    const s: LyricSection = { index, label: sec.label, source: sec.source, sourceLine: sec.sourceLine, lines: [], repeatCount: sec.count };
    if (sec.performer !== undefined) s.performer = sec.performer;
    const rep = sectionRepeatOf[index];
    if (rep !== undefined) s.repeatOf = rep;
    return s;
  });
  for (const st of finalStanzas) {
    if (st.lines.length === 0) continue;
    const stanzaIndex = outStanzas.length;
    const ids: string[] = [];
    const keys: string[] = [];
    for (const d of st.lines) {
      const index = lines.length;
      const id = `${o.idPrefix}${index}`;
      idOf.set(d, id);
      const key = folded(d.text);
      keys.push(key);
      const line: LyricLine = {
        id,
        index,
        text: d.text,
        source: d.source,
        sourceLine: d.sourceLine,
        stanza: stanzaIndex,
        repeatCount: d.count,
        adlib: d.adlib,
        wordCount: wordSegmentsOf(pack, d.text).length,
      };
      if (st.section !== undefined) {
        line.section = st.section;
        outSections[st.section]?.lines.push(id);
      }
      if (d.startMs !== undefined) line.startMs = d.startMs;
      if (d.endMs !== undefined) line.endMs = d.endMs;
      if (d.marks.length > 0) line.wordMarks = d.marks;
      if (key) {
        const first = firstByKey.get(key);
        if (first !== undefined) line.repeatOf = first;
        else firstByKey.set(key, id);
      }
      if (d.copyOf) {
        const from = idOf.get(d.copyOf);
        if (from !== undefined) line.expandedFrom = from;
      }
      lines.push(line);
      ids.push(id);
    }
    const stanza: LyricStanza = { index: stanzaIndex, lines: ids, repeatCount: st.count };
    if (st.section !== undefined) stanza.section = st.section;
    const skey = keys.join('\n');
    const firstStanza = stanzaByKey.get(skey);
    if (firstStanza !== undefined) stanza.repeatOf = firstStanza;
    else stanzaByKey.set(skey, stanzaIndex);
    outStanzas.push(stanza);
  }

  return { lines, stanzas: outStanzas, sections: outSections, tags, timed, removed };
}

/** The line with this id, or undefined. */
export function lyricLine(lyrics: Lyrics, id: string): LyricLine | undefined {
  return lyrics.lines.find((l) => l.id === id);
}
