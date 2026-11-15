/**
 * The numbers on the profile: minutes spoken in total (storage.spokenTime, the headline metric)
 * and the engine's estimate of how many words the learner understands (estimateVocabulary over
 * the frequency list: the expected count, so probable cognates already count for a beginner).
 */
import { useEffect, useMemo, useState } from 'react';
import { estimateVocabulary, frequencyLexemeKeys } from '@cliffword/engine';
import { useAppState } from '../../appState/AppStateProvider';
import { useServices } from '../../services/ServicesProvider';

export interface ProfileStats {
  /** Total time spoken, in ms (0 until storage has answered). */
  spokenMs: number;
  /** Rounded vocabulary estimate. */
  wordsKnown: number;
}

export function useProfileStats(): ProfileStats {
  const { storage, learner } = useAppState();
  const { packs, clock } = useServices();
  const [spokenMs, setSpokenMs] = useState(0);

  useEffect(() => {
    let current = true;
    storage.spokenTime.total().then(
      (ms) => {
        if (current) setSpokenMs(ms);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [storage]);

  const wordsKnown = useMemo(
    () => Math.round(estimateVocabulary(learner, clock.now(), frequencyLexemeKeys(packs.lang))),
    [learner, clock, packs],
  );

  return { spokenMs, wordsKnown };
}
