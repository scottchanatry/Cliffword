/**
 * Runs the model self-test (selftest.ts) against services.model and keeps its report while the
 * screen is open. Timings use performance.now() where the runtime has it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ModelInfo, ModelStatus } from '../../adapters/model/types';
import { useServices } from '../../services/ServicesProvider';
import { runSelfTest, type SelfTestReport } from './selftest';

const monotonic = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export interface SelfTestState {
  info: ModelInfo;
  status: ModelStatus;
  report: SelfTestReport | null;
  progress: { done: number; total: number } | null;
  onRun: () => void;
}

export function useSelfTest(now: () => number = monotonic): SelfTestState {
  const { model } = useServices();
  const subscribe = useCallback((listener: () => void) => model.onStatusChange(listener), [model]);
  const status = useSyncExternalStore(subscribe, () => model.status, () => model.status);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const onRun = useCallback(() => {
    if (progress) return;
    setProgress({ done: 0, total: 0 });
    void runSelfTest(model, {
      now,
      onProgress: (done, total) => {
        if (live.current) setProgress({ done, total });
      },
    })
      .then((r) => {
        if (live.current) setReport(r);
      })
      .finally(() => {
        if (live.current) setProgress(null);
      });
  }, [model, now, progress]);

  return { info: model.info, status, report, progress, onRun };
}
