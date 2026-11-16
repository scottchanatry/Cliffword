/**
 * Listen options for hold to speak: recognition in the pack's locale for the learner's regions
 * (recognitionLocales: PR, DO and CU prefer es-US), on the device unless the learner allowed
 * network recognition (settings.allowNetworkRecognition, off by default), interim results,
 * continuous until release, and the screen's words plus the pack's spoken commands as hints.
 */
import type { LanguagePack } from '@cliffword/engine';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import type { ListenOptions } from '../../adapters/speechIn/types';

/** At most this many recognizer hints (iOS contextual strings are meant to be a short list). */
export const MAX_HINTS = 100;

/** Hints in order without repeats or blanks, the pack's command phrases last, capped at MAX_HINTS. */
export function withCommandHints(pack: Pick<LanguagePack, 'commands'>, words: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const add = (text: string | null | undefined) => {
    const t = text?.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const w of words) add(w);
  for (const entry of pack.commands ?? []) for (const phrase of entry.phrases) add(phrase);
  return out.slice(0, MAX_HINTS);
}

export function listenOptionsFor(
  pack: Pick<LanguagePack, 'code' | 'commands'>,
  regions: readonly string[],
  deviceLocales: readonly string[],
  words: readonly (string | null | undefined)[],
  opts: { allowNetwork?: boolean } = {},
): ListenOptions {
  const locales = recognitionLocales(pack.code, regions, deviceLocales);
  return {
    lang: locales[0] ?? pack.code,
    langFallbacks: locales.slice(1),
    onDevice: opts.allowNetwork !== true,
    interim: true,
    continuous: true,
    hints: withCommandHints(pack, words),
  };
}
