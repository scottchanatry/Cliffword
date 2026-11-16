import { useCallback } from 'react';
import type { CommonActions, ListenState } from '../../session/contract';

/**
 * Start or stop listening without holding: for screen readers (the activate action of
 * HoldArea and HoldButton) and for latched rounds. Idle or after an error it starts
 * (holdBegin then holdStart); while warming or listening it stops (holdEnd); while the
 * answer is being finished it does nothing.
 */
export function useListenToggle(
  listen: ListenState,
  actions: Pick<CommonActions, 'holdBegin' | 'holdStart' | 'holdEnd'>,
): () => void {
  const { phase } = listen;
  const { holdBegin, holdStart, holdEnd } = actions;
  return useCallback(() => {
    if (phase === 'idle' || phase === 'error') {
      holdBegin();
      holdStart();
    } else if (phase === 'warming' || phase === 'listening') {
      holdEnd();
    }
  }, [phase, holdBegin, holdStart, holdEnd]);
}

/** Whether the microphone is on (or about to be). */
export function isListening(listen: ListenState): boolean {
  return listen.phase === 'warming' || listen.phase === 'listening';
}
