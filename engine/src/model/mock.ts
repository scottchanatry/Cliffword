/**
 * Deterministic n-gram language model for tests. It implements the full LanguageModel
 * contract so engine code can be tested without a real model.
 *
 * Tokenization mimics a sub-word tokenizer: a token that starts a word carries its
 * leading space, and words longer than LONG_WORD letters are split into two tokens
 * (first 4 letters, then the rest), so code that merges sub-word pieces is exercised.
 * Probabilities are exact and normalized at the token level, so scoreContinuation and
 * nextTokens agree with each other.
 */
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from './types';
import { MOCK_CORPUS_ES } from './mockCorpus';

const LONG_WORD = 6;
const FIRST_PIECE = 4;
const DISCOUNT = 0.75;
const UNIGRAM_ADD = 0.1;
/** Extra cost per character of an unknown word, in nats. */
const UNKNOWN_CHAR_COST = -1.5;
const BOS = '<s>';
const SENTENCE_END = new Set(['.', '?', '!']);
/**
 * Punctuation generated without a space before it. CJK full-width marks are included so
 * a mock trained on a language written without spaces (Japanese, Chinese) does not
 * generate "です 。" (test/language-neutral.test.ts).
 */
const NO_SPACE_BEFORE = new Set(['.', ',', '?', '!', ';', ':', ')', '…', '。', '、', '！', '？', '」', '』', '）']);

