/**
 * Shared, immutable building blocks for the service factories, built once on first use:
 * the en-es packs and the trained mock model. Packs are read-only data and the mock model's
 * n-gram tables never change after training, so every container can share them; each
 * MockModelAdapter still has its own status.
 */
import { createDefaultSpanishPack, createMockModel, type LanguageModel, type LanguagePack } from '@cliffword/engine';
import { getDefaultPairPack } from '../engine/PacksProvider';
import type { ServicePacks } from './types';

let lang: LanguagePack | undefined;
let packs: ServicePacks | undefined;
let mockModel: LanguageModel | undefined;

/** The Spanish pack (all regions) and the en-es pair pack (the same object PacksProvider uses). */
export function defaultPacks(): ServicePacks {
  lang ??= createDefaultSpanishPack();
  packs ??= { lang, pair: getDefaultPairPack() };
  return packs;
}

/** The engine's mock model (createMockModel), trained once. */
export function sharedMockModel(): LanguageModel {
  mockModel ??= createMockModel();
  return mockModel;
}
