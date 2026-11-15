/** Corrections: rule-made variants scored by the model; the winning rule explains. */
export {
  DEFAULT_VARIANT_OPTIONS,
  KIND_PRIORITY,
  capitalizeFirst,
  generateVariantSet,
  generateVariants,
  isAllCaps,
  lowercaseFirst,
  matchCase,
  slangIndex,
  slangWordIndices,
  startsUpper,
} from './variants';
export type { Register, SlangIndex, Variant, VariantOptions, VariantSet } from './variants';
export { DEFAULT_JUDGE_OPTIONS, decideVerdict, judgeSentence, sharedPrefixEnd } from './judge';
export type { JudgeOptions, Judgement, ScoredVariant, Verdict } from './judge';