const WORD_RE = /['’]?[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/uy;
const NUMBER_RE = /\d+(?:[.,]\d+)*/uy;
const SPACE_RE = /\s+/uy;

interface Piece {
  text: string;
  start: number;
  end: number;
  /** True if this piece starts a new unit (word or punctuation). */
  startsUnit: boolean;
  /** True if the unit this piece belongs to is a letter word. */
  isWord: boolean;
}

function isLetterWord(s: string): boolean {
  return /[\p{L}]/u.test(s);
}

/** Pieces of a unit (without its leading whitespace). */
function unitPieces(unit: string): string[] {
  if (isLetterWord(unit) && unit.length > LONG_WORD) {
    return [unit.slice(0, FIRST_PIECE), unit.slice(FIRST_PIECE)];
  }
  return [unit];
}

/** Tokenize text into pieces. Whitespace attaches to the following piece. */
export function mockTokenize(text: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let pendingWs = '';
  let pendingStart = 0;
  let prevWasLetterPiece = false;
  while (i < text.length) {
    SPACE_RE.lastIndex = i;
    const sp = SPACE_RE.exec(text);
    if (sp) {
      if (!pendingWs) pendingStart = i;
      pendingWs += sp[0];
      i += sp[0].length;
      prevWasLetterPiece = false;
      continue;
    }
    let unit: string;
    WORD_RE.lastIndex = i;
    const w = WORD_RE.exec(text);
    if (w) unit = w[0];
    else {
      NUMBER_RE.lastIndex = i;
      const n = NUMBER_RE.exec(text);
      unit = n ? n[0] : String.fromCodePoint(text.codePointAt(i) as number);
    }
    const isWord = isLetterWord(unit);
    const pieces = unitPieces(unit);
    const unitStart = pendingWs ? pendingStart : i;
    let pos = unitStart;
    pieces.forEach((p, idx) => {
      const ptext = idx === 0 ? pendingWs + p : p;
      const startsUnit = idx > 0 ? false : !(isWord && !pendingWs && prevWasLetterPiece);
      out.push({ text: ptext, start: pos, end: pos + ptext.length, startsUnit, isWord });
      pos += ptext.length;
    });
    pendingWs = '';
    i += unit.length;
    prevWasLetterPiece = isWord;
  }
  if (pendingWs) {
    out.push({ text: pendingWs, start: pendingStart, end: text.length, startsUnit: true, isWord: false });
  }
  return out;
}

function lc(s: string): string {
  return s.trim().toLowerCase();
}

/** Units (lowercased, no whitespace) of a training sentence. */
function trainingUnits(sentence: string): string[] {
  const units: string[] = [];
  for (const p of mockTokenize(sentence)) {
    if (!p.text.trim()) continue;
    if (p.startsUnit || units.length === 0) units.push(lc(p.text));
    else units[units.length - 1] += lc(p.text);
  }
  return units;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface State {
  /** Completed units, lowercased. */
  history: string[];
  /** Lowercased letters of the word being built from pieces; '' at a unit boundary. */
  prefix: string;
  /** Number of pieces already consumed for the current word. */
  prefixPieces: number;
  /** True when the current word is not a prefix of any known word. */
  prefixUnknown: boolean;
}

export class MockLanguageModel implements LanguageModel {
  readonly id: string;
  private readonly vocab: string[];
  private readonly uni = new Map<string, number>();
  private readonly bi = new Map<string, Map<string, number>>();
  private readonly tri = new Map<string, Map<string, number>>();
  private total = 0;

  constructor(corpus: readonly string[] = MOCK_CORPUS_ES, id = 'mock-ngram-es') {
    this.id = id;
    for (const sentence of corpus) {
      const units = [BOS, BOS, ...trainingUnits(sentence)];
      for (let i = 2; i < units.length; i++) {
        const w = units[i] as string;
        const v = units[i - 1] as string;
        const u = units[i - 2] as string;
        this.uni.set(w, (this.uni.get(w) ?? 0) + 1);
        this.total++;
        bump(this.bi, v, w);
        bump(this.tri, `${u}\u0001${v}`, w);
      }
    }
    this.vocab = [...this.uni.keys()];
  }

  // ---------- word-level distribution ----------

  private p1(w: string | null): number {
    const denom = this.total + UNIGRAM_ADD * (this.vocab.length + 1);
    return ((w === null ? 0 : this.uni.get(w) ?? 0) + UNIGRAM_ADD) / denom;
  }

  private pLevel(table: Map<string, number> | undefined, w: string | null, lower: number): number {
    if (!table) return lower;
    let tot = 0;
    for (const c of table.values()) tot += c;
    if (tot === 0) return lower;
    const c = w === null ? 0 : table.get(w) ?? 0;
    const lambda = (DISCOUNT * table.size) / tot;
    return Math.max(c - DISCOUNT, 0) / tot + lambda * lower;
  }

  /** P(w | history); w === null is the unknown-word mass. */
  private pWord(history: readonly string[], w: string | null): number {
    const v = history[history.length - 1] ?? BOS;
    const u = history[history.length - 2] ?? BOS;
    const p2 = this.pLevel(this.bi.get(v), w, this.p1(w));
    return this.pLevel(this.tri.get(`${u}\u0001${v}`), w, p2);
  }

  private historyKey(history: readonly string[]): string[] {
    // Reset at sentence boundaries so each sentence starts like training data.
    let start = 0;
    for (let i = 0; i < history.length; i++) if (SENTENCE_END.has(history[i] as string)) start = i + 1;
    const h = history.slice(start);
    return [BOS, BOS, ...h].slice(-2);
  }

  private dist(history: readonly string[]): Map<string, number> {
    const h = this.historyKey(history);
    const m = new Map<string, number>();
    for (const w of this.vocab) m.set(w, this.pWord(h, w));
    return m;
  }

  private pUnknown(history: readonly string[]): number {
    return this.pWord(this.historyKey(history), null);
  }

  // ---------- piece-level machinery ----------

  /** Probability mass of known words whose first k pieces concatenate to `prefix`. */
  private massForPrefix(dist: Map<string, number>, prefix: string, k: number): number {
    let m = 0;
    for (const [w, p] of dist) {
      const ps = unitPieces(w);
      if (ps.length >= k && ps.slice(0, k).join('') === prefix) m += p;
    }
    return m;
  }

  /** log P(the current word ends here | state). */
  private logEnd(state: State): number {
    if (!state.prefix || state.prefixUnknown) return 0;
    const d = this.dist(state.history);
    const mass = this.massForPrefix(d, state.prefix, state.prefixPieces);
    const complete = d.get(state.prefix) ?? 0;
    const ps = unitPieces(state.prefix);
    const isWhole = ps.length === state.prefixPieces ? complete : 0;
    return mass > 0 ? Math.log(isWhole / mass) : 0;
  }

  private commit(state: State): State {
    if (!state.prefix) return state;
    return { history: [...state.history, state.prefix], prefix: '', prefixPieces: 0, prefixUnknown: false };
  }

  /** Advance the state by one piece and return the piece's log-probability. */
  private step(state: State, piece: Piece): { state: State; logprob: number } {
    const body = lc(piece.text);
    if (!body) return { state, logprob: 0 }; // trailing whitespace only
    if (piece.startsUnit) {
      const endLp = this.logEnd(state);
      const committed = this.commit(state);
      const d = this.dist(committed.history);
      const mass = piece.isWord ? this.massForPrefix(d, body, 1) : d.get(body) ?? 0;
      if (mass > 0) {
        return {
          state: { history: committed.history, prefix: body, prefixPieces: 1, prefixUnknown: false },
          logprob: endLp + Math.log(mass),
        };
      }
      const lp = Math.log(this.pUnknown(committed.history)) + UNKNOWN_CHAR_COST * body.length;
      return {
        state: { history: committed.history, prefix: body, prefixPieces: 1, prefixUnknown: true },
        logprob: endLp + lp,
      };
    }
    // Continuation of the current word.
    const next = state.prefix + body;
    if (state.prefixUnknown) {
      return {
        state: { ...state, prefix: next, prefixPieces: state.prefixPieces + 1 },
        logprob: UNKNOWN_CHAR_COST * body.length,
      };
    }
    const d = this.dist(state.history);
    const before = this.massForPrefix(d, state.prefix, state.prefixPieces);
    const after = this.massForPrefix(d, next, state.prefixPieces + 1);
    if (after > 0 && before > 0) {
      return {
        state: { ...state, prefix: next, prefixPieces: state.prefixPieces + 1 },
        logprob: Math.log(after / before),
      };
    }
    return {
      state: { ...state, prefix: next, prefixPieces: state.prefixPieces + 1, prefixUnknown: true },
      logprob: Math.log(1e-4) + UNKNOWN_CHAR_COST * body.length,
    };
  }

  private run(context: string): State {
    let state: State = { history: [], prefix: '', prefixPieces: 0, prefixUnknown: false };
    for (const p of mockTokenize(context)) state = this.step(state, p).state;
    return state;
  }

  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    let state = this.run(context);
    const ctxEndsLetter = /[\p{L}\p{M}'’]$/u.test(context);
    const out: TokenScore[] = [];
    mockTokenize(text).forEach((p, idx) => {
      // A letter piece glued to a context that ends in letters continues that word.
      const piece = idx === 0 && ctxEndsLetter && p.isWord && !/^\s/u.test(p.text) ? { ...p, startsUnit: false } : p;
      const r = this.step(state, piece);
      state = r.state;
      out.push({ text: p.text, start: p.start, end: p.end, logprob: r.logprob });
    });
    return out;
  }

  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    const state = this.run(context);
    const scores = new Map<string, number>();
    const add = (t: string, p: number) => scores.set(t, (scores.get(t) ?? 0) + p);
    // Continuations of the current word.
    if (state.prefix && !state.prefixUnknown) {
      const d = this.dist(state.history);
      const mass = this.massForPrefix(d, state.prefix, state.prefixPieces);
      for (const [w, p] of d) {
        const ps = unitPieces(w);
        if (ps.length > state.prefixPieces && ps.slice(0, state.prefixPieces).join('') === state.prefix) {
          add(ps[state.prefixPieces] as string, p / mass);
        }
      }
    }
    // New units.
    const pEnd = Math.exp(this.logEnd(state));
    const committed = this.commit(state);
    const atStart = context.length === 0 || /\s$/u.test(context);
    for (const [w, p] of this.dist(committed.history)) {
      if (w === BOS) continue;
      const first = unitPieces(w)[0] as string;
      const ws = atStart || NO_SPACE_BEFORE.has(w) ? '' : ' ';
      add(ws + first, pEnd * p);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([text, p]) => ({ text, logprob: Math.log(p) }));
  }

  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    const results: string[] = [];
    const base = this.run(prompt);
    const startHistory = this.commit(base).history;
    for (let i = 0; i < opts.n; i++) {
      const rand = mulberry32((opts.seed ?? 1) + i);
      const history = [...startHistory];
      let out = '';
      for (let t = 0; t < opts.maxTokens; t++) {
        const d = this.dist(history);
        d.delete(BOS);
        const temp = Math.max(opts.temperature, 1e-3);
        const weights = [...d.entries()].map(([w, p]) => [w, Math.pow(p, 1 / temp)] as const);
        const z = weights.reduce((s, [, x]) => s + x, 0);
        let r = rand() * z;
        let pick = weights[weights.length - 1]?.[0] ?? '.';
        for (const [w, x] of weights) {
          r -= x;
          if (r <= 0) { pick = w; break; }
        }
        const ws = (out === '' && /\s$/u.test(prompt)) || NO_SPACE_BEFORE.has(pick) ? '' : ' ';
        const candidate = out + ws + pick;
        const stopAt = (opts.stop ?? []).map((s) => candidate.indexOf(s)).filter((x) => x >= 0);
        if (stopAt.length) { out = candidate.slice(0, Math.min(...stopAt)); break; }
        out = candidate;
        history.push(pick);
      }
      results.push(out);
    }
    return results;
  }
}

function bump(table: Map<string, Map<string, number>>, key: string, w: string): void {
  let m = table.get(key);
  if (!m) { m = new Map(); table.set(key, m); }
  m.set(w, (m.get(w) ?? 0) + 1);
}

export function createMockModel(corpus?: readonly string[]): MockLanguageModel {
  return new MockLanguageModel(corpus);
}
