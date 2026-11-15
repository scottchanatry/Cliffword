/**
 * Spanish enclitic pronouns: attaching them to a verb and splitting them off again.
 *
 * Spanish writes object pronouns as one word with an infinitive, a gerund or an
 * affirmative command (verlo, leyéndolo, dámelo) and as separate words before every other
 * verb form (lo veo, no lo hagas). Attaching keeps the stress of the host, so a written
 * accent appears when the default stress rule would move it (leyendo + lo -> leyéndolo)
 * and goes when it no longer departs from it (dé + me -> deme). The move rules of the
 * corrections module use these through LanguagePack.attachClitic and splitClitics.
 */
import type { CliticSplit } from '../types';
import { DEFAULT_ANALYZE_OPTIONS, analyze, cliticSplits, isStandardForm } from './analyze';
import { accentLastVowel, hasAcute, removeAcute, suffixKeepingStress, syllableCount } from './stress';

/**
 * Attach one clitic to a host (both normalized, lowercase), keeping the host's stress.
 *
 * Method: suffixKeepingStress (stress.ts) finds the stressed vowel of the host, appends
 * the clitic and writes an accent only where the default rule would now put the stress
 * elsewhere. Applied once per clitic: da + me -> dame, dame + lo -> dámelo (the stress
 * of dame is still that of da). Two spelling rules of the nosotros and vosotros commands:
 * a host ending in -mos drops its s before nos and se (vamos + nos -> vámonos, digamos +
 * se -> digámose), and a host ending in -d drops it before os (sentad + os -> sentaos),
 * except id (idos). Infinitives and gerunds never end in -mos or -d, so neither rule
 * touches them.
 */
export function attachClitic(host: string, clitic: string): string {
  if (!host) return clitic;
  if (!clitic) return host;
  let drop = 0;
  if ((clitic === 'nos' || clitic === 'se') && host.endsWith('mos')) drop = 1;
  if (clitic === 'os' && host.endsWith('d') && host !== 'id') drop = 1;
  return suffixKeepingStress(host, clitic, drop);
}

/** Splits of `word` into a base and its clitics, fewest clitics first (stable). */
function splitsByLength(word: string, max: number): [string, string[]][] {
  return cliticSplits(word, max)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s[1].length - b.s[1].length || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Spellings the host of a split may have as a word of its own, in the order tried: as
 * written (compró), without its written accent (leyéndo -> leyendo, dá -> da), a
 * one-syllable base with an accent (de -> dé, which loses it in deme), and with the s
 * a nosotros command drops before nos or se (vámo -> vamos) or the d a vosotros command
 * drops before os (senta -> sentad).
 */
function hostSpellings(base: string, first: string): { host: string; restored: '' | 's' | 'd' }[] {
  const out: { host: string; restored: '' | 's' | 'd' }[] = [];
  const add = (host: string, restored: '' | 's' | 'd') => {
    if (!out.some((o) => o.host === host)) out.push({ host, restored });
  };
  add(base, '');
  add(removeAcute(base), '');
  if (!hasAcute(base) && syllableCount(base) === 1) add(accentLastVowel(base), '');
  const plain = out.map((o) => o.host);
  if (first === 'nos' || first === 'se') for (const h of plain) add(h + 's', 's');
  if (first === 'os') for (const h of plain) add(h + 'd', 'd');
  return out;
}

/**
 * Split the enclitic pronouns off a word (normalized): dámelo -> da + [me, lo],
 * leyéndolo -> leyendo + [lo], compróla -> compró + [la], vámonos -> vamos + [nos].
 *
 * Method: a word that is a form of its own in the standard lexicon is never split (vale
 * is valer, not va + le; fuese is ser, not fue + se). Otherwise the analyzer's own splits
 * (cliticSplits, up to DEFAULT_ANALYZE_OPTIONS.maxClitics clitics) are tried with the
 * fewest clitics first, and the first base that is exactly a verb form of the standard
 * lexicon, under one of the spellings of hostSpellings, is the host. A restored s must
 * give a nosotros form and a restored d a vosotros form. Unlike the analyzer, finite
 * hosts are accepted too (compróla), so that a pronoun wrongly attached to one can be
 * moved in front of it. Slang verbs are not split.
 */
export function splitClitics(word: string, max: number = DEFAULT_ANALYZE_OPTIONS.maxClitics): CliticSplit | undefined {
  if (!word || isStandardForm(word)) return undefined;
  for (const [base, clitics] of splitsByLength(word, max)) {
    for (const { host, restored } of hostSpellings(base, clitics[0] as string)) {
      if (!isStandardForm(host)) continue;
      const ok = analyze(host).some((a) => {
        if (a.pos !== 'VERB' && a.pos !== 'AUX') return false;
        if (restored === '') return true;
        const person = restored === 's' ? '1' : '2';
        return a.features.person === person && a.features.number === 'p';
      });
      if (ok) return { host, clitics: [...clitics] };
    }
  }
  return undefined;
}
