import type { Voice } from './types';

/**
 * How long the installed-voice list may take. A platform that never reports voices (expo-speech
 * on the web waits for 'voiceschanged', which a browser without speech voices never fires) gets
 * an empty list after this, so nothing waiting for voices hangs. src/session/common re-exports it
 * for the session's Speaker and the voice pickers.
 */
export const VOICE_LIST_TIMEOUT_MS = 1500;

/** 'es_MX' and 'ES-mx' both become 'es-mx'. */
export function normalizeLang(lang: string): string {
  return lang.trim().replace(/_/g, '-').toLowerCase();
}

/** True when `voiceLang` is `lang` or a regional variant of it ('es' matches 'es-MX'). */
export function langMatches(voiceLang: string, lang: string): boolean {
  const v = normalizeLang(voiceLang);
  const l = normalizeLang(lang);
  return v === l || v.startsWith(`${l}-`);
}

/** Voices for `lang` (all when omitted), enhanced first, then by language and name. */
export function filterVoices(voices: readonly Voice[], lang?: string): Voice[] {
  const rank = (v: Voice) => (v.quality === 'enhanced' ? 0 : 1);
  return voices
    .filter((v) => lang === undefined || langMatches(v.lang, lang))
    .sort((a, b) => rank(a) - rank(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}
