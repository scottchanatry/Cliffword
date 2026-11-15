/**
 * Spoken commands: recognize "otra vez", "más despacio", "no sé", "siguiente", "listo",
 * "qué significa" (whatever LanguagePack.commands lists) in a recognized utterance.
 *
 * A command is matched only when the utterance is essentially the command: "no sé" alone
 * (or "eh... no sé", "no sé, no sé") is the command; "no sé si viene" is an answer, and
 * "listo" inside a longer answer is part of that answer. Getting this wrong in one
 * direction skips a learner's real answer, so matching is strict by default.
 *
 * Method
 * ------
 * 1. Segment the transcript with the pack (never split on spaces) and take the words and
 *    numbers. Each is compared by its loose key: lowercase, accents folded with
 *    pack.foldAccents (else DEFAULT_ACCENT_MARKS), apostrophes removed, so case,
 *    punctuation and missing accents never matter ("No se." is "no sé", "mas despacio"
 *    is "más despacio"). Command phrases and fillers go through the same keys.
 * 2. Per command, the words must be covered completely, in order, by pieces:
 *    - a phrase of that command (at least one), exactly, or with one word off by one
 *      character when the phrase has two or more words and that word is long enough
 *      ("otra ves" for "otra vez", a common recognizer spelling of a seseo speaker);
 *      single-word phrases never match loosely ("lista" is not "listo");
 *    - a filler word or phrase (options.fillers; LanguagePack.fillers by default),
 *      at most maxFillerWords of them.
 *    Repeating the command ("otra vez, otra vez") is allowed. For commands that take an
 *    argument (options.argumentCommands: 'meaning' by default), up to maxArgumentWords
 *    words before or after the cover are the argument ("qué significa puesto").
 * 3. Confidence = 1 - fillerPenalty per filler word - repeatPenalty per extra phrase -
 *    fuzzyPenalty per loose word, clamped to [0, 1]. The best command wins; below
 *    minConfidence the result is null.
 * 4. When options.answer is given, an utterance that is exactly that answer (fillers
 *    aside) is the answer, not a command: a cliff whose word is "ya" or "siguiente".
 */
import type { LanguagePack, SpokenCommand } from '../lang/types';
import { DEFAULT_ACCENT_MARKS } from '../scoring/text';
import { charDistance, codeLength, phraseKeys, spokenWords } from './text';

/** Tunable numbers and data of command matching. */
export interface CommandOptions {
  /**
   * Filler words and phrases dropped around a command, written as the pack spells them.
   * undefined: LanguagePack.fillers (none when the pack has none).
   */
  fillers: readonly string[] | undefined;
  /** Confidence lost per filler word: a filler makes it a little likelier the learner was starting an answer. */
  fillerPenalty: number;
  /** More filler words than this and the utterance is talk, not a command. */
  maxFillerWords: number;
  /** Confidence lost per repetition of the command after the first ("otra vez, otra vez"). */
  repeatPenalty: number;
  /** Allow one word of a multi-word phrase to be off by one character. */
  fuzzy: boolean;
  /** Confidence lost for that loose word. */
  fuzzyPenalty: number;
  /** A loose word must have at least this many characters (both the heard and the phrase word). */
  fuzzyMinLength: number;
  /** Commands that may carry an argument before or after them ("qué significa puesto"). */
  argumentCommands: readonly SpokenCommand[];
  /** Most words in an argument. */
  maxArgumentWords: number;
  /** Utterances with more words than this are never commands (checked first, cheaply). */
  maxWords: number;
  /** Matches below this confidence are dropped (null). */
  minConfidence: number;
  /**
   * The answer the app is waiting for, if any. An utterance that is exactly this answer
   * (loose comparison, fillers aside) is returned as no command.
   */
  answer: string | undefined;
  /** Combining marks folded when the pack has no foldAccents. */
  marks: string;
}

