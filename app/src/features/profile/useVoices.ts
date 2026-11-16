/**
 * The story voice: the installed voices for the target language (the ones in the learner's
 * region order first, enhanced before default, at most MAX_VOICES plus the chosen one), and a
 * sample read with a voice: the first sentence of the pair's starter story (target-language
 * content), at the learner's speech speed. A sample still playing stops when the screen goes away.
 */
import { useEffect, useRef, useState } from 'react';
import type { Voice } from '../../adapters/speechOut/types';
import { normalizeLang } from '../../adapters/speechOut/voices';
import { recognitionLocales } from '../../adapters/speechIn/locales';
import { useAppState } from '../../appState/AppStateProvider';
import { installedVoices, wordSpansOf } from '../../session/common/speaker';
import { useServices } from '../../services/ServicesProvider';

/** Voices listed before "more" would be needed: phones carry many novelty voices. */
export const MAX_VOICES = 6;

/** Voices ranked for a learner: region locales first (in order), enhanced first, then by name. */
export function rankVoices(voices: readonly Voice[], wantedLocales: readonly string[], keep: string | null, max = MAX_VOICES): Voice[] {
  const order = wantedLocales.map(normalizeLang);
  const rank = (v: Voice) => {
    const i = order.indexOf(normalizeLang(v.lang));
    return i < 0 ? order.length : i;
  };
  const sorted = [...voices].sort(
    (a, b) => rank(a) - rank(b) || (a.quality === b.quality ? 0 : a.quality === 'enhanced' ? -1 : 1) || a.name.localeCompare(b.name),
  );
  const shown = sorted.slice(0, max);
  const kept = keep ? sorted.find((v) => v.id === keep) : undefined;
  if (kept && !shown.includes(kept)) shown.push(kept);
  return shown;
}

/** The voice "Automatic" plays: what the session controllers pick (first in region order). */
export function autoVoice(voices: readonly Voice[], wantedLocales: readonly string[]): Voice | null {
  for (const lang of wantedLocales) {
    const v = voices.find((x) => normalizeLang(x.lang) === normalizeLang(lang));
    if (v) return v;
  }
  return voices[0] ?? null;
}

export interface VoicesView {
  /** null while the list loads. */
  voices: Voice[] | null;
  /** A sample is being read. */
  playing: boolean;
  /** The sample sentence exists (the pair has a starter story). */
  canSample: boolean;
  /** Read the sample with a voice id, or the automatic voice for null. */
  playSample: (voiceId: string | null) => void;
}

export function useVoices(): VoicesView {
  const { speechOut, packs } = useServices();
  const { settings } = useAppState();
  const [all, setAll] = useState<Voice[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const live = useRef(true);
  /** A sample of ours is playing (the screen stops only its own sample when it goes away). */
  const sampling = useRef(false);
  const wanted = recognitionLocales(packs.lang.code, settings.regions);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sampling.current) void speechOut.stop().catch(() => undefined);
    };
  }, [speechOut]);

  useEffect(() => {
    let current = true;
    // Bounded: a browser without speech voices never answers (then the list is empty).
    void installedVoices(speechOut, packs.lang.code).then((list) => {
      if (current) setAll(list);
    });
    return () => {
      current = false;
    };
  }, [speechOut, packs]);

  const sample = packs.pair.starter?.sentences[0]?.text ?? null;
  const bias = settings.speechRateBias;

  const playSample = (voiceId: string | null) => {
    if (!sample) return;
    const chosen = (voiceId ? all?.find((v) => v.id === voiceId) : null) ?? autoVoice(all ?? [], wanted);
    setPlaying(true);
    sampling.current = true;
    speechOut
      .speak(sample, {
        lang: chosen?.lang ?? wanted[0] ?? packs.lang.code,
        ...(chosen ? { voice: chosen.id } : {}),
        rate: 1 + bias,
        words: wordSpansOf(packs.lang, sample),
      })
      .catch(() => undefined)
      .finally(() => {
        sampling.current = false;
        if (live.current) setPlaying(false);
      });
  };

  return {
    voices: all ? rankVoices(all, wanted, settings.voiceId) : null,
    playing,
    canSample: sample !== null,
    playSample,
  };
}
