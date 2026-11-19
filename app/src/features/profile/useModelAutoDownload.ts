/**
 * The language model downloads by itself, in the background, once onboarding is done: on Wi-Fi
 * only (services.network), at most once per launch, and never when the learner said "Not now"
 * (settings.modelDeclined). Nothing blocks on it: the story checks answers by matching until the
 * model is ready, and the Settings model card still starts, pauses or deletes it by hand.
 *
 * - Started on mobile data or offline, it waits for the connection to change to Wi-Fi.
 * - A download paused in Settings stays paused for the rest of the launch.
 * - The file already there (or downloading, or being checked) is left alone.
 */
import { useEffect, useRef } from 'react';
import { useAppState } from '../../appState/AppStateProvider';
import type { ConnectionKind } from '../../adapters/network/types';
import { useServices } from '../../services/ServicesProvider';
import { isOnboarded } from '../../storage/repos/settings';

export function useModelAutoDownload(): void {
  const { modelManager, network } = useServices();
  const { settings } = useAppState();
  const wanted = isOnboarded(settings) && !settings.modelDeclined;
  const started = useRef(false);

  useEffect(() => {
    if (!wanted || started.current) return;
    let live = true;
    const tryStart = (kind: ConnectionKind) => {
      if (!live || started.current || kind !== 'wifi') return;
      if (modelManager.status() !== 'absent') return;
      started.current = true;
      void modelManager.startDownload().catch((e: unknown) => console.warn('[model] download failed', e));
    };
    const off = network.onChange(tryStart);
    void network.kind().then(tryStart);
    return () => {
      live = false;
      off();
    };
  }, [wanted, modelManager, network]);
}