/**
 * Defaults. All judgement calls, to be calibrated from what learners say:
 * - fillerPenalty 0.05 and maxFillerWords 3: "eh, pues, no sé" is still clearly the
 *   command (0.90); four or more fillers is someone thinking aloud.
 * - repeatPenalty 0.02: repeating a command is common and changes nothing.
 * - fuzzyPenalty 0.2 with fuzzyMinLength 3: one character off in a multi-word phrase
 *   ("otra ves") is still the command, at 0.8, so an app can confirm before acting.
 * - argumentCommands ['meaning'], maxArgumentWords 3: "what does X mean" names a word
 *   or a short phrase.
 * - maxWords 8: the longest Spanish phrase has 4 words ("más lento por favor"); with
 *   fillers, a repeat or an argument, 8 words is the most a command needs.
 * - minConfidence 0.6: keeps a fuzzy match with one filler (0.75) and drops a fuzzy
 *   match buried in fillers.
 */
export const DEFAULT_COMMAND_OPTIONS: Readonly<CommandOptions> = {
  fillers: undefined,
  fillerPenalty: 0.05,
  maxFillerWords: 3,
  repeatPenalty: 0.02,
  fuzzy: true,
  fuzzyPenalty: 0.2,
  fuzzyMinLength: 3,
  argumentCommands: ['meaning'],
  maxArgumentWords: 3,
  maxWords: 8,
  minConfidence: 0.6,
  answer: undefined,
  marks: DEFAULT_ACCENT_MARKS,
};

export interface CommandMatch {
  command: SpokenCommand;
  /** 1 for the exact phrase alone; lower with fillers, repeats or a loose word (see the module comment). */
  confidence: number;
  /** The pack phrase that matched, as the pack writes it ("no sé"); the first one when repeated. */
  matched: string;
  /** For argument commands: the argument exactly as it appears in the transcript ("puesto"). */
  argument?: string;
}

interface PhraseKeys {
  phrase: string;
  keys: string[];
}

interface Cover {
  penalty: number;
  /** Leftmost phrase of the cover; null only inside the recursion before a phrase is placed. */
  phrase: string | null;
  fillerWords: number;
}

/** Loose words of a phrase at position i of `keys`: 0 exact, 1 one word off by one character, null no match. */
function phraseEdits(keys: readonly string[], i: number, p: readonly string[], o: CommandOptions): number | null {
  if (i + p.length > keys.length) return null;
  let loose = 0;
  for (let k = 0; k < p.length; k++) {
    const heard = keys[i + k] as string;
    const want = p[k] as string;
    if (heard === want) continue;
    if (!o.fuzzy || p.length < 2 || loose > 0) return null;
    if (Math.min(codeLength(heard), codeLength(want)) < o.fuzzyMinLength) return null;
    if (charDistance(heard, want) !== 1) return null;
    loose++;
  }
  // A phrase must keep at least one exact word (guaranteed: one loose word, two or more words).
  return loose;
}

function startsWith(keys: readonly string[], i: number, piece: readonly string[]): boolean {
  if (i + piece.length > keys.length) return false;
  for (let k = 0; k < piece.length; k++) if (keys[i + k] !== piece[k]) return false;
  return true;
}

/** Cheapest complete cover of `keys` by phrases of one command and fillers (see the module comment). */
function cover(keys: readonly string[], phrases: readonly PhraseKeys[], fillers: readonly string[][], o: CommandOptions): Cover | null {
  const n = keys.length;
  const memo = new Map<number, Cover | null>();
  const go = (i: number, placed: boolean): Cover | null => {
    if (i === n) return placed ? { penalty: 0, phrase: null, fillerWords: 0 } : null;
    const id = i * 2 + (placed ? 1 : 0);
    if (memo.has(id)) return memo.get(id) as Cover | null;
    let best: Cover | null = null;
    for (const p of phrases) {
      const edits = phraseEdits(keys, i, p.keys, o);
      if (edits === null) continue;
      const rest = go(i + p.keys.length, true);
      if (!rest) continue;
      const penalty = rest.penalty + (placed ? o.repeatPenalty : 0) + edits * o.fuzzyPenalty;
      if (!best || penalty < best.penalty - 1e-12) {
        best = { penalty, phrase: placed ? null : p.phrase, fillerWords: rest.fillerWords };
      }
    }
    for (const f of fillers) {
      if (!startsWith(keys, i, f)) continue;
      const rest = go(i + f.length, placed);
      if (!rest) continue;
      const penalty = rest.penalty + f.length * o.fillerPenalty;
      if (!best || penalty < best.penalty - 1e-12) {
        best = { penalty, phrase: rest.phrase, fillerWords: rest.fillerWords + f.length };
      }
    }
    memo.set(id, best);
    return best;
  };
  const top = go(0, false);
  if (!top || top.phrase === null || top.fillerWords > o.maxFillerWords) return null;
  return top;
}

