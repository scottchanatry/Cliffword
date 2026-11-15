/**
 * The context a sentence is scored after, and which words street register exempts.
 *
 * Proof test (proof/RESULTS.md, Qwen3-1.7B and Qwen3-4B):
 * - A short fixed prefix is required: with "Frase en español:\n" both models pick the
 *   correct sentence of a minimal pair 97% of the time, against 85% with no prefix.
 * - Street sentences score about 4.5 nats per word worse than neutral paraphrases. A
 *   register prefix recovers about 1.2 nats per word, and only for slang words it names.
 *   So street mode names the slang found in the text, and never shades or flags slang
 *   from the region packs (slangExemption); corrections already protect slang words.
 */
import type { LanguagePack, RegisterPack, Register, Segment } from '../lang/types';

export interface ScoringContextOptions {
  register: Register;
  /**
   * Region codes whose register packs apply in street register, e.g. ["PR", "CARIB"].
   * The first one with a scoringPrefix supplies the prefix. Empty means every pack.
   */
  regions: readonly string[];
  /** Slang words to name in a street prefix, in order. Usually slangIn(...) of the text. */
  words: readonly string[];
  /**
   * When fewer words than this are given, the prefix is filled up with the first entries
   * of the applicable register packs, so it always shows the register.
   */
  minWords: number;
  /** Most words to name. */
  maxWords: number;
}

export const DEFAULT_SCORING_CONTEXT_OPTIONS: Readonly<ScoringContextOptions> = {
  register: 'neutral',
  regions: [],
  words: [],
  minWords: 3,
  maxWords: 8,
};

function applicable(pack: LanguagePack, regions: readonly string[]): RegisterPack[] {
  if (regions.length === 0) return [...pack.registers];
  const out: RegisterPack[] = [];
  for (const r of regions) for (const reg of pack.registers) if (reg.region === r && !out.includes(reg)) out.push(reg);
  return out;
}

/**
 * The fixed text a sentence is scored after. Neutral register: pack.scoringPrefix.
 * Street register: the first applicable register pack's scoringPrefix with "{words}"
 * replaced by the slang words to name; the neutral prefix when no pack has one.
 * '' when the pack defines no prefix at all.
 */
export function scoringPrefix(pack: LanguagePack, opts: Partial<ScoringContextOptions> = {}): string {
  const o = { ...DEFAULT_SCORING_CONTEXT_OPTIONS, ...opts };
  const neutral = pack.scoringPrefix ?? '';
  if (o.register !== 'street') return neutral;
  const regs = applicable(pack, o.regions);
  const template = regs.find((r) => r.scoringPrefix)?.scoringPrefix;
  if (!template) return neutral;
  const words: string[] = [];
  const add = (w: string) => {
    if (w && !words.includes(w) && words.length < o.maxWords) words.push(w);
  };
  for (const w of o.words) add(w);
  for (const reg of regs) {
    for (const e of reg.entries) {
      if (words.length >= Math.min(o.minWords, o.maxWords)) break;
      add(e.form);
    }
  }
  return template.split('{words}').join(words.join(', '));
}

/**
 * Context for scoring: the prefix followed by `before` (earlier story text, or '' for a
 * lone sentence). Pass the result as the context of scoreWords, judgeSentence,
 * cliffPositions and scoreCliffAnswer. Scores are only comparable under the same prefix.
 */
export function scoringContext(
  pack: LanguagePack,
  before = '',
  opts: Partial<ScoringContextOptions> = {},
): string {
  return scoringPrefix(pack, opts) + before;
}

/** Normalized words of a slang form ("de una" -> ["de", "una"]). */
function formWords(pack: LanguagePack, form: string): string[] {
  return pack
    .segment(form)
    .filter((s) => s.kind === 'word')
    .map((s) => s.norm)
    .filter(Boolean);
}

/**
 * Slang forms from the applicable register packs that occur in `text`, in text order.
 * Single words match by normalized form; phrases match as a run of words.
 */
export function slangIn(pack: LanguagePack, text: string, regions: readonly string[] = []): string[] {
  const words = pack.segment(text).filter((s) => s.kind === 'word').map((s) => s.norm);
  const found: { at: number; form: string }[] = [];
  for (const reg of applicable(pack, regions)) {
    for (const e of reg.entries) {
      const fw = formWords(pack, e.form);
      if (fw.length === 0) continue;
      for (let i = 0; i + fw.length <= words.length; i++) {
        if (fw.every((w, j) => words[i + j] === w)) {
          if (!found.some((f) => f.form === e.form)) found.push({ at: i, form: e.form });
          break;
        }
      }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.form);
}

/**
 * Predicate for HeatOptions.exempt in street register: true for a word that is (part of)
 * a slang form of the applicable register packs. Such words are never shaded, because
 * the model cannot judge them (proof test: 0 of 26 street sentences beat their neutral
 * paraphrase). Entries marked alsoStandard are standard words too, and stay exempt here:
 * in street register they are slang.
 */
export function slangExemption(
  pack: LanguagePack,
  regions: readonly string[] = [],
): (segment: Segment) => boolean {
  const norms = new Set<string>();
  for (const reg of applicable(pack, regions)) {
    for (const e of reg.entries) for (const w of formWords(pack, e.form)) norms.add(w);
  }
  return (segment) => segment.kind === 'word' && norms.has(segment.norm);
}
