/**
 * The behaviour behind the settings screen (app/profile/settings.tsx), apart from its view:
 * settings writes, the region toggle, Apple Music access, the "your data" actions, the version
 * and build, and the hidden seven taps that open the model self-test.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState as NativeAppState, Linking } from 'react-native';
import { useAppState } from '../../appState/AppStateProvider';
import { useServices } from '../../services/ServicesProvider';
import type { AppSettings } from '../../storage/repos/settings';
import { deleteLyricsAndTexts } from './progress';
import type { MusicAccess } from './SettingsView';

/** Taps on the version that open the self-test, and the longest pause between two of them. */
export const SECRET_TAPS = 7;
export const SECRET_TAP_GAP_MS = 1500;

/** Writes a settings patch; a rejected write leaves the stored value on screen. */
export function useSettingsWriter() {
  const { settings, updateSettings } = useAppState();
  const change = useCallback(
    (patch: Partial<AppSettings>) => {
      void updateSettings(patch).catch((e: unknown) => console.warn('[settings] not saved', e));
    },
    [updateSettings],
  );
  const toggleRegion = useCallback(
    (code: string) => {
      const regions = settings.regions;
      change({ regions: regions.includes(code) ? regions.filter((c) => c !== code) : [...regions, code] });
    },
    [settings.regions, change],
  );
  return { settings, change, toggleRegion };
}

/** Apple Music access, read again when the app comes back (the learner may have changed it in Settings). */
export function useMusicAccess() {
  const { music } = useServices();
  const [access, setAccess] = useState<MusicAccess>('checking');
  const read = useCallback(() => {
    music.authorizationStatus().then(setAccess, () => setAccess('unsupported'));
  }, [music]);
  useEffect(() => {
    read();
    const sub = NativeAppState.addEventListener('change', (status) => {
      if (status === 'active') read();
    });
    return () => sub.remove();
  }, [read]);
  const onConnect = useCallback(() => {
    music.authorize().then(setAccess, () => read());
  }, [music, read]);
  const onOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);
  return { access, onConnect, onOpenSettings };
}

/** Counts taps; the `count`-th in a row (each within `gapMs` of the one before) calls `onUnlock`. */
export function useSecretTaps(onUnlock: () => void, count = SECRET_TAPS, gapMs = SECRET_TAP_GAP_MS) {
  const { clock } = useServices();
  const taps = useRef({ n: 0, last: -Infinity });
  return useCallback(() => {
    const now = clock.now();
    const state = taps.current;
    state.n = now - state.last <= gapMs ? state.n + 1 : 1;
    state.last = now;
    if (state.n >= count) {
      state.n = 0;
      onUnlock();
    }
  }, [clock, count, gapMs, onUnlock]);
}

/** The app version and native build (src/config/appInfo.ts). */
export { appVersion } from '../../config/appInfo';

/**
 * Settings' data actions. Reset progress is the app state's (AppState.resetProgress): it stops
 * the live story and lyric sessions, clears the progress and builds a new learner; onboarding is
 * not shown again and the Story tab starts its first story afresh.
 */
export function useDataActions() {
  const { storage, resetProgress } = useAppState();
  const deleteContent = useCallback(() => deleteLyricsAndTexts(storage), [storage]);
  return { deleteContent, resetProgress };
}