/** Remove filler phrases (longest first at each position) from a key sequence. */
function stripFillers(keys: readonly string[], fillers: readonly string[][]): string[] {
  const sorted = [...fillers].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0;
  while (i < keys.length) {
    const f = sorted.find((piece) => startsWith(keys, i, piece));
    if (f) {
      i += f.length;
      continue;
    }
    out.push(keys[i] as string);
    i++;
  }
  return out;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Match a recognized utterance against the pack's spoken commands. Returns the command,
 * a confidence in [0, 1], the pack phrase that matched and, for argument commands, the
 * argument; null when the utterance is not essentially a command, when the pack lists no
 * commands, or when the best match is below options.minConfidence. See the module
 * comment for the method.
 */
export function matchCommand(
  transcript: string,
  pack: Pick<LanguagePack, 'code' | 'segment' | 'normalize' | 'foldAccents' | 'commands' | 'fillers'>,
  opts: Partial<CommandOptions> = {},
): CommandMatch | null {
  const o: CommandOptions = { ...DEFAULT_COMMAND_OPTIONS, ...opts };
  const entries = pack.commands ?? [];
  if (entries.length === 0) return null;
  const words = spokenWords(pack, transcript, o.marks);
  if (words.length === 0 || words.length > o.maxWords) return null;
  const keys = words.map((w) => w.key);
  const fillers = (o.fillers ?? pack.fillers ?? []).map((f) => phraseKeys(pack, f, o.marks)).filter((k) => k.length > 0);
  const fillerWords = new Set(fillers.filter((f) => f.length === 1).map((f) => f[0] as string));

  if (o.answer !== undefined) {
    const answer = stripFillers(phraseKeys(pack, o.answer, o.marks), fillers);
    if (answer.length > 0 && sameKeys(answer, stripFillers(keys, fillers))) return null;
  }

  let best: CommandMatch | null = null;
  const consider = (m: CommandMatch) => {
    if (!best || m.confidence > best.confidence + 1e-12) best = m;
  };

  for (const entry of entries) {
    const phrases = entry.phrases.map((phrase) => ({ phrase, keys: phraseKeys(pack, phrase, o.marks) })).filter((p) => p.keys.length > 0);
    if (phrases.length === 0) continue;
    const whole = cover(keys, phrases, fillers, o);
    if (whole?.phrase) consider({ command: entry.command, confidence: clamp01(1 - whole.penalty), matched: whole.phrase });
    if (!o.argumentCommands.includes(entry.command)) continue;
    const n = keys.length;
    for (let k = 1; k <= Math.min(o.maxArgumentWords, n - 1); k++) {
      // Argument after the command (words n-k..n-1) or before it (words 0..k-1).
      for (const [from, to, a0, a1] of [[0, n - k, n - k, n], [k, n, 0, k]] as const) {
        const first = keys[a0] as string;
        const last = keys[a1 - 1] as string;
        if (fillerWords.has(first) || fillerWords.has(last)) continue; // fillers are not an argument
        const c = cover(keys.slice(from, to), phrases, fillers, o);
        if (!c?.phrase) continue;
        const argWords = words.slice(a0, a1);
        const argument = transcript.slice((argWords[0] as (typeof words)[number]).start, (argWords[argWords.length - 1] as (typeof words)[number]).end);
        consider({ command: entry.command, confidence: clamp01(1 - c.penalty), matched: c.phrase, argument });
      }
    }
  }
  const found = best as CommandMatch | null;
  return found && found.confidence >= o.minConfidence ? found : null;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
