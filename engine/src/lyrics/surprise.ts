/**
 * Surprise map of a text the learner brings (or of parsed lyrics): every word's surprise
 * and heat, sentence by sentence, each scored after the sentence before it, so the
 * learner sees which words a Spanish speaker would not expect there.
 *
 * Street register follows the proof test (proof/RESULTS.md): slang scores about 4.5 nats
 * per word worse than neutral text whatever the context, so the scoring prefix names the
 * slang found (scoringPrefix with slangIn) and slang words get heat 0
 * (slangExemption as HeatOptions.exempt, plus slang written without its marks).
 */
import type { LanguagePack, Register, Segment } from '../lang/types';
import type { LanguageModel } from '../model/types';
import type { Heat, WordScore } from '../scoring/types';
import { scoreWords, type HeatOptions } from '../scoring/wordScores';
import { scoringPrefix, slangExemption, slangIn } from '../scoring/context';
import { needsLeadingSpace } from '../scoring/text';
import type { Lyrics } from './parse';
import { findSlangMatches, type SlangMatch } from './slang';
import { lyricUnits, splitTextUnits, unitsBefore, type SplitTextOptions, type TextUnit } from './units';

export interface SurpriseMapOptions extends SplitTextOptions {
  /** Register-pack regions as in scoring/context.ts; [] = every pack the language pack holds. */
  regions: readonly string[];
  /**
   * Earlier sentences (or lines) put before each one as context. One: the previous
   * sentence gives the model the topic without paying for the whole text on every call.
   */
  contextUnits: number;
  /** Heat options for scoreWords; in street register `exempt` is combined with the slang exemption. */
  heat: Partial<HeatOptions>;
  /** Exempt slang written without accents or apostrophes too (street register). */
  loose: boolean;
  /** Parsed lyrics: leave ad-lib lines out. */
  skipAdlibs: boolean;
}

export const DEFAULT_SURPRISE_MAP_OPTIONS: Readonly<SurpriseMapOptions> = {
  splitLines: true,
  regions: [],
  contextUnits: 1,
  heat: {},
  loose: true,
  skipAdlibs: true,
};

export interface SurpriseUnit {
  /** Sentence id ("s0") or lyric line id ("l0"). */
  id: string;
  index: number;
  text: string;
  /** Offset of the unit in the brought text (0 for lyric lines). */
  start: number;
  end: number;
  /**
   * One score per word. Segment offsets are in the brought text (string input) or in the
   * line text (Lyrics input), not in the scored string.
   */
  words: WordScore[];
  /** Highest heat in the unit (0 when it has no words). */
  maxHeat: Heat;
  /** Slang in the unit (offsets in the unit text). */
  slang: SlangMatch[];
}

/**
 * Word surprise for every sentence of `text` (or every line of parsed lyrics).
 *
 * Method, per unit: context = scoringPrefix(pack, { register, regions, words: slang of
 * the context and the unit }) + the previous contextUnits units; the unit is scored with
 * scoreWords (one model call), with a leading space when the context needs one
 * (needsLeadingSpace). In street register, words of slang forms get heat 0. Word
 * segments are shifted back to offsets in the input.
 */
export async function surpriseMap(
  model: LanguageModel,
  pack: LanguagePack,
  text: string | Lyrics,
  register: Register,
  opts: Partial<SurpriseMapOptions> = {},
): Promise<SurpriseUnit[]> {
  const o: SurpriseMapOptions = { ...DEFAULT_SURPRISE_MAP_OPTIONS, ...opts };
  let units: TextUnit[];
  if (typeof text === 'string') {
    const split: Partial<SplitTextOptions> = { splitLines: o.splitLines };
    if (o.abbreviations) split.abbreviations = o.abbreviations;
    units = splitTextUnits(pack, text, split);
  } else units = lyricUnits(text, o.skipAdlibs);
  const exemptSlang = slangExemption(pack, o.regions);
  const out: SurpriseUnit[] = [];
  for (let u = 0; u < units.length; u++) {
    const unit = units[u] as TextUnit;
    if (unit.skip) continue;
    const before = unitsBefore(units, u, o.contextUnits);
    const context =
      scoringPrefix(pack, { register, regions: o.regions, words: slangIn(pack, before + unit.separator + unit.text, o.regions) }) + before;
    const lead = needsLeadingSpace(context) ? ' ' : '';
    const slang = findSlangMatches(pack, unit.text, { regions: o.regions, loose: o.loose });
    const heat: Partial<HeatOptions> = { ...o.heat };
    if (register === 'street') {
      const looseStarts = new Set(slang.filter((m) => m.loose).map((m) => m.start + lead.length));
      const own = o.heat.exempt;
      heat.exempt = (seg: Segment) => exemptSlang(seg) || looseStarts.has(seg.start) || (own ? own(seg) : false);
    }
    const scored = await scoreWords(model, pack, context, lead + unit.text, heat);
    const shift = unit.start - lead.length;
    const words = scored.map((w) => ({ ...w, segment: { ...w.segment, start: w.segment.start + shift, end: w.segment.end + shift } }));
    let maxHeat: Heat = 0;
    for (const w of words) if (w.heat > maxHeat) maxHeat = w.heat;
    out.push({ id: unit.id, index: unit.index, text: unit.text, start: unit.start, end: unit.end, words, maxHeat, slang });
  }
  return out;
}
